//! 通用图片资源只以短期句柄共享；插件不获得原生路径或任意文件访问能力。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_network::{ExtensionNetworkMode, fetch_public_image, resolve_network_mode},
    extension_services::ServicePermit,
    extensions::{ExtensionInfo, ExtensionPermission, valid_id},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader, codecs::jpeg::JpegEncoder, imageops::FilterType};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    io::Cursor,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub(crate) const IMAGE_LIMIT: usize = 16 * 1024 * 1024;
pub(crate) const LOCAL_IMAGE_LIMIT: usize = 64 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
const MAX_LOCAL_PIXELS: u64 = 100_000_000;
const RESOURCE_TTL: Duration = Duration::from_secs(10 * 60);
const OWNER_COUNT_LIMIT: usize = 8;
const OWNER_BYTES_LIMIT: usize = 32 * 1024 * 1024;
const CACHE_COUNT_LIMIT: usize = 32;
const CACHE_BYTES_LIMIT: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceIdentity {
    pub(crate) id: String,
    pub(crate) generation: i32,
    pub(crate) sha256: String,
}

impl From<&ExtensionInfo> for ResourceIdentity {
    fn from(item: &ExtensionInfo) -> Self {
        Self {
            id: item.package.manifest.id.clone(),
            generation: item.generation,
            sha256: item.package.sha256.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    FetchImage {
        url: String,
        #[serde(default, rename = "networkMode")]
        network_mode: Option<ExtensionNetworkMode>,
    },
    Preview {
        #[serde(rename = "resourceId")]
        resource_id: String,
    },
    Save {
        #[serde(rename = "resourceId")]
        resource_id: String,
        #[serde(default)]
        name: Option<String>,
    },
    Release {
        #[serde(rename = "resourceId")]
        resource_id: String,
    },
}

#[derive(Clone)]
struct Resource {
    resource_id: String,
    owner: String,
    identity: ResourceIdentity,
    created: Instant,
    bytes: Arc<[u8]>,
    mime: String,
    width: u32,
    height: u32,
    sha256: String,
}

#[derive(Default)]
struct ResourceCache {
    entries: VecDeque<Resource>,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn failed(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionRunFailed, message)
}

fn busy() -> NativeError {
    NativeError::new(
        ErrorCode::ExtensionBusy,
        "图片资源已达到额度，请释放资源后重试",
    )
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_owner(owner: &str, identity: &ResourceIdentity) -> NativeResult<()> {
    if owner.is_empty()
        || owner.len() > 160
        || !valid_id(&identity.id)
        || identity.generation <= 0
        || !valid_digest(&identity.sha256)
    {
        return Err(invalid("图片资源调用身份无效"));
    }
    Ok(())
}

fn unavailable() -> NativeError {
    NativeError::new(
        ErrorCode::NotFound,
        "图片资源不存在、已过期或不属于当前窗口与安装",
    )
}

impl ResourceCache {
    fn prune(&mut self, now: Instant) {
        self.entries
            .retain(|entry| now.saturating_duration_since(entry.created) < RESOURCE_TTL);
    }

    fn insert(&mut self, resource: Resource, now: Instant) -> NativeResult<()> {
        self.prune(now);
        let owner_count = self
            .entries
            .iter()
            .filter(|entry| entry.owner == resource.owner)
            .count();
        let owner_bytes: usize = self
            .entries
            .iter()
            .filter(|entry| entry.owner == resource.owner)
            .map(|entry| entry.bytes.len())
            .sum();
        let cache_bytes: usize = self.entries.iter().map(|entry| entry.bytes.len()).sum();
        if owner_count >= OWNER_COUNT_LIMIT
            || owner_bytes + resource.bytes.len() > OWNER_BYTES_LIMIT
            || self.entries.len() >= CACHE_COUNT_LIMIT
            || cache_bytes + resource.bytes.len() > CACHE_BYTES_LIMIT
        {
            return Err(busy());
        }
        if self
            .entries
            .iter()
            .any(|entry| entry.resource_id == resource.resource_id)
        {
            return Err(failed("无法分配唯一图片资源句柄"));
        }
        self.entries.push_back(resource);
        Ok(())
    }

    fn lookup(
        &mut self,
        owner: &str,
        identity: &ResourceIdentity,
        resource_id: &str,
        now: Instant,
    ) -> NativeResult<Resource> {
        validate_owner(owner, identity)?;
        if !valid_digest(resource_id) {
            return Err(invalid("图片资源句柄无效"));
        }
        self.prune(now);
        self.entries
            .iter()
            .find(|entry| {
                entry.resource_id == resource_id
                    && entry.owner == owner
                    && entry.identity == *identity
            })
            .cloned()
            .ok_or_else(unavailable)
    }

    fn release(
        &mut self,
        owner: &str,
        identity: &ResourceIdentity,
        resource_id: &str,
        now: Instant,
    ) -> NativeResult<()> {
        self.lookup(owner, identity, resource_id, now)?;
        self.entries
            .retain(|entry| entry.resource_id != resource_id);
        Ok(())
    }

    fn close_owners(&mut self, owners: &[String]) {
        let owners: HashSet<_> = owners.iter().map(String::as_str).collect();
        self.entries
            .retain(|entry| !owners.contains(entry.owner.as_str()));
    }

    fn retain_authorized(&mut self, id: &str, items: &[ExtensionInfo]) {
        self.entries.retain(|entry| {
            if entry.identity.id != id {
                return true;
            }
            items.iter().any(|item| {
                item.enabled
                    && item.package.manifest.id == entry.identity.id
                    && item.generation == entry.identity.generation
                    && item.package.sha256 == entry.identity.sha256
                    && item
                        .package
                        .manifest
                        .has_permission(ExtensionPermission::NetworkImages)
                    && item
                        .granted_permissions
                        .contains(&ExtensionPermission::NetworkImages)
            })
        });
    }
}

fn cache() -> &'static Mutex<ResourceCache> {
    static CACHE: OnceLock<Mutex<ResourceCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ResourceCache::default()))
}

