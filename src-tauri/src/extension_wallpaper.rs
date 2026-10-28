//! 明确授权的应用图库与背景设置服务；搜索和供应商规则由插件负责。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_resources::{IMAGE_LIMIT, ResourceIdentity, bounded_render_image, gallery_image},
    extension_services::ServicePermit,
    storage::{SETTINGS_EVENT, SETTINGS_SCHEMA_VERSION, SettingsStore, future_settings_schema},
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
    mut preview: impl FnMut(&str) -> NativeResult<Option<String>>,
) -> NativeResult<Value> {
    // 快照来自已结束的提交临界区，逐图解码和缩略图编码不能占用窗口生命周期锁。
    permit.check()?;
    let mut items = Vec::with_capacity(snapshot.images.len());
    for entry in snapshot.images {
        permit.check()?;
        let data_url = preview(&entry.data_url)?;
        permit.check()?;
        let active = snapshot.active_id.as_deref() == Some(entry.id.as_str());
        items.push(json!({"id":entry.id,"name":entry.name,"dataUrl":data_url,"active":active}));
    }
    permit.check()?;
    Ok(json!({"revision":snapshot.revision,"items":items,"limit":24}))
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
    let next = if entry.as_ref().is_some_and(|entry| {
        snapshot
            .settings
            .pointer("/customBackground/dataUrl")
            .and_then(Value::as_str)
            == Some(entry.data_url.as_str())
    }) {
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
    if snapshot
        .settings
        .pointer("/customBackground/dataUrl")
        .and_then(Value::as_str)
        != Some(entry.data_url.as_str())
    {
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
                render_gallery(snapshot?, &permit, gallery_preview)
            })
            .await
        }
        Request::Remove {
            id,
            expected_revision,
        } => {
            blocking::run(move || {
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
            &json!({"schemaVersion":4,"accent":"rose","backgroundIntensity":80}),
            Some(&entry),
            "contain",
        )
        .unwrap();
        assert_eq!(settings["accent"], "rose");
        assert_eq!(settings["schemaVersion"], SETTINGS_SCHEMA_VERSION);
        assert_eq!(settings["backgroundIntensity"], 80);
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
                name: "保留图片".into(),
                data_url: render_image(&bytes, "image/png", false).unwrap(),
            })
            .unwrap();
        let failed = render_gallery(
            capture_gallery(&settings, &library).unwrap(),
            &permit,
            |_| {
                Err(NativeError::new(
                    ErrorCode::ExtensionBusy,
                    "Image processing is busy",
                ))
            },
        );
        assert_eq!(failed.unwrap_err().code, ErrorCode::ExtensionBusy);
        assert_eq!(library.list(None).unwrap(), vec![saved]);
        let retried = render_gallery(
            capture_gallery(&settings, &library).unwrap(),
            &permit,
            gallery_preview,
        )
        .unwrap();
        assert!(retried["items"][0]["dataUrl"].as_str().is_some());
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
        let current = settings
            .save(json!({"schemaVersion":3}), original.revision)
            .unwrap();
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
            Ok(Some("预览完成".into()))
        });
        closer.join().unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::ExtensionUnavailable);
        assert_eq!(library.list(None).unwrap(), vec![saved]);
    }
}
