//! 明确授权的应用图库与背景设置服务；搜索和供应商规则由插件负责。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_resources::{
        LOCAL_IMAGE_LIMIT, ResourceIdentity, bounded_render_image, gallery_image,
        render_local_wallpaper,
    },
    extension_services::ServicePermit,
    storage::{SETTINGS_EVENT, SETTINGS_SCHEMA_VERSION, SettingsStore, future_settings_schema},
    wallpaper_commands::WALLPAPERS_EVENT,
    wallpapers::{Wallpaper, WallpaperInput, WallpaperStore, WallpaperVideo},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use specta::Type;
use std::{
    collections::VecDeque,
    fs::File,
    io::Read,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionWallpaperApplyResult {
    pub applied: bool,
    pub active_id: String,
    pub revision: i32,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionWallpaperPreviewResult {
    pub id: String,
    pub preview_key: String,
    pub data_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    List,
    Preview {
        id: String,
        #[serde(rename = "previewKey")]
        preview_key: String,
    },
    Import,
    ImportResource {
        #[serde(rename = "resourceId")]
        resource_id: String,
        name: String,
    },
    Apply {
        id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: i32,
        fit: String,
    },
    Rename {
        id: String,
        name: String,
    },
    Remove {
        id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: i32,
    },
    OpenSettings,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn failed(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionRunFailed, message)
}
fn validate_name(name: &str) -> NativeResult<()> {
    if name.trim().is_empty() || name.chars().count() > 120 || name.chars().any(char::is_control) {
        return Err(invalid("Wallpaper name must contain 1–120 characters"));
    }
    Ok(())
}
fn parse_request(value: Value) -> NativeResult<Request> {
    if serde_json::to_vec(&value).map_or(true, |bytes| bytes.len() > 4096) {
        return Err(invalid("Wallpaper request exceeds its limit"));
    }
    // Serde 的内部标签单元变体仍可能忽略额外字段，需在反序列化前明确拒绝。
    if matches!(
        value.get("action").and_then(Value::as_str),
        Some("list" | "import" | "open-settings")
    ) && value.as_object().is_none_or(|object| object.len() != 1)
    {
        return Err(invalid(
            "Wallpaper service action does not accept extra fields",
        ));
    }
    let request: Request =
        serde_json::from_value(value).map_err(|_| invalid("Invalid wallpaper service request"))?;
    match &request {
        Request::Preview { id, preview_key } => {
            validate_id(id)?;
            validate_id(preview_key)?;
        }
        Request::ImportResource { resource_id, name } => {
            if resource_id.is_empty()
                || resource_id.len() > 128
                || resource_id.chars().any(char::is_control)
            {
                return Err(invalid("Invalid image resource ID"));
            }
            validate_name(name)?;
        }
        Request::Apply {
            id,
            expected_revision,
            fit,
        } => {
            validate_id(id)?;
            if *expected_revision < 0 || !matches!(fit.as_str(), "cover" | "contain") {
                return Err(invalid("Invalid wallpaper revision or fit"));
            }
        }
        Request::Remove {
            id,
            expected_revision,
        } => {
            validate_id(id)?;
            if *expected_revision < 0 {
                return Err(invalid("Invalid wallpaper revision"));
            }
        }
        Request::Rename { id, name } => {
            validate_id(id)?;
            validate_name(name)?;
        }
        _ => {}
    }
    Ok(request)
}
fn validate_id(id: &str) -> NativeResult<()> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid("Invalid wallpaper ID"));
    }
    Ok(())
}
fn local_display_name(source: &str) -> String {
    let name = source
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>();
    let name = name.trim();
    if name.is_empty() {
        "Imported wallpaper".into()
    } else {
        name.into()
    }
}

fn legacy(settings: &Value) -> Option<WallpaperInput> {
    let value = settings.get("customBackground")?;
    Some(WallpaperInput {
        video: value
            .get("video")
            .filter(|value| !value.is_null())
            .and_then(|value| serde_json::from_value(value.clone()).ok()),
        name: value.get("name")?.as_str()?.to_owned(),
        data_url: value.get("dataUrl")?.as_str()?.to_owned(),
    })
}
fn matches_background(settings: &Value, entry: &Wallpaper) -> bool {
    let Some(current) = settings.get("customBackground") else {
        return false;
    };
    match (
        current.get("video").filter(|value| !value.is_null()),
        entry.video.as_ref(),
    ) {
        (Some(video), Some(expected)) => serde_json::from_value::<WallpaperVideo>(video.clone())
            .is_ok_and(|video| video == *expected),
        (None, None) => {
            current.get("dataUrl").and_then(Value::as_str) == Some(entry.data_url.as_str())
        }
        _ => false,
    }
}
struct GallerySnapshot {
    revision: i32,
    images: Vec<Wallpaper>,
    active_id: Option<String>,
}

const MAX_CACHED_PREVIEWS: usize = 48;
const MAX_CACHED_PREVIEW_BYTES: usize = 24 * 1024;

#[derive(Default)]
struct GalleryPreviewCache {
    entries: Mutex<VecDeque<([u8; 32], String)>>,
}

impl GalleryPreviewCache {
    fn get_or_render(
        &self,
        data_url: &str,
        render: impl FnOnce(&str) -> NativeResult<Option<String>>,
    ) -> NativeResult<Option<String>> {
        // 视频图库 ID 不包含封面内容，缓存必须跟随实际图片字节变化。
        let key: [u8; 32] = Sha256::digest(data_url.as_bytes()).into();
        if let Ok(entries) = self.entries.lock()
            && let Some((_, preview)) = entries.iter().find(|(stored, _)| stored == &key)
        {
            return Ok(Some(preview.clone()));
        }
        // 解码和编码在锁外执行；临时繁忙、无效图片与超额结果均不占缓存。
        let result = render(data_url)?;
        if let Some(preview) = &result
            && preview.len() <= MAX_CACHED_PREVIEW_BYTES
            && let Ok(mut entries) = self.entries.lock()
            && !entries.iter().any(|(stored, _)| stored == &key)
        {
            while entries.len() >= MAX_CACHED_PREVIEWS {
                entries.pop_front();
            }
            entries.push_back((key, preview.clone()));
        }
        Ok(result)
    }
}

fn gallery_previews() -> &'static GalleryPreviewCache {
    static PREVIEWS: OnceLock<GalleryPreviewCache> = OnceLock::new();
    PREVIEWS.get_or_init(GalleryPreviewCache::default)
}

