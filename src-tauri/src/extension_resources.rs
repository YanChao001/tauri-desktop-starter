//! 通用图片资源只以短期句柄共享；插件不获得原生路径或任意文件访问能力。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_network::{ExtensionNetworkMode, fetch_public_image},
    extension_services::ServicePermit,
    extensions::{ExtensionInfo, ExtensionPermission, valid_id},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader, codecs::jpeg::JpegEncoder};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    io::Cursor,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri_plugin_dialog::DialogExt;

pub(crate) const IMAGE_LIMIT: usize = 16 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
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
        network_mode: ExtensionNetworkMode,
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

    fn retain_authorized(&mut self, items: &[ExtensionInfo]) {
        self.entries.retain(|entry| {
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
    if bytes.is_empty() || bytes.len() > IMAGE_LIMIT {
        return Err(invalid("图片必须非空且不超过 16 MiB"));
    }
    let format = image::guess_format(bytes).map_err(|_| invalid("图片内容无效"))?;
    let expected = match format {
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Png => "image/png",
        ImageFormat::WebP => "image/webp",
        _ => return Err(invalid("仅支持 JPEG、PNG 与 WebP 图片")),
    };
    if !mime.is_empty() && mime != expected {
        return Err(invalid("图片 MIME 与实际内容不一致"));
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut metadata_reader = ImageReader::with_format(Cursor::new(bytes), format);
    metadata_reader.limits(limits.clone());
    let (width, height) = metadata_reader
        .into_dimensions()
        .map_err(|_| invalid("无法在额度内读取图片尺寸"))?;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(invalid("图片每边最多 8192 像素，总计最多 1600 万像素"));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    reader.decode().map_err(|_| invalid("无法在额度内解码图片"))
}

/// 调用方已经持有处理名额时使用；本机文件和图库应调用有界入口。
pub(crate) fn render_image(bytes: &[u8], mime: &str, thumbnail: bool) -> NativeResult<String> {
    let decoded = decode_image(bytes, mime)?;
    for edge in if thumbnail {
        &[320, 240, 160][..]
    } else {
        &[1600, 1280, 960, 720, 480][..]
    } {
        let resized = decoded
            .thumbnail((*edge).min(decoded.width()), (*edge).min(decoded.height()))
            .to_rgb8();
        let mut output = Vec::new();
        JpegEncoder::new_with_quality(&mut output, if thumbnail { 65 } else { 76 })
            .encode_image(&resized)
            .map_err(|_| failed("无法编码图片预览"))?;
        let data = format!("data:image/jpeg;base64,{}", STANDARD.encode(output));
        if data.len() <= if thumbnail { 24 * 1024 } else { 94 * 1024 } {
            return Ok(data);
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
        || name.ends_with('.')
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        || !suffixes.contains(&suffix.as_str())
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&stem.as_str())
    {
        return Err(invalid(
            "图片文件名最多 100 个 ASCII 字符，且后缀必须匹配图片格式",
        ));
    }
    Ok(name.to_owned())
}

pub(crate) async fn request(
    app: tauri::AppHandle,
    owner: &str,
    identity: ResourceIdentity,
    value: Value,
    permit: ServicePermit,
) -> NativeResult<Value> {
    validate_owner(owner, &identity)?;
    if serde_json::to_vec(&value).map_or(true, |bytes| bytes.len() > 8192) {
        return Err(invalid("图片资源请求超过额度"));
    }
    let request: Request =
        serde_json::from_value(value).map_err(|_| invalid("图片资源请求无效"))?;
    permit.check()?;
    match request {
        Request::FetchImage { url, network_mode } => {
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

pub(crate) fn retain_authorized(items: &[ExtensionInfo]) -> NativeResult<()> {
    lock_cache()?.retain_authorized(items);
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
            cache.retain_authorized(&[current]);
            assert_eq!(cache.entries.len(), usize::from(mutate == 0));
        }
        let mut cache = ResourceCache::default();
        cache
            .insert(
                resource("main@1", 1, Arc::from([1_u8].as_slice()), now),
                now,
            )
            .unwrap();
        cache.retain_authorized(&[]);
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
            assert!(rendered.len() <= if thumbnail { 24 * 1024 } else { 94 * 1024 });
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
    fn filenames_and_requests_reject_paths_unknown_fields_and_format_mismatches() {
        let entry = resource("main@1", 1, Arc::from([1_u8].as_slice()), Instant::now());
        assert_eq!(save_name(&entry, None).unwrap(), "image-bbbbbbbbbbbb.png");
        assert_eq!(
            save_name(&entry, Some("sample-1.PNG")).unwrap(),
            "sample-1.PNG"
        );
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
            "image file.png",
            "图片.png",
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
                network_mode: ExtensionNetworkMode::Direct,
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