fn lock_cache() -> NativeResult<std::sync::MutexGuard<'static, ResourceCache>> {
    cache()
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "图片资源缓存不可用"))
}

fn image_workers() -> &'static Arc<tokio::sync::Semaphore> {
    static ACTIVE: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    ACTIVE.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
}

fn acquire_image_capacity(
    workers: &Arc<tokio::sync::Semaphore>,
) -> NativeResult<tokio::sync::OwnedSemaphorePermit> {
    workers
        .clone()
        .try_acquire_owned()
        .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "图片处理繁忙，请稍后重试"))
}

fn image_capacity() -> NativeResult<tokio::sync::OwnedSemaphorePermit> {
    acquire_image_capacity(image_workers())
}

pub(crate) fn decode_image(bytes: &[u8], mime: &str) -> NativeResult<image::DynamicImage> {
    decode_with_limits(bytes, mime, false)
}

fn decode_with_limits(bytes: &[u8], mime: &str, local: bool) -> NativeResult<image::DynamicImage> {
    if bytes.is_empty() {
        return Err(NativeError::new(
            ErrorCode::ExtensionImageInvalid,
            "图片内容为空",
        ));
    }
    let byte_limit = if local {
        LOCAL_IMAGE_LIMIT
    } else {
        IMAGE_LIMIT
    };
    let pixel_limit = if local { MAX_LOCAL_PIXELS } else { MAX_PIXELS };
    let edge_limit = if local { 32_768 } else { 8192 };
    if bytes.len() > byte_limit {
        return Err(NativeError::new(
            ErrorCode::ExtensionImageTooLarge,
            "图片文件超过可处理的大小",
        ));
    }
    let format = image::guess_format(bytes).map_err(|_| image_decode_error("图片内容无效"))?;
    let expected = match format {
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Png => "image/png",
        ImageFormat::WebP => "image/webp",
        _ => return Err(image_decode_error("仅支持 JPEG、PNG 与 WebP 图片")),
    };
    if !mime.is_empty() && mime != expected {
        return Err(image_decode_error("图片 MIME 与实际内容不一致"));
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(edge_limit);
    limits.max_image_height = Some(edge_limit);
    limits.max_alloc = Some(if local { 512 } else { 128 } * 1024 * 1024);
    let mut metadata_reader = ImageReader::with_format(Cursor::new(bytes), format);
    metadata_reader.limits(limits.clone());
    let (width, height) = metadata_reader
        .into_dimensions()
        .map_err(|error| image_reader_error(error, "无法读取图片尺寸"))?;
    if width == 0
        || height == 0
        || width > edge_limit
        || height > edge_limit
        || u64::from(width) * u64::from(height) > pixel_limit
    {
        return Err(NativeError::new(
            ErrorCode::ExtensionImageTooLarge,
            "图片尺寸超过可处理的范围",
        ));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|error| image_reader_error(error, "无法解码图片"))
}

fn image_decode_error(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionImageInvalid, message)
}

fn image_reader_error(error: image::ImageError, message: &str) -> NativeError {
    NativeError::new(
        if matches!(error, image::ImageError::Limits(_)) {
            ErrorCode::ExtensionImageTooLarge
        } else {
            ErrorCode::ExtensionImageInvalid
        },
        message,
    )
}

