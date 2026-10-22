use crate::{
    blocking,
    error::NativeResult,
    wallpapers::{Wallpaper, WallpaperInput, WallpaperStore},
};
use tauri::{Emitter, Manager};

pub const WALLPAPERS_EVENT: &str = "app://wallpapers-changed";

#[tauri::command]
#[specta::specta]
pub async fn list_wallpapers(
    app: tauri::AppHandle,
    legacy: Option<WallpaperInput>,
) -> NativeResult<Vec<Wallpaper>> {
    blocking::run(move || app.state::<WallpaperStore>().list(legacy)).await
}

#[tauri::command]
#[specta::specta]
pub async fn add_wallpaper(
    app: tauri::AppHandle,
    input: WallpaperInput,
) -> NativeResult<Wallpaper> {
    blocking::run(move || {
        let result = app.state::<WallpaperStore>().add(input)?;
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
