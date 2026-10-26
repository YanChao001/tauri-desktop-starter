//! 明确授权的应用图库与背景设置服务；搜索和供应商规则由插件负责。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_resources::{IMAGE_LIMIT, ResourceIdentity, bounded_render_image, gallery_image},
    extension_services::ServicePermit,
    storage::{SETTINGS_EVENT, SettingsStore, future_settings_schema},
    wallpaper_commands::WALLPAPERS_EVENT,
    wallpapers::{Wallpaper, WallpaperInput, WallpaperStore},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs::File,
    io::Read,
    sync::{Arc, OnceLock},
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    List,
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
        name: value.get("name")?.as_str()?.to_owned(),
        data_url: value.get("dataUrl")?.as_str()?.to_owned(),
    })
}
struct GallerySnapshot {
    revision: i32,
    images: Vec<Wallpaper>,
    active_id: Option<String>,
}
fn capture_gallery(
    settings: &SettingsStore,
    library: &WallpaperStore,
) -> NativeResult<GallerySnapshot> {
    let snapshot = settings.snapshot()?;
    let images = library.list(legacy(&snapshot.settings))?;
    let current = snapshot
        .settings
        .pointer("/customBackground/dataUrl")
        .and_then(Value::as_str);
    let active_id = if snapshot.settings.get("background").and_then(Value::as_str) == Some("custom")
    {
        images
            .iter()
            .find(|entry| current == Some(entry.data_url.as_str()))
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
fn render_gallery(
    snapshot: GallerySnapshot,
    permit: &ServicePermit,
    mut preview: impl FnMut(&str) -> Option<String>,
) -> NativeResult<Value> {
    // 快照来自已结束的提交临界区，逐图解码和缩略图编码不能占用窗口生命周期锁。
    permit.check()?;
    let mut items = Vec::with_capacity(snapshot.images.len());
    for entry in snapshot.images {
        permit.check()?;
        let data_url = preview(&entry.data_url);
        permit.check()?;
        let active = snapshot.active_id.as_deref() == Some(entry.id.as_str());
        items.push(json!({"id":entry.id,"name":entry.name,"dataUrl":data_url,"active":active}));
    }
    permit.check()?;
    Ok(json!({"revision":snapshot.revision,"items":items,"limit":24}))
}
fn gallery_preview(data_url: &str) -> Option<String> {
    let (header, encoded) = data_url.split_once(',')?;
    let mime = match header {
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/webp;base64" => "image/webp",
        _ => return None,
    };
    let bytes = STANDARD.decode(encoded).ok()?;
    bounded_render_image(&bytes, mime, true).ok()
}
fn next_settings(settings: &Value, image: Option<&Wallpaper>, fit: &str) -> NativeResult<Value> {
    if future_settings_schema(settings) {
        return Err(invalid("Future settings schema is read-only"));
    }
    let mut value = settings.clone();
    let object = value
        .as_object_mut()
        .ok_or_else(|| invalid("Invalid settings snapshot"))?;
    object.insert("schemaVersion".into(), json!(3));
    object.insert(
        "background".into(),
        json!(if image.is_some() { "custom" } else { "plain" }),
    );
    object.insert(
        "customBackground".into(),
        image.map_or(
            Value::Null,
            |image| json!({"name":image.name,"dataUrl":image.data_url,"fit":fit}),
        ),
    );
    Ok(value)
}
fn apply_settings(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
    fit: &str,
) -> NativeResult<crate::storage::SettingsSnapshot> {
    let snapshot = settings.snapshot()?;
    let entry = library
        .list(legacy(&snapshot.settings))?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper no longer exists"))?;
    settings.save(
        next_settings(&snapshot.settings, Some(&entry), fit)?,
        expected_revision,
    )
}
fn remove_image(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
) -> NativeResult<Option<crate::storage::SettingsSnapshot>> {
    let snapshot = settings.snapshot()?;
    let entry = library
        .list(legacy(&snapshot.settings))?
        .into_iter()
        .find(|entry| entry.id == id);
    if snapshot.revision != expected_revision {
        return Err(NativeError::new(
            ErrorCode::SettingsConflict,
            "Settings changed; refresh the gallery before removing",
        ));
    }
    let changed = if entry.as_ref().is_some_and(|entry| {
        snapshot
            .settings
            .pointer("/customBackground/dataUrl")
            .and_then(Value::as_str)
            == Some(entry.data_url.as_str())
    }) {
        Some(settings.save(
            next_settings(&snapshot.settings, None, "cover")?,
            expected_revision,
        )?)
    } else {
        None
    };
    library.remove(id)?;
    Ok(changed)
}
fn broadcast_settings(app: &tauri::AppHandle, snapshot: &crate::storage::SettingsSnapshot) {
    if let Err(error) = app.emit(SETTINGS_EVENT, snapshot) {
        log::warn!("Cannot broadcast wallpaper settings: {error}");
    }
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
    static ACTIVE: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let _permit = ACTIVE
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "Wallpaper service is busy"))?;
    match request {
        Request::ImportResource { resource_id, name } => {
            let owner = owner.to_owned();
            blocking::run(move || {
                permit.check()?;
                let data_url = gallery_image(&owner, &identity, &resource_id)?;
                let (entry, snapshot) = permit.commit(|| {
                    let entry = app
                        .state::<WallpaperStore>()
                        .add(WallpaperInput { name, data_url })?;
                    Ok((entry, read_gallery(&app)))
                })?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                let library = render_gallery(snapshot?, &permit, gallery_preview)?;
                Ok(json!({"item":entry,"library":library}))
            })
            .await
        }
        Request::Import => {
            blocking::run(move || {
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
                file.take(IMAGE_LIMIT as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| failed("Cannot read selected wallpaper"))?;
                let data_url = bounded_render_image(&bytes, "", false)?;
                let name = local_display_name(
                    path.file_stem()
                        .and_then(|name| name.to_str())
                        .unwrap_or("Imported wallpaper"),
                );
                let (entry, snapshot) = permit.commit(|| {
                    let entry = app
                        .state::<WallpaperStore>()
                        .add(WallpaperInput { name, data_url })?;
                    Ok((entry, read_gallery(&app)))
                })?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                let library = render_gallery(snapshot?, &permit, gallery_preview)?;
                Ok(json!({"cancelled":false,"item":entry,"library":library}))
            })
            .await
        }
        Request::List => {
            blocking::run(move || {
                let snapshot = permit.commit(|| read_gallery(&app))?;
                render_gallery(snapshot, &permit, gallery_preview)
            })
            .await
        }
        Request::Apply {
            id,
            expected_revision,
            fit,
        } => {
            blocking::run(move || {
                let (updated, snapshot) = permit.commit(|| {
                    let updated = apply_settings(
                        &app.state::<SettingsStore>(),
                        &app.state::<WallpaperStore>(),
                        &id,
                        expected_revision,
                        &fit,
                    )?;
                    Ok((updated, read_gallery(&app)))
                })?;
                broadcast_settings(&app, &updated);
                render_gallery(snapshot?, &permit, gallery_preview)
            })
            .await
        }
        Request::Rename { id, name } => {
            blocking::run(move || {
                let snapshot = permit.commit(|| {
                    app.state::<WallpaperStore>().rename(&id, name)?;
                    Ok(read_gallery(&app))
                })?;
                let _ = app.emit(WALLPAPERS_EVENT, ());
                render_gallery(snapshot?, &permit, gallery_preview)
            })
            .await
        }
        Request::Remove {
            id,
            expected_revision,
        } => {
            blocking::run(move || {
                let (updated, snapshot) = permit.commit(|| {
                    let updated = remove_image(
                        &app.state::<SettingsStore>(),
                        &app.state::<WallpaperStore>(),
                        &id,
                        expected_revision,
                    )?;
                    Ok((updated, read_gallery(&app)))
                })?;
                if let Some(updated) = updated {
                    broadcast_settings(&app, &updated);
                }
                let _ = app.emit(WALLPAPERS_EVENT, ());
                render_gallery(snapshot?, &permit, gallery_preview)
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
                name: "Wallpaper".into(),
                data_url,
            })
            .unwrap();
        let settings = next_settings(
            &json!({"schemaVersion":3,"accent":"rose"}),
            Some(&entry),
            "contain",
        )
        .unwrap();
        assert_eq!(settings["accent"], "rose");
        assert_eq!(settings["customBackground"]["fit"], "contain");
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
        let preview = gallery_preview(&stored).unwrap();
        let (_, encoded) = preview.split_once(',').unwrap();
        let decoded = decode_image(&STANDARD.decode(encoded).unwrap(), "image/jpeg").unwrap();
        assert!(decoded.width() <= 320);
        assert!(decoded.height() <= 320);
        assert!(preview.len() <= 24 * 1024);
        assert!(gallery_preview("data:image/jpeg;base64,YmFk").is_none());
        assert!(gallery_preview("https://untrusted.test/x.jpg").is_none());
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
        let cleared = remove_image(&settings, &library, &entry.id, active.revision)
            .unwrap()
            .unwrap();
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
        let result = render_gallery(snapshot, &permit, |_| {
            preview_started_tx.send(()).unwrap();
            closed_rx
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            Some("预览完成".into())
        });
        closer.join().unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::ExtensionUnavailable);
        assert_eq!(library.list(None).unwrap(), vec![saved]);
    }
}