/// 调用方已经持有处理名额时使用；本机文件和图库应调用有界入口。
pub(crate) fn render_image(bytes: &[u8], mime: &str, thumbnail: bool) -> NativeResult<String> {
    let decoded = decode_image(bytes, mime)?;
    render_decoded(&decoded, thumbnail)
}

fn render_decoded(decoded: &image::DynamicImage, thumbnail: bool) -> NativeResult<String> {
    let qualities = if thumbnail {
        &[85, 76, 65][..]
    } else {
        &[82, 64, 46][..]
    };
    for edge in if thumbnail {
        &[320, 240, 160, 96, 64][..]
    } else {
        &[1600, 1200, 900, 675, 506, 379, 284, 213, 159, 119, 89, 64][..]
    } {
        // 使用平滑重采样，先调编码质量再缩小尺寸，避免复杂壁纸过早丢失细节。
        let resized = decoded
            .resize(
                (*edge).min(decoded.width()),
                (*edge).min(decoded.height()),
                FilterType::Triangle,
            )
            .to_rgb8();
        for quality in qualities {
            let mut output = Vec::new();
            JpegEncoder::new_with_quality(&mut output, *quality)
                .encode_image(&resized)
                .map_err(|_| failed("无法编码图片预览"))?;
            let data = format!("data:image/jpeg;base64,{}", STANDARD.encode(output));
            if data.len() <= if thumbnail { 24 * 1024 } else { 96 * 1024 } {
                return Ok(data);
            }
        }
    }
    Err(invalid("图片无法压缩到宿主预览额度内"))
}

fn render_with_capacity(
    bytes: &[u8],
    mime: &str,
    thumbnail: bool,
    workers: &Arc<tokio::sync::Semaphore>,
) -> NativeResult<String> {
    let _capacity = acquire_image_capacity(workers)?;
    render_image(bytes, mime, thumbnail)
}

/// 本机导入和图库预览与远程资源处理共用两个名额，不在窗口提交锁内解码。
pub(crate) fn bounded_render_image(
    bytes: &[u8],
    mime: &str,
    thumbnail: bool,
) -> NativeResult<String> {
    render_with_capacity(bytes, mime, thumbnail, image_workers())
}

/// 用户主动选择的本机大图先查尺寸再解码，与网络图片共用处理名额但使用独立输入额度。
pub(crate) fn render_local_wallpaper(bytes: &[u8]) -> NativeResult<String> {
    let _capacity = image_capacity()?;
    let decoded = decode_with_limits(bytes, "", true)?;
    render_decoded(&decoded, false)
}

fn metadata(resource: &Resource) -> Value {
    json!({
        "resourceId": resource.resource_id,
        "mime": resource.mime,
        "bytes": resource.bytes.len(),
        "width": resource.width,
        "height": resource.height,
        "sha256": resource.sha256,
    })
}

fn prepare_resource(
    owner: String,
    identity: ResourceIdentity,
    bytes: Vec<u8>,
    mime: String,
) -> NativeResult<Resource> {
    let decoded = decode_image(&bytes, &mime)?;
    let width = decoded.width();
    let height = decoded.height();
    drop(decoded);
    let mut nonce = [0_u8; 32];
    getrandom::fill(&mut nonce).map_err(|_| failed("无法创建图片资源句柄"))?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok(Resource {
        resource_id: format!("{:x}", Sha256::digest(nonce)),
        owner,
        identity,
        created: Instant::now(),
        bytes: bytes.into(),
        mime,
        width,
        height,
        sha256,
    })
}

fn save_name(resource: &Resource, name: Option<&str>) -> NativeResult<String> {
    let (extension, suffixes): (&str, &[&str]) = match resource.mime.as_str() {
        "image/jpeg" => ("jpg", &["jpg", "jpeg"]),
        "image/png" => ("png", &["png"]),
        "image/webp" => ("webp", &["webp"]),
        _ => return Err(invalid("图片资源格式无效")),
    };
    let Some(name) = name else {
        return Ok(format!("image-{}.{}", &resource.sha256[..12], extension));
    };
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let suffix = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if name.is_empty()
        || name.len() > 100
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|character| character.is_control() || r#"/\:<>"|?*"#.contains(character))
        || !suffixes.contains(&suffix.as_str())
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&stem.as_str())
    {
        return Err(invalid(
            "图片文件名最多 100 字节，不得包含路径或保留字符，且后缀必须匹配图片格式",
        ));
    }
    Ok(name.to_owned())
}

