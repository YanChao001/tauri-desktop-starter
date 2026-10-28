use crate::{
    blocking,
    error::NativeResult,
    wallpaper_video::{WallpaperVideoChoice, WallpaperVideoStore},
    wallpapers::{Wallpaper, WallpaperInput, WallpaperStore},
};
use tauri::{Emitter, Manager};

pub const WALLPAPERS_EVENT: &str = "app://wallpapers-changed";

#[tauri::command]
#[specta::specta]
pub async fn choose_wallpaper_video(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NativeResult<Option<WallpaperVideoChoice>> {
    crate::commands::require_host_window(window.label())?;
    blocking::run(move || {
        use tauri_plugin_dialog::DialogExt;
        let settings = app.state::<crate::storage::SettingsStore>();
        let snapshot = settings.snapshot()?;
        if crate::storage::future_settings_schema(&snapshot.settings) {
            return Err(crate::error::NativeError::new(
                crate::error::ErrorCode::InvalidArgument,
                "Future settings schema is read-only",
            ));
        }
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("MP4 / WebM video", &["mp4", "webm"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| {
            crate::error::NativeError::new(
                crate::error::ErrorCode::InvalidArgument,
                "Invalid selected video path",
            )
        })?;
        app.state::<WallpaperVideoStore>()
            .import(&path, || {
                let images = app.state::<WallpaperStore>().list(None)?;
                let references = settings
                    .wallpaper_media_cleanup_settings()
                    .ok()
                    .map(|value| {
                        let mut ids = images
                            .iter()
                            .filter_map(|entry| entry.video.as_ref().map(|video| video.id.clone()))
                            .collect::<std::collections::HashSet<_>>();
                        if let Some(id) = value
                            .pointer("/customBackground/video/id")
                            .and_then(serde_json::Value::as_str)
                        {
                            ids.insert(id.to_owned());
                        }
                        ids
                    });
                Ok(references)
            })
            .map(Some)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_wallpapers(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    legacy: Option<WallpaperInput>,
) -> NativeResult<Vec<Wallpaper>> {
    let video = legacy.as_ref().and_then(|input| input.video.clone());
    if video.is_some() {
        crate::commands::require_host_window(window.label())?;
    }
    blocking::run(move || {
        app.state::<WallpaperVideoStore>()
            .with_video(video.as_ref(), || {
                app.state::<WallpaperStore>()
                    .list_with_validation(legacy, |input| {
                        if input
                            .video
                            .as_ref()
                            .is_some_and(|video| !app.state::<WallpaperVideoStore>().exists(video))
                        {
                            return Err(crate::error::NativeError::new(
                                crate::error::ErrorCode::NotFound,
                                "Wallpaper video is unavailable",
                            ));
                        }
                        Ok(())
                    })
            })
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn add_wallpaper(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: WallpaperInput,
) -> NativeResult<Wallpaper> {
    if let Some(video) = &input.video {
        crate::commands::require_host_window(window.label())?;
        if !video.valid() {
            return Err(crate::error::NativeError::new(
                crate::error::ErrorCode::InvalidArgument,
                "Invalid wallpaper video reference",
            ));
        }
    }
    blocking::run(move || {
        let video = input.video.clone();
        let result = app
            .state::<WallpaperVideoStore>()
            .with_video(video.as_ref(), || {
                if video
                    .as_ref()
                    .is_some_and(|video| !app.state::<WallpaperVideoStore>().exists(video))
                {
                    return Err(crate::error::NativeError::new(
                        crate::error::ErrorCode::NotFound,
                        "Wallpaper video is unavailable",
                    ));
                }
                app.state::<WallpaperStore>().add(input)
            })?;
        let _ = app.emit(WALLPAPERS_EVENT, ());
        Ok(result)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn rename_wallpaper(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> NativeResult<Wallpaper> {
    blocking::run(move || {
        let result = app.state::<WallpaperStore>().rename(&id, name)?;
        let _ = app.emit(WALLPAPERS_EVENT, ());
        Ok(result)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn remove_wallpaper(app: tauri::AppHandle, id: String) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<WallpaperStore>().remove(&id)?;
        let _ = app.emit(WALLPAPERS_EVENT, ());
        Ok(())
    })
    .await
}