fn capture_gallery(
    settings: &SettingsStore,
    library: &WallpaperStore,
) -> NativeResult<GallerySnapshot> {
    let snapshot = settings.snapshot()?;
    let images = library.list(legacy(&snapshot.settings))?;
    let active_id = if snapshot.settings.get("background").and_then(Value::as_str) == Some("custom")
    {
        images
            .iter()
            .find(|entry| matches_background(&snapshot.settings, entry))
            .map(|entry| entry.id.clone())
    } else {
        None
    };
    Ok(GallerySnapshot {
        revision: snapshot.revision,
        images,
        active_id,
    })
}
fn read_gallery(app: &tauri::AppHandle) -> NativeResult<GallerySnapshot> {
    capture_gallery(
        &app.state::<SettingsStore>(),
        &app.state::<WallpaperStore>(),
    )
}
fn render_gallery(snapshot: GallerySnapshot, permit: &ServicePermit) -> NativeResult<Value> {
    // 元数据独立于缩略图返回，首次打开不等待整库图片解码。
    permit.check()?;
    let mut items = Vec::with_capacity(snapshot.images.len());
    for entry in snapshot.images {
        permit.check()?;
        let active = snapshot.active_id.as_deref() == Some(entry.id.as_str());
        let preview_key = gallery_preview_key(&entry.data_url);
        items.push(json!({"id":entry.id,"name":entry.name,"dataUrl":null,"active":active,"previewKey":preview_key}));
    }
    permit.check()?;
    Ok(json!({"revision":snapshot.revision,"items":items,"limit":24}))
}
fn gallery_preview_key(data_url: &str) -> String {
    format!("{:x}", Sha256::digest(data_url.as_bytes()))
}
fn select_gallery_preview(
    snapshot: GallerySnapshot,
    id: &str,
    preview_key: &str,
) -> NativeResult<Wallpaper> {
    snapshot
        .images
        .into_iter()
        .find(|entry| entry.id == id && gallery_preview_key(&entry.data_url) == preview_key)
        .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper preview no longer exists"))
}
fn render_gallery_preview(
    entry: Wallpaper,
    permit: &ServicePermit,
    previews: &GalleryPreviewCache,
    preview: impl FnOnce(&str) -> NativeResult<Option<String>>,
) -> NativeResult<ExtensionWallpaperPreviewResult> {
    permit.check()?;
    let data_url = previews.get_or_render(&entry.data_url, preview)?;
    permit.check()?;
    Ok(ExtensionWallpaperPreviewResult {
        id: entry.id,
        preview_key: gallery_preview_key(&entry.data_url),
        data_url,
    })
}
fn gallery_preview(data_url: &str) -> NativeResult<Option<String>> {
    let Some((header, encoded)) = data_url.split_once(',') else {
        return Ok(None);
    };
    let mime = match header {
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/webp;base64" => "image/webp",
        _ => return Ok(None),
    };
    let Ok(bytes) = STANDARD.decode(encoded) else {
        return Ok(None);
    };
    match bounded_render_image(&bytes, mime, true) {
        Ok(preview) => Ok(Some(preview)),
        // 繁忙是临时状态，不能成功返回空预览，让前端误认为图片已经损坏。
        Err(error) if error.code == ErrorCode::ExtensionBusy => Err(error),
        Err(_) => Ok(None),
    }
}
fn next_settings(settings: &Value, image: Option<&Wallpaper>, fit: &str) -> NativeResult<Value> {
    if future_settings_schema(settings) {
        return Err(invalid("Future settings schema is read-only"));
    }
    let mut value = settings.clone();
    let object = value
        .as_object_mut()
        .ok_or_else(|| invalid("Invalid settings snapshot"))?;
    object.insert("schemaVersion".into(), json!(SETTINGS_SCHEMA_VERSION));
    object.insert(
        "background".into(),
        json!(if image.is_some() { "custom" } else { "plain" }),
    );
    object.insert(
        "customBackground".into(),
        image.map_or(
            Value::Null,
            |image| json!({"name":image.name,"dataUrl":image.data_url,"fit":fit,"video":image.video}),
        ),
    );
    Ok(value)
}
fn apply_gallery(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
    fit: &str,
    save: impl FnOnce(
        Option<&WallpaperVideo>,
        Value,
        i32,
    ) -> NativeResult<crate::storage::SettingsSnapshot>,
) -> NativeResult<(
    crate::storage::SettingsSnapshot,
    ExtensionWallpaperApplyResult,
)> {
    let snapshot = settings.snapshot()?;
    let images = library.list(legacy(&snapshot.settings))?;
    let entry = images
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper no longer exists"))?;
    let updated = save(
        entry.video.as_ref(),
        next_settings(&snapshot.settings, Some(entry), fit)?,
        expected_revision,
    )?;
    let result = ExtensionWallpaperApplyResult {
        applied: true,
        revision: updated.revision,
        active_id: entry.id.clone(),
    };
    Ok((updated, result))
}

#[cfg(test)]
fn apply_settings(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
    fit: &str,
) -> NativeResult<crate::storage::SettingsSnapshot> {
    apply_gallery(
        settings,
        library,
        id,
        expected_revision,
        fit,
        |_, next, revision| settings.save(next, revision),
    )
    .map(|(updated, _)| updated)
}
fn remove_image(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
) -> NativeResult<(crate::storage::SettingsSnapshot, NativeResult<()>)> {
    let snapshot = settings.snapshot()?;
    remove_image_from_snapshot(settings, library, id, expected_revision, snapshot)
}
fn remove_image_from_snapshot(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
    snapshot: crate::storage::SettingsSnapshot,
) -> NativeResult<(crate::storage::SettingsSnapshot, NativeResult<()>)> {
    if future_settings_schema(&snapshot.settings) {
        return Err(invalid("Future settings schema is read-only"));
    }
    if snapshot.revision != expected_revision {
        return Err(NativeError::new(
            ErrorCode::SettingsConflict,
            "Settings changed; refresh the gallery before removing",
        ));
    }
    let entry = library
        .list(legacy(&snapshot.settings))?
        .into_iter()
        .find(|entry| entry.id == id);
    let next = if entry
        .as_ref()
        .is_some_and(|entry| matches_background(&snapshot.settings, entry))
    {
        next_settings(&snapshot.settings, None, "cover")?
    } else {
        snapshot.settings
    };
    // Even an inactive removal advances the revision. A settings save that
    // selected this image from an older snapshot must conflict after removal.
    settings.save_and(next, expected_revision, || library.remove(id))
}
fn rename_image(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    name: String,
) -> NativeResult<(Option<crate::storage::SettingsSnapshot>, NativeResult<()>)> {
    let snapshot = settings.snapshot()?;
    if future_settings_schema(&snapshot.settings) {
        return Err(invalid("Future settings schema is read-only"));
    }
    let entry = library
        .list(legacy(&snapshot.settings))?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper no longer exists"))?;
    if !matches_background(&snapshot.settings, &entry) {
        return Ok((None, library.rename(id, name).map(|_| ())));
    }
    let mut next = snapshot.settings;
    next.get_mut("customBackground")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("Invalid custom background settings"))?
        .insert("name".into(), json!(name));
    let (updated, renamed) = settings.save_and(next, snapshot.revision, || {
        library.rename(id, name).map(|_| ())
    })?;
    Ok((Some(updated), renamed))
}
fn broadcast_settings(app: &tauri::AppHandle, snapshot: &crate::storage::SettingsSnapshot) {
    if let Err(error) = app.emit(SETTINGS_EVENT, snapshot) {
        log::warn!("Cannot broadcast wallpaper settings: {error}");
    }
}
fn wallpaper_capacity(preview: bool) -> NativeResult<tokio::sync::OwnedSemaphorePermit> {
    static ACTIVE: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    static PREVIEWS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    // 慢缩略图有独立的一项容量，不占用保存、删除和元数据读取的两个执行位。
    let capacity = if preview {
        PREVIEWS.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(1)))
    } else {
        ACTIVE.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
    };
    capacity
        .clone()
        .try_acquire_owned()
        .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "Wallpaper service is busy"))
}
async fn wallpaper_task<T: Send + 'static>(
    capacity: tokio::sync::OwnedSemaphorePermit,
    task: impl FnOnce() -> NativeResult<T> + Send + 'static,
) -> NativeResult<T> {
    blocking::run(move || {
        // 取消等待不会停止同步工作，执行位必须随实际工作结束后归还。
        let _capacity = capacity;
        task()
    })
    .await
}