pub(crate) async fn request(
    app: tauri::AppHandle,
    owner: &str,
    item: ExtensionInfo,
    value: Value,
    permit: ServicePermit,
) -> NativeResult<Value> {
    let identity = ResourceIdentity::from(&item);
    validate_owner(owner, &identity)?;
    if serde_json::to_vec(&value).map_or(true, |bytes| bytes.len() > 8192) {
        return Err(invalid("图片资源请求超过额度"));
    }
    let request: Request =
        serde_json::from_value(value).map_err(|_| invalid("图片资源请求无效"))?;
    permit.check()?;
    match request {
        Request::FetchImage { url, network_mode } => {
            let network_mode = resolve_network_mode(
                &item.package.manifest,
                &item.granted_permissions,
                app.state::<crate::storage::SettingsStore>()
                    .network_mode()?,
                network_mode,
                false,
            )?;
            let capacity = image_capacity()?;
            let (bytes, mime) = fetch_public_image(&url, network_mode).await?;
            permit.check()?;
            let owner = owner.to_owned();
            blocking::run(move || {
                // 实际解码结束前保留处理名额和原生生命周期租约。
                let _capacity = capacity;
                permit.check()?;
                let resource = prepare_resource(owner, identity, bytes, mime)?;
                let result = metadata(&resource);
                permit.commit(|| lock_cache()?.insert(resource, Instant::now()))?;
                Ok(result)
            })
            .await
        }
        Request::Preview { resource_id } => {
            let resource = lock_cache()?.lookup(owner, &identity, &resource_id, Instant::now())?;
            let capacity = image_capacity()?;
            blocking::run(move || {
                let _capacity = capacity;
                permit.check()?;
                let data_url = render_image(&resource.bytes, &resource.mime, true)?;
                permit.check()?;
                Ok(json!({ "dataUrl": data_url }))
            })
            .await
        }
        Request::Save { resource_id, name } => {
            let resource = lock_cache()?.lookup(owner, &identity, &resource_id, Instant::now())?;
            let filename = save_name(&resource, name.as_deref())?;
            blocking::run(move || {
                permit.check()?;
                let Some(path) = app
                    .dialog()
                    .file()
                    .set_file_name(&filename)
                    .blocking_save_file()
                else {
                    return Ok(json!({ "cancelled": true, "name": filename }));
                };
                let path = path
                    .into_path()
                    .map_err(|_| invalid("所选图片保存位置无效"))?;
                permit.commit(|| crate::storage::atomic_write(&path, &resource.bytes))?;
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or(filename);
                Ok(json!({ "cancelled": false, "name": name }))
            })
            .await
        }
        Request::Release { resource_id } => {
            permit
                .commit(|| lock_cache()?.release(owner, &identity, &resource_id, Instant::now()))?;
            Ok(Value::Null)
        }
    }
}

/// 调用方在阻塞线程中渲染，并在写入图库之前复核自己的生命周期租约。
pub(crate) fn gallery_image(
    owner: &str,
    identity: &ResourceIdentity,
    resource_id: &str,
) -> NativeResult<String> {
    let resource = lock_cache()?.lookup(owner, identity, resource_id, Instant::now())?;
    let _capacity = image_capacity()?;
    render_image(&resource.bytes, &resource.mime, false)
}

pub(crate) fn close_owners(owners: &[String]) -> NativeResult<()> {
    lock_cache()?.close_owners(owners);
    Ok(())
}