pub(crate) async fn request(
    app: tauri::AppHandle,
    owner: &str,
    identity: ResourceIdentity,
    request: Value,
    permit: ServicePermit,
) -> NativeResult<Value> {
    if owner.is_empty() || owner.len() > 160 || owner.chars().any(char::is_control) {
        return Err(invalid("Invalid wallpaper service owner"));
    }
    let request = parse_request(request)?;
    permit.check()?;
    let _permit = wallpaper_capacity(matches!(request, Request::Preview { .. }))?;
    match request {
        Request::ImportResource { resource_id, name } => {
            let owner = owner.to_owned();
            wallpaper_task(_permit, move || {
                permit.check()?;
                let data_url = gallery_image(&owner, &identity, &resource_id)?;
                let (entry, snapshot) = permit.commit(|| {
                    let entry = app.state::<WallpaperStore>().add(WallpaperInput {
                        name,
                        data_url,
                        video: None,
                    })?;
                    Ok((entry, read_gallery(&app)))
                })?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                let library = render_gallery(snapshot?, &permit)?;
                Ok(json!({"item":entry,"library":library}))
            })
            .await
        }
        Request::Import => {
            wallpaper_task(_permit, move || {
                permit.check()?;
                let Some(path) = app
                    .dialog()
                    .file()
                    .add_filter("Images", &["jpg", "jpeg", "png", "webp"])
                    .blocking_pick_file()
                else {
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| invalid("Invalid selected wallpaper path"))?;
                let file =
                    File::open(&path).map_err(|_| failed("Cannot open selected wallpaper"))?;
                if !file
                    .metadata()
                    .map_err(|_| failed("Cannot inspect selected wallpaper"))?
                    .is_file()
                {
                    return Err(invalid("Select a regular wallpaper image"));
                }
                let mut bytes = Vec::new();
                file.take(LOCAL_IMAGE_LIMIT as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| failed("Cannot read selected wallpaper"))?;
                let data_url = render_local_wallpaper(&bytes)?;
                let name = local_display_name(
                    path.file_stem()
                        .and_then(|name| name.to_str())
                        .unwrap_or("Imported wallpaper"),
                );
                let (entry, snapshot) = permit.commit(|| {
                    let entry = app.state::<WallpaperStore>().add(WallpaperInput {
                        name,
                        data_url,
                        video: None,
                    })?;
                    Ok((entry, read_gallery(&app)))
                })?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                let library = render_gallery(snapshot?, &permit)?;
                Ok(json!({"cancelled":false,"item":entry,"library":library}))
            })
            .await
        }
        Request::List => {
            wallpaper_task(_permit, move || {
                let snapshot = permit.commit(|| read_gallery(&app))?;
                render_gallery(snapshot, &permit)
            })
            .await
        }
        Request::Preview { id, preview_key } => {
            wallpaper_task(_permit, move || {
                let entry = permit
                    .commit(|| select_gallery_preview(read_gallery(&app)?, &id, &preview_key))?;
                let preview =
                    render_gallery_preview(entry, &permit, gallery_previews(), gallery_preview)?;
                Ok(json!(preview))
            })
            .await
        }
        Request::Apply {
            id,
            expected_revision,
            fit,
        } => {
            wallpaper_task(_permit, move || {
                let (updated, result) = permit.commit(|| {
                    let settings = app.state::<SettingsStore>();
                    let library = app.state::<WallpaperStore>();
                    apply_gallery(
                        &settings,
                        &library,
                        &id,
                        expected_revision,
                        &fit,
                        |video, next, revision| {
                            app.state::<crate::wallpaper_video::WallpaperVideoStore>()
                                .with_video(video, || settings.save(next, revision))
                        },
                    )
                })?;
                broadcast_settings(&app, &updated);
                permit.check()?;
                Ok(json!(result))
            })
            .await
        }
        Request::Rename { id, name } => {
            wallpaper_task(_permit, move || {
                let ((updated, renamed), snapshot) = permit.commit(|| {
                    let updated = rename_image(
                        &app.state::<SettingsStore>(),
                        &app.state::<WallpaperStore>(),
                        &id,
                        name,
                    )?;
                    Ok((updated, read_gallery(&app)))
                })?;
                if let Some(updated) = updated {
                    broadcast_settings(&app, &updated);
                }
                renamed?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                render_gallery(snapshot?, &permit)
            })
            .await
        }
        Request::Remove {
            id,
            expected_revision,
        } => {
            wallpaper_task(_permit, move || {
                let ((updated, removed), snapshot) = permit.commit(|| {
                    let updated = remove_image(
                        &app.state::<SettingsStore>(),
                        &app.state::<WallpaperStore>(),
                        &id,
                        expected_revision,
                    )?;
                    Ok((updated, read_gallery(&app)))
                })?;
                // The settings write succeeded even when the later deletion failed.
                broadcast_settings(&app, &updated);
                removed?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                render_gallery(snapshot?, &permit)
            })
            .await
        }
        Request::OpenSettings => permit.commit(|| {
            app.emit_to("main", "app://workspace-route", "/settings")
                .map_err(|_| failed("Cannot open host wallpaper settings"))?;
            crate::desktop::request_show_main(&app);
            Ok(json!({"opened":true}))
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extension_resources::{decode_image, render_image};
    use image::ImageFormat;
    use std::io::Cursor;

    #[test]
    fn gallery_actions_accept_only_handles_display_names_and_valid_revisions() {
        for value in [
            json!({"action":"import", "path":"C:/private"}),
            json!({"action":"list", "url":"https://images.wikipedia.org/image.jpg"}),
            json!({"action":"open-settings", "path":"private"}),
            json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":"Image", "url":"https://images.wikipedia.org/image.jpg"}),
            json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":"Image", "path":"C:/private"}),
            json!({"action":"import-resource", "resourceId":"", "name":"Image"}),
            json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":" \t"}),
            json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":"x".repeat(121)}),
            json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":"bad\0name"}),
            json!({"action":"apply", "id":"../x", "expectedRevision":0, "fit":"cover"}),
            json!({"action":"preview", "id":"a".repeat(64), "previewKey":"../x"}),
            json!({"action":"preview", "id":"../x", "previewKey":"a".repeat(64)}),
            json!({"action":"preview", "id":"a".repeat(64)}),
            json!({"action":"preview", "id":"a".repeat(64), "previewKey":"b".repeat(64), "url":"https://example.test/image.jpg"}),
            json!({"action":"remove", "id":"a".repeat(64), "expectedRevision":-1}),
            json!({"action":"rename", "id":"a".repeat(64), "name":""}),
        ] {
            assert!(parse_request(value).is_err());
        }
        let long_name = "图".repeat(120);
        for name in [
            "海洋 / 天空",
            "https://photo.example/image.jpg",
            long_name.as_str(),
        ] {
            assert!(
                parse_request(
                    json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":name})
                )
                .is_ok()
            );
            assert!(
                parse_request(json!({"action":"rename", "id":"a".repeat(64), "name":name})).is_ok()
            );
        }
        assert!(parse_request(json!({"action":"import"})).is_ok());
        assert!(parse_request(json!({"action":"list"})).is_ok());
        assert!(
            parse_request(
                json!({"action":"preview", "id":"a".repeat(64), "previewKey":"b".repeat(64)})
            )
            .is_ok()
        );
    }
    #[test]
    fn provider_actions_are_explicitly_unsupported() {
        for value in [
            json!({"action":"sources"}),
            json!({"action":"search", "query":"forest"}),
            json!({"action":"preview", "resultId":"a".repeat(48)}),
            json!({"action":"import-remote", "pageId":123}),
            json!({"action":"download-original", "resultId":"a".repeat(48)}),
            json!({"action":"open-source", "pageId":123}),
        ] {
            assert_eq!(
                parse_request(value).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
        }
    }
    #[test]
    fn images_are_decoded_redrawn_and_connected_to_existing_library() {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(640, 360)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let data_url = render_image(&bytes, "image/png", false).unwrap();
        assert!(data_url.starts_with("data:image/jpeg;base64,"));
        assert!(data_url.len() < 96 * 1024);
        assert!(decode_image(&bytes, "image/jpeg").is_err());
        assert!(render_image(b"RIFF0000WEBPbad", "image/webp", false).is_err());
        let directory = tempfile::tempdir().unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Wallpaper".into(),
                data_url,
            })
            .unwrap();
        let settings = next_settings(
            &json!({"schemaVersion":4,"accent":"rose","backgroundIntensity":80}),
            Some(&entry),
            "contain",
        )
        .unwrap();
        assert_eq!(settings["accent"], "rose");
        assert_eq!(settings["schemaVersion"], SETTINGS_SCHEMA_VERSION);
        assert_eq!(settings["backgroundIntensity"], 80);
        assert_eq!(settings["customBackground"]["fit"], "contain");
        let custom_settings = next_settings(
            &json!({
                "schemaVersion": SETTINGS_SCHEMA_VERSION,
                "accent": "custom",
                "customAccent": "#12ABEF",
            }),
            Some(&entry),
            "cover",
        )
        .unwrap();
        assert_eq!(custom_settings["accent"], "custom");
        assert_eq!(custom_settings["customAccent"], "#12ABEF");
        assert_eq!(library.list(None).unwrap()[0].id, entry.id);
        assert!(next_settings(&json!({"schemaVersion":99}), Some(&entry), "cover").is_err());
    }
    #[test]
    fn gallery_previews_use_real_image_decoding_and_keep_a_small_thumbnail() {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(640, 360)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let stored = render_image(&bytes, "image/png", false).unwrap();
        let preview = gallery_preview(&stored).unwrap().unwrap();
        let (_, encoded) = preview.split_once(',').unwrap();
        let decoded = decode_image(&STANDARD.decode(encoded).unwrap(), "image/jpeg").unwrap();
        assert!(decoded.width() <= 320);
        assert!(decoded.height() <= 320);
        assert!(preview.len() <= 24 * 1024);
        assert!(
            gallery_preview("data:image/jpeg;base64,YmFk")
                .unwrap()
                .is_none()
        );
        assert!(
            gallery_preview("https://untrusted.test/x.jpg")
                .unwrap()
                .is_none()
        );
    }
    #[test]
    fn listing_metadata_does_not_generate_previews() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        for index in 0..3 {
            let mut bytes = Vec::new();
            image::DynamicImage::new_rgb8(32 + index, 24)
                .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Jpeg)
                .unwrap();
            library
                .add(WallpaperInput {
                    video: None,
                    name: format!("Image {index}"),
                    data_url: format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)),
                })
                .unwrap();
        }
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let result =
            render_gallery(capture_gallery(&settings, &library).unwrap(), &permit).unwrap();
        assert_eq!(result["items"].as_array().unwrap().len(), 3);
        for item in result["items"].as_array().unwrap() {
            assert!(item["dataUrl"].is_null());
            assert_eq!(item["previewKey"].as_str().unwrap().len(), 64);
        }
    }
    #[test]
    fn previews_require_an_existing_matching_cover_and_keep_invalid_images_nullable() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Undecodable cover".into(),
                data_url: "data:image/jpeg;base64,/9j/".into(),
            })
            .unwrap();
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let metadata =
            render_gallery(capture_gallery(&settings, &library).unwrap(), &permit).unwrap();
        let key = metadata["items"][0]["previewKey"].as_str().unwrap();
        for (id, preview_key) in [(&"a".repeat(64), key), (&entry.id, "wrong cover")] {
            assert_eq!(
                select_gallery_preview(
                    capture_gallery(&settings, &library).unwrap(),
                    id,
                    preview_key
                )
                .unwrap_err()
                .code,
                ErrorCode::NotFound
            );
        }
        let selected = select_gallery_preview(
            capture_gallery(&settings, &library).unwrap(),
            &entry.id,
            key,
        )
        .unwrap();
        let result = render_gallery_preview(
            selected,
            &permit,
            &GalleryPreviewCache::default(),
            gallery_preview,
        )
        .unwrap();
        assert_eq!(
            json!(result),
            json!({"id": entry.id, "previewKey": key, "dataUrl": null})
        );
        library.remove(&entry.id).unwrap();
        assert_eq!(
            select_gallery_preview(
                capture_gallery(&settings, &library).unwrap(),
                &entry.id,
                key
            )
            .unwrap_err()
            .code,
            ErrorCode::NotFound
        );
    }
    #[test]
    fn preview_capacity_does_not_reserve_the_metadata_and_save_slots() {
        let preview = wallpaper_capacity(true).unwrap();
        assert_eq!(
            wallpaper_capacity(true).unwrap_err().code,
            ErrorCode::ExtensionBusy
        );
        let first_save = wallpaper_capacity(false).unwrap();
        let second_save = wallpaper_capacity(false).unwrap();
        assert_eq!(
            wallpaper_capacity(false).unwrap_err().code,
            ErrorCode::ExtensionBusy
        );
        drop(first_save);
        let available = wallpaper_capacity(false).unwrap();
        drop((preview, second_save, available));
    }
    #[test]
    fn cancelled_wallpaper_waiters_keep_capacity_until_the_worker_finishes() {
        let capacity = Arc::new(tokio::sync::Semaphore::new(1));
        let slot = capacity.clone().try_acquire_owned().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (finish_tx, finish_rx) = std::sync::mpsc::channel();
        let waiter = tauri::async_runtime::spawn(async move {
            wallpaper_task(slot, move || {
                started_tx.send(()).unwrap();
                finish_rx.recv().unwrap();
                Ok(())
            })
            .await
        });
        started_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        waiter.abort();
        assert!(tauri::async_runtime::block_on(waiter).is_err());
        assert!(capacity.clone().try_acquire_owned().is_err());
        finish_tx.send(()).unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while capacity.available_permits() == 0 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        assert!(capacity.try_acquire_owned().is_ok());
    }
    #[test]
    fn closed_preview_requests_do_not_start_the_image_renderer() {
        let directory = tempfile::tempdir().unwrap();
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        extensions.begin_window_close("main").unwrap();
        let result = render_gallery_preview(
            Wallpaper {
                id: "a".repeat(64),
                name: "Closed request".into(),
                data_url: "data:image/jpeg;base64,/9j/".into(),
                video: None,
            },
            &permit,
            &GalleryPreviewCache::default(),
            |_| panic!("A closed service must not start image rendering"),
        );
        assert_eq!(result.unwrap_err().code, ErrorCode::ExtensionUnavailable);
    }
    #[test]
    #[ignore = "diagnostic timing baseline; run explicitly"]
    fn cold_gallery_preview_timing_baseline() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let prepared = std::time::Instant::now();
        let mut stored_bytes = 0;
        for index in 0..24 {
            let mut state = 7_u32 + index;
            let source = image::RgbImage::from_fn(1600, 900, |x, y| {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let noise = ((state >> 24) % 16) as i16 - 8;
                image::Rgb([
                    (48 + x as i16 / 10 + noise).clamp(0, 255) as u8,
                    (64 + y as i16 / 7 + noise).clamp(0, 255) as u8,
                    (176 + x as i16 / 20 - y as i16 / 20 + noise).clamp(0, 255) as u8,
                ])
            });
            let mut bytes = Vec::new();
            // 与宿主优化副本的质量档位一致；准备工作不计入列表耗时。
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 46)
                .encode_image(&source)
                .unwrap();
            let data_url = format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes));
            assert!(data_url.len() <= 96 * 1024);
            stored_bytes += data_url.len();
            library
                .add(WallpaperInput {
                    video: None,
                    name: format!("Synthetic JPEG {index}"),
                    data_url,
                })
                .unwrap();
        }
        eprintln!(
            "Prepared 24 synthetic 1600x900 JPEGs in {:.3}s; fixture time excluded",
            prepared.elapsed().as_secs_f64()
        );
        let previews = GalleryPreviewCache::default();
        let started = std::time::Instant::now();
        let snapshot = capture_gallery(&settings, &library).unwrap();
        let capture_ms = started.elapsed().as_secs_f64() * 1000.0;
        let entries = snapshot.images.clone();
        let rendering = std::time::Instant::now();
        let metadata = render_gallery(snapshot, &permit).unwrap();
        let metadata_ms = rendering.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(metadata["items"].as_array().unwrap().len(), 24);
        let mut preview_ms = Vec::new();
        let rendering = std::time::Instant::now();
        let cold = entries
            .iter()
            .cloned()
            .map(|entry| {
                json!(
                    render_gallery_preview(entry, &permit, &previews, |source| {
                        let started = std::time::Instant::now();
                        let result = gallery_preview(source);
                        preview_ms.push(started.elapsed().as_secs_f64() * 1000.0);
                        result
                    })
                    .unwrap()
                )
            })
            .collect::<Vec<_>>();
        let cold_render_ms = rendering.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(preview_ms.len(), 24);
        let started = std::time::Instant::now();
        let snapshot = capture_gallery(&settings, &library).unwrap();
        let warm_capture_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(render_gallery(snapshot, &permit).unwrap(), metadata);
        let rendering = std::time::Instant::now();
        let warm = entries
            .into_iter()
            .map(|entry| {
                json!(
                    render_gallery_preview(entry, &permit, &previews, |_| {
                        panic!("A repeated unchanged gallery should use cached previews")
                    })
                    .unwrap()
                )
            })
            .collect::<Vec<_>>();
        let warm_render_ms = rendering.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(cold, warm);
        eprintln!(
            "Gallery timing baseline: {}",
            json!({
                "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
                "items": 24,
                "sourceDimensions": [1600, 900],
                "storedDataUrlBytes": stored_bytes,
                "captureMs": capture_ms,
                "metadataRenderMs": metadata_ms,
                "metadataTotalMs": capture_ms + metadata_ms,
                "coldRenderMs": cold_render_ms,
                "coldTotalMs": capture_ms + cold_render_ms,
                "coldPreviewMeanMs": preview_ms.iter().sum::<f64>() / 24.0,
                "coldPreviewEachMs": preview_ms,
                "warmCaptureMs": warm_capture_ms,
                "warmRenderMs": warm_render_ms,
                "warmTotalMs": warm_capture_ms + warm_render_ms,
            })
        );
    }
    #[test]
    fn unchanged_gallery_thumbnails_are_reused_after_applying_another_image() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let entries = [61, 62].map(|width| {
            let mut bytes = Vec::new();
            image::DynamicImage::new_rgb8(width, 37)
                .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
                .unwrap();
            library
                .add(WallpaperInput {
                    video: None,
                    name: format!("Image {width}"),
                    data_url: render_image(&bytes, "image/png", false).unwrap(),
                })
                .unwrap()
        });
        let renders = std::cell::Cell::new(0);
        let previews = GalleryPreviewCache::default();
        let preview = |source: &str| {
            renders.set(renders.get() + 1);
            gallery_preview(source)
        };
        let first = render_gallery(capture_gallery(&settings, &library).unwrap(), &permit).unwrap();
        let first_previews = entries
            .iter()
            .cloned()
            .map(|entry| json!(render_gallery_preview(entry, &permit, &previews, preview).unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(renders.get(), 2);
        assert_eq!(first["revision"], 0);
        assert_eq!(first["items"][0]["active"], false);
        assert_eq!(first["items"][1]["active"], false);
        apply_settings(&settings, &library, &entries[1].id, 0, "contain").unwrap();
        let applied =
            render_gallery(capture_gallery(&settings, &library).unwrap(), &permit).unwrap();
        let repeated_previews = entries
            .iter()
            .cloned()
            .map(|entry| json!(render_gallery_preview(entry, &permit, &previews, preview).unwrap()))
            .collect::<Vec<_>>();
        assert_eq!(applied["revision"], 1);
        assert_eq!(applied["items"][0]["active"], false);
        assert_eq!(applied["items"][1]["active"], true);
        assert_eq!(repeated_previews, first_previews);
        assert_eq!(renders.get(), 2, "Applying must reuse unchanged thumbnails");
    }
    #[test]
    fn changed_video_cover_uses_a_new_preview_without_changing_wallpaper_identity() {
        let directory = tempfile::tempdir().unwrap();
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let video = WallpaperVideo {
            id: "a".repeat(64),
            mime: crate::wallpapers::WallpaperVideoMime::Mp4,
        };
        let previews = GalleryPreviewCache::default();
        let renders = std::cell::Cell::new(0);
        let render = |source: &str| {
            renders.set(renders.get() + 1);
            Ok(Some(format!("preview:{source}")))
        };
        let snapshot = |cover: &str| GallerySnapshot {
            revision: 1,
            active_id: Some("video-wallpaper".into()),
            images: vec![Wallpaper {
                id: "video-wallpaper".into(),
                name: "Video".into(),
                data_url: cover.into(),
                video: Some(video.clone()),
            }],
        };
        let old_key = gallery_preview_key("first cover");
        let new_key = gallery_preview_key("new cover");
        let first_entry =
            select_gallery_preview(snapshot("first cover"), "video-wallpaper", &old_key).unwrap();
        let first = json!(render_gallery_preview(first_entry, &permit, &previews, render).unwrap());
        assert_eq!(
            select_gallery_preview(snapshot("new cover"), "video-wallpaper", &old_key)
                .unwrap_err()
                .code,
            ErrorCode::NotFound
        );
        let changed_entry =
            select_gallery_preview(snapshot("new cover"), "video-wallpaper", &new_key).unwrap();
        let changed =
            json!(render_gallery_preview(changed_entry, &permit, &previews, render).unwrap());
        let repeated_entry =
            select_gallery_preview(snapshot("new cover"), "video-wallpaper", &new_key).unwrap();
        let repeated =
            json!(render_gallery_preview(repeated_entry, &permit, &previews, render).unwrap());
        assert_eq!(first["dataUrl"], "preview:first cover");
        assert_eq!(changed["dataUrl"], "preview:new cover");
        assert_ne!(first["previewKey"], changed["previewKey"]);
        assert_eq!(repeated, changed);
        assert_eq!(renders.get(), 2);
    }
    #[test]
    fn unavailable_gallery_previews_are_not_cached() {
        for result in [
            Ok(None),
            Err(NativeError::new(ErrorCode::ExtensionBusy, "Busy")),
            Err(NativeError::new(
                ErrorCode::ExtensionImageInvalid,
                "Invalid",
            )),
        ] {
            let previews = GalleryPreviewCache::default();
            let first = previews.get_or_render("source", |_| result);
            assert!(first.is_err() || first.unwrap().is_none());
            assert_eq!(
                previews
                    .get_or_render("source", |_| Ok(Some("recovered preview".into())))
                    .unwrap(),
                Some("recovered preview".into())
            );
            assert_eq!(
                previews
                    .get_or_render("source", |_| panic!("Successful previews should be reused"))
                    .unwrap(),
                Some("recovered preview".into())
            );
        }
    }
    #[test]
    fn gallery_preview_cache_evicts_old_entries_and_skips_oversized_previews() {
        let previews = GalleryPreviewCache::default();
        for index in 0..49 {
            previews
                .get_or_render(&format!("source:{index}"), |_| {
                    Ok(Some(format!("preview:{index}")))
                })
                .unwrap();
        }
        assert_eq!(
            previews
                .get_or_render("source:48", |_| panic!(
                    "The latest preview should remain cached"
                ))
                .unwrap(),
            Some("preview:48".into())
        );
        assert_eq!(
            previews
                .get_or_render("source:0", |_| Ok(Some("regenerated preview".into())))
                .unwrap(),
            Some("regenerated preview".into())
        );
        let renders = std::cell::Cell::new(0);
        for _ in 0..2 {
            let result = previews
                .get_or_render("large source", |_| {
                    renders.set(renders.get() + 1);
                    Ok(Some("x".repeat(24 * 1024 + 1)))
                })
                .unwrap();
            assert_eq!(result.unwrap().len(), 24 * 1024 + 1);
        }
        assert_eq!(renders.get(), 2);
    }
    #[test]
    fn gallery_preview_rendering_does_not_hold_the_cache_mutex() {
        let previews = GalleryPreviewCache::default();
        previews
            .get_or_render("source", |_| {
                assert!(previews.entries.try_lock().is_ok());
                Ok(Some("preview".into()))
            })
            .unwrap();
    }
    #[test]
    fn busy_previews_do_not_replace_a_valid_gallery_with_missing_images() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let saved = library
            .add(WallpaperInput {
                video: None,
                name: "保留图片".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let previews = GalleryPreviewCache::default();
        let metadata =
            render_gallery(capture_gallery(&settings, &library).unwrap(), &permit).unwrap();
        let failed = render_gallery_preview(saved.clone(), &permit, &previews, |_| {
            Err(NativeError::new(
                ErrorCode::ExtensionBusy,
                "Image processing is busy",
            ))
        });
        assert_eq!(failed.unwrap_err().code, ErrorCode::ExtensionBusy);
        assert_eq!(library.list(None).unwrap(), vec![saved.clone()]);
        assert_eq!(
            render_gallery(capture_gallery(&settings, &library).unwrap(), &permit).unwrap(),
            metadata
        );
        let retried = render_gallery_preview(saved, &permit, &previews, gallery_preview).unwrap();
        assert!(retried.data_url.is_some());
    }
    #[test]
    fn applying_returns_only_the_durable_selection_and_revision() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Saved selection".into(),
                data_url: format!(
                    "data:image/jpeg;base64,{}",
                    STANDARD.encode([0xff, 0xd8, 0xff])
                ),
            })
            .unwrap();
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let permit = ServicePermit::for_test(
            extensions
                .begin_service(extensions.window_run_token("main".into()).unwrap())
                .unwrap(),
        );
        let (updated, result) = permit
            .commit(|| {
                apply_gallery(
                    &settings,
                    &library,
                    &entry.id,
                    0,
                    "contain",
                    |_, next, revision| settings.save(next, revision),
                )
            })
            .unwrap();
        permit.check().unwrap();
        let response = json!(result);
        assert_eq!(
            response,
            json!({"applied": true, "activeId": entry.id, "revision": 1})
        );
        let durable = SettingsStore::open(settings_path)
            .unwrap()
            .snapshot()
            .unwrap();
        assert_eq!(durable, updated);
        assert_eq!(
            durable.settings["customBackground"]["dataUrl"],
            entry.data_url
        );
    }
    #[test]
    fn applying_gallery_image_uses_real_settings_cas_without_overwriting_other_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let first = settings
            .save(
                json!({"schemaVersion":3,"accent":"rose","language":"en"}),
                0,
            )
            .unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let mut png = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Test wallpaper".into(),
                data_url: render_image(&png, "image/png", false).unwrap(),
            })
            .unwrap();
        let updated =
            apply_settings(&settings, &library, &entry.id, first.revision, "contain").unwrap();
        assert_eq!(updated.settings["accent"], "rose");
        assert_eq!(updated.settings["language"], "en");
        assert_eq!(updated.settings["background"], "custom");
        let persisted = std::fs::read(&settings_path).unwrap();
        assert_eq!(
            apply_settings(&settings, &library, &entry.id, first.revision, "cover")
                .unwrap_err()
                .code,
            ErrorCode::SettingsConflict
        );
        assert_eq!(std::fs::read(&settings_path).unwrap(), persisted);
        assert_eq!(
            SettingsStore::open(settings_path)
                .unwrap()
                .snapshot()
                .unwrap(),
            updated
        );
    }
    #[test]
    fn applying_rejects_missing_selections_and_future_settings_before_save() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let original = settings.save(json!({"schemaVersion": 3}), 0).unwrap();
        let persisted = std::fs::read(&settings_path).unwrap();
        let missing = apply_gallery(
            &settings,
            &library,
            &"a".repeat(64),
            original.revision,
            "cover",
            |_, _, _| panic!("Missing selections must not reach the save guard"),
        );
        assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(std::fs::read(&settings_path).unwrap(), persisted);
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Future selection".into(),
                data_url: format!(
                    "data:image/jpeg;base64,{}",
                    STANDARD.encode([0xff, 0xd8, 0xff])
                ),
            })
            .unwrap();
        let future = settings
            .save(
                json!({"schemaVersion": 99, "future": true}),
                original.revision,
            )
            .unwrap();
        let persisted = std::fs::read(&settings_path).unwrap();
        let rejected = apply_gallery(
            &settings,
            &library,
            &entry.id,
            future.revision,
            "cover",
            |_, _, _| panic!("Future settings must not reach the save guard"),
        );
        assert_eq!(rejected.unwrap_err().code, ErrorCode::InvalidArgument);
        assert_eq!(std::fs::read(settings_path).unwrap(), persisted);
        assert_eq!(settings.snapshot().unwrap(), future);
    }
    #[test]
    fn applying_propagates_the_selected_video_guard_failure_without_saving() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let video = WallpaperVideo {
            id: "a".repeat(64),
            mime: crate::wallpapers::WallpaperVideoMime::Mp4,
        };
        let entry = library
            .add(WallpaperInput {
                video: Some(video.clone()),
                name: "Guarded video".into(),
                data_url: format!(
                    "data:image/jpeg;base64,{}",
                    STANDARD.encode([0xff, 0xd8, 0xff])
                ),
            })
            .unwrap();
        let original = settings.save(json!({"schemaVersion": 3}), 0).unwrap();
        let persisted = std::fs::read(&settings_path).unwrap();
        let rejected = apply_gallery(
            &settings,
            &library,
            &entry.id,
            original.revision,
            "cover",
            |selected_video, _, _| {
                assert_eq!(selected_video, Some(&video));
                Err(invalid("Video import is unavailable"))
            },
        );
        assert_eq!(rejected.unwrap_err().code, ErrorCode::InvalidArgument);
        assert_eq!(std::fs::read(settings_path).unwrap(), persisted);
        assert_eq!(settings.snapshot().unwrap(), original);
        assert_eq!(library.list(None).unwrap(), vec![entry]);
    }
    #[test]
    fn applying_reuses_the_validated_selection_for_the_video_guard_and_receipt() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library_path = directory.path().join("wallpapers.json");
        let library = WallpaperStore::new(library_path.clone());
        let video = WallpaperVideo {
            id: "a".repeat(64),
            mime: crate::wallpapers::WallpaperVideoMime::Mp4,
        };
        let entry = library
            .add(WallpaperInput {
                video: Some(video.clone()),
                name: "Video cover".into(),
                data_url: format!(
                    "data:image/jpeg;base64,{}",
                    STANDARD.encode([0xff, 0xd8, 0xff])
                ),
            })
            .unwrap();
        let (updated, result) = apply_gallery(
            &settings,
            &library,
            &entry.id,
            0,
            "contain",
            |selected_video, next, revision| {
                assert_eq!(selected_video, Some(&video));
                let saved = settings.save(next, revision)?;
                // 保存后回执不再读取可能已由其他操作改变的图库，也不解码无效封面。
                std::fs::write(&library_path, b"{changed after commit").unwrap();
                Ok(saved)
            },
        )
        .unwrap();
        assert_eq!(updated.revision, 1);
        assert_eq!(
            json!(result),
            json!({"applied": true, "activeId": entry.id, "revision": 1})
        );
        assert_eq!(updated.settings["customBackground"]["fit"], "contain");
        assert_eq!(settings.snapshot().unwrap(), updated);
    }
    #[test]
    fn renaming_the_current_image_syncs_only_its_name_and_other_images_leave_settings_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let images = [("Current", 64), ("Other", 80)]
            .into_iter()
            .map(|(name, width)| {
                let mut bytes = Vec::new();
                image::DynamicImage::new_rgb8(width, 36)
                    .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
                    .unwrap();
                library
                    .add(WallpaperInput {
                        video: None,
                        name: name.into(),
                        data_url: render_image(&bytes, "image/png", false).unwrap(),
                    })
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let original = settings
            .save(
                json!({"schemaVersion":3,"accent":"rose","language":"en"}),
                0,
            )
            .unwrap();
        let active = apply_settings(
            &settings,
            &library,
            &images[0].id,
            original.revision,
            "contain",
        )
        .unwrap();
        let (updated, renamed) =
            rename_image(&settings, &library, &images[0].id, "New current".into()).unwrap();
        renamed.unwrap();
        let updated = updated.unwrap();
        let mut expected = active.settings;
        expected["customBackground"]["name"] = json!("New current");
        assert_eq!(updated.revision, active.revision + 1);
        assert_eq!(updated.settings, expected);
        assert_eq!(settings.snapshot().unwrap(), updated);
        assert_eq!(library.list(None).unwrap()[0].name, "New current");
        let persisted = std::fs::read(&settings_path).unwrap();
        let (unchanged, renamed) =
            rename_image(&settings, &library, &images[1].id, "New other".into()).unwrap();
        renamed.unwrap();
        assert!(unchanged.is_none());
        assert_eq!(settings.snapshot().unwrap(), updated);
        assert_eq!(std::fs::read(&settings_path).unwrap(), persisted);
        assert_eq!(library.list(None).unwrap()[1].name, "New other");
        assert_eq!(
            SettingsStore::open(settings_path)
                .unwrap()
                .snapshot()
                .unwrap(),
            updated
        );
    }
    #[test]
    fn removing_current_gallery_image_requires_current_revision_and_restores_plain_background() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "海洋 / 天空".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let original = settings
            .save(json!({"schemaVersion":3,"accent":"rose"}), 0)
            .unwrap();
        let active =
            apply_settings(&settings, &library, &entry.id, original.revision, "cover").unwrap();
        let persisted = std::fs::read(&settings_path).unwrap();
        assert_eq!(
            remove_image(&settings, &library, &entry.id, original.revision)
                .unwrap_err()
                .code,
            ErrorCode::SettingsConflict
        );
        assert_eq!(std::fs::read(&settings_path).unwrap(), persisted);
        assert_eq!(library.list(None).unwrap().len(), 1);
        let (cleared, removed) =
            remove_image(&settings, &library, &entry.id, active.revision).unwrap();
        removed.unwrap();
        assert_eq!(cleared.settings["background"], "plain");
        assert_eq!(cleared.settings["customBackground"], Value::Null);
        assert_eq!(cleared.settings["accent"], "rose");
        assert!(library.list(None).unwrap().is_empty());
        assert_eq!(
            SettingsStore::open(settings_path)
                .unwrap()
                .snapshot()
                .unwrap(),
            cleared
        );
        assert!(next_settings(&json!({"schemaVersion":99}), None, "cover").is_err());
    }
    #[test]
    fn same_poster_videos_keep_distinct_active_rename_and_removal_identity() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let poster = render_image(&bytes, "image/png", false).unwrap();
        let entries = [
            None,
            Some(WallpaperVideo {
                id: "a".repeat(64),
                mime: crate::wallpapers::WallpaperVideoMime::Mp4,
            }),
            Some(WallpaperVideo {
                id: "b".repeat(64),
                mime: crate::wallpapers::WallpaperVideoMime::Mp4,
            }),
        ]
        .into_iter()
        .enumerate()
        .map(|(index, video)| {
            library
                .add(WallpaperInput {
                    name: format!("Wallpaper {index}"),
                    data_url: poster.clone(),
                    video,
                })
                .unwrap()
        })
        .collect::<Vec<_>>();
        let active = apply_settings(&settings, &library, &entries[1].id, 0, "contain").unwrap();
        assert_eq!(
            capture_gallery(&settings, &library).unwrap().active_id,
            Some(entries[1].id.clone())
        );
        for entry in [&entries[0], &entries[2]] {
            let (updated, renamed) =
                rename_image(&settings, &library, &entry.id, "Other wallpaper".into()).unwrap();
            renamed.unwrap();
            assert!(updated.is_none());
            assert_eq!(settings.snapshot().unwrap(), active);
        }
        let mut revision = active.revision;
        for entry in [&entries[0], &entries[2]] {
            let (updated, removed) =
                remove_image(&settings, &library, &entry.id, revision).unwrap();
            removed.unwrap();
            revision = updated.revision;
            assert_eq!(updated.settings, active.settings);
            assert_eq!(
                capture_gallery(&settings, &library).unwrap().active_id,
                Some(entries[1].id.clone())
            );
        }
        let (updated, renamed) =
            rename_image(&settings, &library, &entries[1].id, "Current video".into()).unwrap();
        renamed.unwrap();
        let updated = updated.unwrap();
        assert_eq!(
            updated.settings["customBackground"]["name"],
            "Current video"
        );
        assert_eq!(
            updated.settings["customBackground"]["video"],
            json!(entries[1].video)
        );
        let (cleared, removed) =
            remove_image(&settings, &library, &entries[1].id, updated.revision).unwrap();
        removed.unwrap();
        assert_eq!(cleared.settings["background"], "plain");
        assert_eq!(cleared.settings["customBackground"], Value::Null);
    }
    #[test]
    fn stale_inactive_removal_cannot_delete_an_image_applied_after_its_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let settings =
            Arc::new(SettingsStore::open(directory.path().join("settings.json")).unwrap());
        let library = Arc::new(WallpaperStore::new(
            directory.path().join("wallpapers.json"),
        ));
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Concurrently selected wallpaper".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let original = settings
            .save(json!({"schemaVersion":3,"accent":"rose"}), 0)
            .unwrap();
        let captured = Arc::new(std::sync::Barrier::new(2));
        let applied = Arc::new(std::sync::Barrier::new(2));
        let remover = {
            let settings = settings.clone();
            let library = library.clone();
            let captured = captured.clone();
            let applied = applied.clone();
            let id = entry.id.clone();
            std::thread::spawn(move || {
                let snapshot = settings.snapshot().unwrap();
                captured.wait();
                applied.wait();
                remove_image_from_snapshot(&settings, &library, &id, original.revision, snapshot)
            })
        };
        captured.wait();
        // Ordinary settings writes do not hold the extension service window lock.
        let active = settings
            .save(
                next_settings(&original.settings, Some(&entry), "cover").unwrap(),
                original.revision,
            )
            .unwrap();
        applied.wait();
        let removed = remover.join().unwrap();
        assert_eq!(
            removed
                .expect_err("A stale removal must not delete the newly selected image")
                .code,
            ErrorCode::SettingsConflict,
        );
        assert_eq!(settings.snapshot().unwrap(), active);
        assert_eq!(library.list(None).unwrap(), vec![entry]);
    }
    #[test]
    fn inactive_removal_advances_revision_and_rejects_a_waiting_old_settings_save() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Inactive image".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let original = settings
            .save(
                json!({"schemaVersion":3,"accent":"rose","background":"plain"}),
                0,
            )
            .unwrap();
        let (updated, removed) =
            remove_image(&settings, &library, &entry.id, original.revision).unwrap();
        removed.unwrap();
        assert_eq!(updated.revision, original.revision + 1);
        assert_eq!(updated.settings, original.settings);
        assert!(library.list(None).unwrap().is_empty());
        assert_eq!(
            settings
                .save(
                    next_settings(&original.settings, Some(&entry), "cover").unwrap(),
                    original.revision,
                )
                .unwrap_err()
                .code,
            ErrorCode::SettingsConflict,
        );
        assert_eq!(settings.snapshot().unwrap(), updated);
        assert_eq!(
            SettingsStore::open(settings_path)
                .unwrap()
                .snapshot()
                .unwrap(),
            updated
        );
    }
    #[test]
    fn a_settings_observer_during_removal_cannot_reapply_the_deleted_image() {
        let directory = tempfile::tempdir().unwrap();
        let settings =
            Arc::new(SettingsStore::open(directory.path().join("settings.json")).unwrap());
        let library = Arc::new(WallpaperStore::new(
            directory.path().join("wallpapers.json"),
        ));
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Not yet removed".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let original = settings
            .save(json!({"schemaVersion":3,"background":"plain"}), 0)
            .unwrap();
        let started = Arc::new(std::sync::Barrier::new(2));
        let resume = Arc::new(std::sync::Barrier::new(2));
        let removing = {
            let settings = settings.clone();
            let library = library.clone();
            let started = started.clone();
            let resume = resume.clone();
            let id = entry.id.clone();
            std::thread::spawn(move || {
                settings.save_and(original.settings, original.revision, || {
                    started.wait();
                    resume.wait();
                    library.remove(&id)
                })
            })
        };
        started.wait();
        // A newly opened settings page can still see the image before deletion.
        let observed = settings.snapshot().unwrap();
        assert_eq!(library.list(None).unwrap(), vec![entry.clone()]);
        let applying = {
            let settings = settings.clone();
            std::thread::spawn(move || {
                settings.save(
                    next_settings(&observed.settings, Some(&entry), "cover").unwrap(),
                    observed.revision,
                )
            })
        };
        resume.wait();
        let (updated, removed) = removing.join().unwrap().unwrap();
        removed.unwrap();
        assert_eq!(
            applying
                .join()
                .unwrap()
                .expect_err(
                    "A revision published before deletion must not authorize reapplying the image"
                )
                .code,
            ErrorCode::SettingsConflict,
        );
        assert!(library.list(None).unwrap().is_empty());
        assert_eq!(settings.snapshot().unwrap(), updated);
    }
    #[test]
    fn failed_settings_save_keeps_the_image_and_the_last_committed_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let archived_path = directory.path().join("saved-settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                video: None,
                name: "Kept on I/O failure".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let original = settings
            .save(json!({"schemaVersion":3,"accent":"rose"}), 0)
            .unwrap();
        std::fs::rename(&settings_path, &archived_path).unwrap();
        std::fs::create_dir(&settings_path).unwrap();
        assert_eq!(
            remove_image(&settings, &library, &entry.id, original.revision)
                .unwrap_err()
                .code,
            ErrorCode::StorageIo,
        );
        assert_eq!(settings.snapshot().unwrap(), original);
        assert_eq!(library.list(None).unwrap(), vec![entry]);
        std::fs::remove_dir(&settings_path).unwrap();
        std::fs::rename(&archived_path, &settings_path).unwrap();
        assert_eq!(
            SettingsStore::open(settings_path)
                .unwrap()
                .snapshot()
                .unwrap(),
            original
        );
    }
    #[test]
    fn future_settings_and_corrupt_libraries_are_not_changed_by_removal() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let library_path = directory.path().join("wallpapers.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let library = WallpaperStore::new(library_path.clone());
        let original = settings
            .save(json!({"schemaVersion":99,"future":true}), 0)
            .unwrap();
        let persisted = std::fs::read(&settings_path).unwrap();
        assert_eq!(
            remove_image(&settings, &library, &"a".repeat(64), original.revision)
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgument,
        );
        assert!(!library_path.exists());
        assert_eq!(std::fs::read(&settings_path).unwrap(), persisted);
        let settings = SettingsStore::open(directory.path().join("current-settings.json")).unwrap();
        let current = settings.save(json!({"schemaVersion":3}), 0).unwrap();
        std::fs::write(&library_path, b"{broken").unwrap();
        assert_eq!(
            remove_image(&settings, &library, &"a".repeat(64), current.revision)
                .unwrap_err()
                .code,
            ErrorCode::StorageCorrupt,
        );
        assert_eq!(settings.snapshot().unwrap(), current);
        assert_eq!(std::fs::read(library_path).unwrap(), b"{broken");
    }
    #[test]
    fn preview_work_does_not_hold_commit_lock_or_reply_to_a_closed_window_after_a_saved_write() {
        let directory = tempfile::tempdir().unwrap();
        let settings = SettingsStore::open(directory.path().join("settings.json")).unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let extensions =
            crate::extensions::ExtensionStore::new(directory.path().join("extensions"), false);
        let activity = extensions
            .begin_service(extensions.window_run_token("main".into()).unwrap())
            .unwrap();
        let permit = ServicePermit::for_test(activity);
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let data_url = render_image(&bytes, "image/png", false).unwrap();
        let (saved, snapshot) = permit
            .commit(|| {
                let saved = library.add(WallpaperInput {
                    video: None,
                    name: "保留已完成的图库写入".into(),
                    data_url,
                })?;
                Ok((saved, capture_gallery(&settings, &library)?))
            })
            .unwrap();
        // 在预览处理期间明确等待关闭完成；若仍持提交锁，关闭无法回执，测试会失败。
        let (preview_started_tx, preview_started_rx) = std::sync::mpsc::sync_channel(0);
        let (closed_tx, closed_rx) = std::sync::mpsc::sync_channel(0);
        let closing = extensions.clone();
        let closer = std::thread::spawn(move || {
            preview_started_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            closing.begin_window_close("main").unwrap();
            closed_tx.send(()).unwrap();
        });
        let entry =
            select_gallery_preview(snapshot, &saved.id, &gallery_preview_key(&saved.data_url))
                .unwrap();
        let result =
            render_gallery_preview(entry, &permit, &GalleryPreviewCache::default(), |_| {
                preview_started_tx.send(()).unwrap();
                closed_rx
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .unwrap();
                Ok(Some("预览完成".into()))
            });
        closer.join().unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::ExtensionUnavailable);
        assert_eq!(library.list(None).unwrap(), vec![saved]);
    }
}