pub(crate) fn retain_authorized(id: &str, items: &[ExtensionInfo]) -> NativeResult<()> {
    lock_cache()?.retain_authorized(id, items);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::{
        ExtensionCommand, ExtensionInputFormat, ExtensionManifest, ExtensionOrigin,
        ExtensionPreview, ExtensionResultFormat,
    };

    fn identity() -> ResourceIdentity {
        ResourceIdentity {
            id: "tests.images".into(),
            generation: 1,
            sha256: "a".repeat(64),
        }
    }

    fn resource(owner: &str, index: usize, bytes: Arc<[u8]>, now: Instant) -> Resource {
        Resource {
            resource_id: format!("{index:064x}"),
            owner: owner.into(),
            identity: identity(),
            created: now,
            bytes,
            mime: "image/png".into(),
            width: 2,
            height: 3,
            sha256: "b".repeat(64),
        }
    }

    fn installed() -> ExtensionInfo {
        let identity = identity();
        ExtensionInfo {
            package: ExtensionPreview {
                manifest: ExtensionManifest {
                    format_version: 3,
                    api_version: 2,
                    min_host_version: "0.1.6".into(),
                    id: identity.id,
                    version: "1.0.0".into(),
                    name: "Image resources".into(),
                    author: "Tests".into(),
                    description: "Image resources fixture".into(),
                    icon: None,
                    commands: vec![ExtensionCommand {
                        id: "main".into(),
                        title: "Main".into(),
                        function: "main".into(),
                        input_format: ExtensionInputFormat::Json,
                        result_format: ExtensionResultFormat::View,
                        execution_budget: Default::default(),
                        ui: None,
                        permissions: vec![ExtensionPermission::NetworkImages],
                    }],
                    permissions: vec![ExtensionPermission::NetworkImages],
                    optional_permissions: vec![],
                    network: vec![],
                },
                sha256: identity.sha256,
                bytes: 1,
                ui_documents: vec![],
            },
            generation: identity.generation,
            enabled: true,
            granted_permissions: vec![ExtensionPermission::NetworkImages],
            origin: ExtensionOrigin::Local,
            previous_package: None,
            previous_origin: None,
        }
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(width, height)
            .write_to(&mut output, ImageFormat::Png)
            .unwrap();
        output.into_inner()
    }

    #[test]
    fn handles_are_bound_to_installation_window_epoch_and_expiration_without_copying_bytes() {
        let now = Instant::now();
        let bytes: Arc<[u8]> = Arc::from([1_u8, 2, 3].as_slice());
        let entry = resource("main@1", 1, bytes.clone(), now);
        let id = entry.resource_id.clone();
        let mut cache = ResourceCache::default();
        cache.insert(entry, now).unwrap();
        let found = cache.lookup("main@1", &identity(), &id, now).unwrap();
        assert!(Arc::ptr_eq(&found.bytes, &bytes));
        for owner in ["other@1", "main@2"] {
            assert_eq!(
                cache
                    .lookup(owner, &identity(), &id, now)
                    .err()
                    .unwrap()
                    .code,
                ErrorCode::NotFound
            );
        }
        for changed in [
            ResourceIdentity {
                id: "tests.other".into(),
                ..identity()
            },
            ResourceIdentity {
                generation: 2,
                ..identity()
            },
            ResourceIdentity {
                sha256: "c".repeat(64),
                ..identity()
            },
        ] {
            assert!(cache.lookup("main@1", &changed, &id, now).is_err());
            assert!(cache.release("main@1", &changed, &id, now).is_err());
        }
        assert_eq!(cache.entries.len(), 1);
        assert!(
            cache
                .lookup("main@1", &identity(), &id, now + RESOURCE_TTL)
                .is_err()
        );
        assert!(cache.entries.is_empty());
    }

    #[test]
    fn release_and_window_cleanup_do_not_remove_another_owner_or_reopened_window() {
        let now = Instant::now();
        let bytes: Arc<[u8]> = Arc::from([1_u8].as_slice());
        let mut cache = ResourceCache::default();
        for (index, owner) in ["main@1", "main@2", "other@1"].into_iter().enumerate() {
            cache
                .insert(resource(owner, index, bytes.clone(), now), now)
                .unwrap();
        }
        let id = cache.entries[1].resource_id.clone();
        assert!(cache.release("main@1", &identity(), &id, now).is_err());
        assert_eq!(cache.entries.len(), 3);
        cache.close_owners(&["main@1".into()]);
        assert_eq!(cache.entries.len(), 2);
        cache.lookup("main@2", &identity(), &id, now).unwrap();
        cache.release("main@2", &identity(), &id, now).unwrap();
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.entries[0].owner, "other@1");
    }

    #[test]
    fn authorization_cleanup_requires_current_identity_enabled_and_images_permission() {
        let now = Instant::now();
        for mutate in 0..6 {
            let mut cache = ResourceCache::default();
            cache
                .insert(
                    resource("main@1", 1, Arc::from([1_u8].as_slice()), now),
                    now,
                )
                .unwrap();
            let mut current = installed();
            match mutate {
                1 => current.enabled = false,
                2 => current.generation += 1,
                3 => current.package.sha256 = "c".repeat(64),
                4 => current.granted_permissions.clear(),
                5 => current.package.manifest.permissions.clear(),
                _ => {}
            }
            cache.retain_authorized("tests.images", &[current]);
            assert_eq!(cache.entries.len(), usize::from(mutate == 0));
        }
        let mut cache = ResourceCache::default();
        cache
            .insert(
                resource("main@1", 1, Arc::from([1_u8].as_slice()), now),
                now,
            )
            .unwrap();
        cache.retain_authorized("tests.images", &[]);
        assert!(cache.entries.is_empty());
    }

    #[test]
    fn count_quotas_reject_without_evicting_valid_resources_and_expiration_recovers_capacity() {
        let now = Instant::now();
        let bytes: Arc<[u8]> = Arc::from([1_u8].as_slice());
        let mut cache = ResourceCache::default();
        for index in 0..CACHE_COUNT_LIMIT {
            cache
                .insert(
                    resource(
                        &format!("window-{}@1", index / 8),
                        index,
                        bytes.clone(),
                        now,
                    ),
                    now,
                )
                .unwrap();
            if index == OWNER_COUNT_LIMIT - 1 {
                assert_eq!(
                    cache
                        .insert(resource("window-0@1", 1000, bytes.clone(), now), now)
                        .unwrap_err()
                        .code,
                    ErrorCode::ExtensionBusy
                );
                assert_eq!(cache.entries.len(), OWNER_COUNT_LIMIT);
            }
        }
        assert_eq!(
            cache
                .insert(resource("new-owner@1", 1000, bytes.clone(), now), now)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionBusy
        );
        assert_eq!(cache.entries.len(), CACHE_COUNT_LIMIT);
        let later = now + RESOURCE_TTL;
        cache
            .insert(resource("new-owner@1", 1000, bytes, later), later)
            .unwrap();
        assert_eq!(cache.entries.len(), 1);
    }

    #[test]
    fn byte_quotas_count_shared_handles_and_preserve_existing_data_on_failure() {
        let now = Instant::now();
        let bytes: Arc<[u8]> = vec![0_u8; 8 * 1024 * 1024].into();
        let mut cache = ResourceCache::default();
        for index in 0..8 {
            cache
                .insert(
                    resource(
                        if index < 4 { "first@1" } else { "second@1" },
                        index,
                        bytes.clone(),
                        now,
                    ),
                    now,
                )
                .unwrap();
            if index == 3 {
                assert!(
                    cache
                        .insert(resource("first@1", 1000, bytes.clone(), now), now)
                        .is_err()
                );
                assert_eq!(cache.entries.len(), 4);
            }
        }
        assert!(
            cache
                .insert(
                    resource("third@1", 1000, Arc::from([1_u8].as_slice()), now),
                    now
                )
                .is_err()
        );
        assert_eq!(cache.entries.len(), 8);
        assert!(
            cache
                .entries
                .iter()
                .all(|entry| Arc::ptr_eq(&entry.bytes, &bytes))
        );
    }

    #[test]
    #[ignore = "requires explicitly supplied public image URLs and live network access"]
    fn live_public_images_fetch_preview_and_release() {
        #[derive(Clone, Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Sample {
            provider: String,
            url: String,
        }
        let input = std::env::var_os("STARTER_IMAGE_TEST_INPUT")
            .expect("set STARTER_IMAGE_TEST_INPUT to a JSON sample file");
        let samples: Vec<Sample> = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
        assert!(!samples.is_empty() && samples.len() <= 48);
        let mode = match std::env::var("STARTER_IMAGE_TEST_MODE").as_deref() {
            Ok("system") => ExtensionNetworkMode::System,
            Ok("direct") | Err(_) => ExtensionNetworkMode::Direct,
            _ => panic!("STARTER_IMAGE_TEST_MODE must be direct or system"),
        };
        let cache = Arc::new(Mutex::new(ResourceCache::default()));
        let failures = tauri::async_runtime::block_on(async {
            let mut failures = 0;
            for batch in samples.chunks(2) {
                let mut tasks = Vec::new();
                for sample in batch.iter().cloned() {
                    let cache = cache.clone();
                    tasks.push(tokio::spawn(async move {
                        let origin = crate::extension_network::approved_public_url(&sample.url)
                            .unwrap().origin().ascii_serialization();
                        let started = Instant::now();
                        let result = async {
                            let capacity = image_capacity()?;
                            let (bytes, mime) = fetch_public_image(&sample.url, mode).await?;
                            blocking::run(move || {
                                let _capacity = capacity;
                                let resource = prepare_resource("live@1".into(), identity(), bytes, mime)?;
                                let resource_id = resource.resource_id.clone();
                                cache.lock().unwrap().insert(resource, Instant::now())?;
                                let resource = cache.lock().unwrap().lookup("live@1", &identity(), &resource_id, Instant::now())?;
                                let preview = render_image(&resource.bytes, &resource.mime, true);
                                cache.lock().unwrap().release("live@1", &identity(), &resource_id, Instant::now())?;
                                preview.map(|preview| (resource.bytes.len(), resource.width, resource.height, preview.len()))
                            }).await
                        }.await;
                        match result {
                            Ok((bytes, width, height, preview)) => {
                                eprintln!("{} {origin} {mode:?}: {bytes} bytes {width}x{height}, {preview} preview bytes, {:?}", sample.provider, started.elapsed());
                                false
                            }
                            Err(error) => {
                                eprintln!("{} {origin} {mode:?}: {:?}, retryable={}, {}, {:?}", sample.provider, error.code, error.retryable, error.message, started.elapsed());
                                true
                            }
                        }
                    }));
                }
                for task in tasks {
                    failures += usize::from(task.await.unwrap());
                }
            }
            failures
        });
        assert!(cache.lock().unwrap().entries.is_empty());
        assert_eq!(
            failures, 0,
            "live image samples failed; see per-origin result"
        );
    }

    #[test]
    fn image_validation_reports_content_and_quota_failures_separately() {
        for (bytes, mime, code) in [
            (Vec::new(), "image/png", ErrorCode::ExtensionImageInvalid),
            (
                b"broken".to_vec(),
                "image/png",
                ErrorCode::ExtensionImageInvalid,
            ),
            (png(2, 3), "image/jpeg", ErrorCode::ExtensionImageInvalid),
            (png(8193, 1), "image/png", ErrorCode::ExtensionImageTooLarge),
            (
                png(4001, 4000),
                "image/png",
                ErrorCode::ExtensionImageTooLarge,
            ),
            (
                vec![0; IMAGE_LIMIT + 1],
                "image/png",
                ErrorCode::ExtensionImageTooLarge,
            ),
        ] {
            assert_eq!(decode_image(&bytes, mime).unwrap_err().code, code);
        }
    }

    #[test]
    fn local_large_photos_are_optimized_without_raising_network_limits() {
        let bytes = png(4001, 4000);
        assert_eq!(
            decode_image(&bytes, "image/png").unwrap_err().code,
            ErrorCode::ExtensionImageTooLarge
        );
        let decoded = decode_with_limits(&bytes, "image/png", true).unwrap();
        let rendered = render_decoded(&decoded, false).unwrap();
        assert!(rendered.len() <= 96 * 1024);
        let encoded = rendered.strip_prefix("data:image/jpeg;base64,").unwrap();
        let optimized = decode_image(&STANDARD.decode(encoded).unwrap(), "image/jpeg").unwrap();
        assert!(optimized.width() <= 1600 && optimized.height() <= 1600);
        assert_eq!(
            decode_with_limits(&png(32_769, 1), "image/png", true)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionImageTooLarge
        );
    }

    #[test]
    fn invalid_images_never_become_resources_and_previews_are_reencoded_within_budget() {
        let bytes = png(2, 3);
        for (bytes, mime) in [
            (Vec::new(), "image/png"),
            (b"not an image".to_vec(), "image/png"),
            (b"GIF89a".to_vec(), "image/gif"),
            (bytes.clone(), "image/jpeg"),
            (png(8193, 1), "image/png"),
            (vec![0_u8; IMAGE_LIMIT + 1], "image/png"),
        ] {
            assert!(prepare_resource("main@1".into(), identity(), bytes, mime.into()).is_err());
        }
        let first = prepare_resource(
            "main@1".into(),
            identity(),
            bytes.clone(),
            "image/png".into(),
        )
        .unwrap();
        let second = prepare_resource(
            "main@1".into(),
            identity(),
            bytes.clone(),
            "image/png".into(),
        )
        .unwrap();
        assert_ne!(first.resource_id, second.resource_id);
        assert_eq!(first.sha256, format!("{:x}", Sha256::digest(&bytes)));
        assert_eq!(metadata(&first)["width"], 2);
        assert_eq!(metadata(&first)["height"], 3);
        assert!(metadata(&first).get("path").is_none());
        assert!(metadata(&first).get("content").is_none());
        for thumbnail in [true, false] {
            let rendered = render_image(&bytes, "image/png", thumbnail).unwrap();
            assert!(rendered.len() <= if thumbnail { 24 * 1024 } else { 96 * 1024 });
            let encoded = rendered.strip_prefix("data:image/jpeg;base64,").unwrap();
            let rendered = STANDARD.decode(encoded).unwrap();
            let decoded = decode_image(&rendered, "image/jpeg").unwrap();
            assert_eq!((decoded.width(), decoded.height()), (2, 3));
        }
        let larger = png(2000, 1800);
        for (thumbnail, edge) in [(true, 320), (false, 1600)] {
            let rendered = render_image(&larger, "image/png", thumbnail).unwrap();
            let encoded = rendered.strip_prefix("data:image/jpeg;base64,").unwrap();
            let decoded = decode_image(&STANDARD.decode(encoded).unwrap(), "image/jpeg").unwrap();
            assert!(decoded.width() <= edge);
            assert!(decoded.height() <= edge);
        }
    }

    #[test]
    fn detailed_wallpapers_keep_full_resolution_before_reducing_dimensions() {
        let mut state = 7_u32;
        let source = image::RgbImage::from_fn(1600, 900, |x, y| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let noise = ((state >> 24) % 16) as i16 - 8;
            image::Rgb([
                (48 + x as i16 / 10 + noise).clamp(0, 255) as u8,
                (64 + y as i16 / 7 + noise).clamp(0, 255) as u8,
                (176 + x as i16 / 20 - y as i16 / 20 + noise).clamp(0, 255) as u8,
            ])
        });
        let mut fixed_quality = Vec::new();
        JpegEncoder::new_with_quality(&mut fixed_quality, 76)
            .encode_image(&source)
            .unwrap();
        // 旧固定质量策略会为这张有纹理的壁纸降低分辨率。
        assert!(fixed_quality.len().div_ceil(3) * 4 + 23 > 96 * 1024);
        let mut original = Vec::new();
        image::DynamicImage::ImageRgb8(source)
            .write_to(&mut Cursor::new(&mut original), ImageFormat::Png)
            .unwrap();
        let rendered = render_image(&original, "image/png", false).unwrap();
        assert!(rendered.len() <= 96 * 1024);
        let encoded = rendered.strip_prefix("data:image/jpeg;base64,").unwrap();
        let decoded = decode_image(&STANDARD.decode(encoded).unwrap(), "image/jpeg").unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1600, 900));
    }

    #[test]
    fn filenames_and_requests_reject_paths_unknown_fields_and_format_mismatches() {
        let entry = resource("main@1", 1, Arc::from([1_u8].as_slice()), Instant::now());
        assert_eq!(save_name(&entry, None).unwrap(), "image-bbbbbbbbbbbb.png");
        assert_eq!(
            save_name(&entry, Some("sample-1.PNG")).unwrap(),
            "sample-1.PNG"
        );
        for name in ["image file.png", "图片.png"] {
            assert_eq!(save_name(&entry, Some(name)).unwrap(), name);
        }
        for name in [
            "",
            "../image.png",
            "a/image.png",
            "C:\\image.png",
            ".image.png",
            "image.jpg",
            "image.png.",
            "CON.png",
            "lpt9.png",
            "image.png ",
            "image.png\0",
        ] {
            assert!(save_name(&entry, Some(name)).is_err(), "{name}");
        }
        assert!(save_name(&entry, Some(&format!("{}.png", "x".repeat(97)))).is_err());
        let valid: Request = serde_json::from_value(json!({
            "action":"fetch-image","url":"https://images.example.net/image.png"
        }))
        .unwrap();
        assert!(matches!(
            valid,
            Request::FetchImage {
                network_mode: None,
                ..
            }
        ));
        for request in [
            json!({"action":"fetch-image","url":"https://images.example.net/image.png","headers":{}}),
            json!({"action":"fetch-image","url":"https://images.example.net/image.png","networkMode":"proxy"}),
            json!({"action":"save","resourceId":"a".repeat(64),"path":"C:\\image.png"}),
            json!({"action":"release","resourceId":"a".repeat(64),"all":true}),
            json!({"action":"import","content":"data:image/png;base64,AA=="}),
        ] {
            assert!(serde_json::from_value::<Request>(request).is_err());
        }
    }

    #[test]
    fn reconciling_one_extension_preserves_other_extensions_resources() {
        let now = Instant::now();
        let mut cache = ResourceCache::default();
        let first = resource("main@1", 1, Arc::from([1_u8].as_slice()), now);
        let mut second = resource("other@1", 2, Arc::from([2_u8].as_slice()), now);
        second.identity.id = "tests.other".into();
        cache.insert(first, now).unwrap();
        cache.insert(second, now).unwrap();
        cache.retain_authorized("tests.images", &[]);
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.entries[0].identity.id, "tests.other");
    }

    #[test]
    fn bounded_rendering_refuses_a_full_pool_and_keeps_or_releases_capacity_correctly() {
        let workers = Arc::new(tokio::sync::Semaphore::new(2));
        let first = acquire_image_capacity(&workers).unwrap();
        let second = acquire_image_capacity(&workers).unwrap();
        let bytes = png(2, 3);
        assert_eq!(
            render_with_capacity(&bytes, "image/png", true, &workers)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionBusy
        );
        assert_eq!(workers.available_permits(), 0);
        drop(second);
        assert!(render_with_capacity(&bytes, "image/png", true, &workers).is_ok());
        assert_eq!(workers.available_permits(), 1);
        assert!(render_with_capacity(b"bad image", "image/png", false, &workers).is_err());
        assert_eq!(workers.available_permits(), 1);
        drop(first);
        assert_eq!(workers.available_permits(), 2);
    }
}
