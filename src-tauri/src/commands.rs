//! 面向渲染进程的命令，数据结构与稳定错误码由 Rust 统一导出。

use tauri::{Emitter, Manager, State};

use crate::{
    blocking,
    database::{Database, Note, NoteInput, NoteUpdate},
    desktop::{self, DesktopStatus},
    diagnostics::{self, DiagnosticsReport, DiagnosticsState, FrontendError},
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    storage::{JsonValue, SETTINGS_EVENT, SettingsSnapshot, SettingsStore},
    updater::{UpdateManager, UpdateProgress, UpdateStatus},
    window_geometry::{self, WindowGeometry},
};

#[tauri::command]
#[specta::specta]
pub fn greet(name: &str, language: Option<&str>) -> NativeResult<String> {
    bounded_text(name, 800, "Name")?;
    if name.chars().count() > 200 {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Name exceeds 200 characters",
        ));
    }
    if let Some(language) = language {
        bounded_text(language, 32, "Language")?;
    }
    let name = name.trim();
    let english = language == Some("en");
    if name.is_empty() {
        return Err(NativeError::new(
            ErrorCode::NameRequired,
            if english {
                "Name cannot be empty"
            } else {
                "名称不能为空"
            },
        ));
    }
    Ok(if english {
        format!("Hello, {name}! This message comes from Rust.")
    } else {
        format!("你好，{name}！这条消息来自 Rust。")
    })
}

#[tauri::command]
#[specta::specta]
pub async fn load_settings_snapshot(
    store: State<'_, SettingsStore>,
) -> NativeResult<SettingsSnapshot> {
    store.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn save_settings_snapshot(
    app: tauri::AppHandle,
    settings: JsonValue,
    expected_revision: i32,
) -> NativeResult<SettingsSnapshot> {
    let settings = serde_json::to_value(settings).map_err(|e| {
        NativeError::operation(ErrorCode::InvalidArgument, "Settings JSON is invalid", e)
    })?;
    blocking::run(move || {
        let snapshot = app
            .state::<SettingsStore>()
            .save(settings, expected_revision)?;
        if let Err(error) = desktop::refresh_tray(&app) {
            log::warn!("{error}");
        }
        if let Err(error) = app.emit(SETTINGS_EVENT, &snapshot) {
            log::warn!(
                "Could not broadcast settings revision {}: {error}",
                snapshot.revision
            );
        }
        Ok(snapshot)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn list_notes(app: tauri::AppHandle, search: Option<String>) -> NativeResult<Vec<Note>> {
    blocking::run(move || {
        app.state::<Database>()
            .list(search.as_deref().unwrap_or_default())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn create_note(app: tauri::AppHandle, input: NoteInput) -> NativeResult<Note> {
    blocking::run(move || {
        let note = app.state::<Database>().create(input)?;
        let _ = app.emit("app://notes-changed", ());
        Ok(note)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn update_note(app: tauri::AppHandle, input: NoteUpdate) -> NativeResult<Note> {
    blocking::run(move || {
        let note = app.state::<Database>().update(input)?;
        let _ = app.emit("app://notes-changed", ());
        Ok(note)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn delete_note(app: tauri::AppHandle, id: i32) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<Database>().delete(id)?;
        let _ = app.emit("app://notes-changed", ());
        Ok(())
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn open_secondary_window(app: tauri::AppHandle) -> NativeResult<()> {
    blocking::run(move || desktop::open_secondary(&app)).await
}

#[tauri::command]
#[specta::specta]
pub async fn complete_frontend_startup(window: tauri::WebviewWindow) -> NativeResult<()> {
    blocking::run(move || desktop::complete_frontend_startup(window)).await
}

#[tauri::command]
#[specta::specta]
pub async fn get_window_geometry(window: tauri::WebviewWindow) -> NativeResult<WindowGeometry> {
    blocking::run(move || window_geometry::read(window)).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_window_size(
    window: tauri::WebviewWindow,
    width: u32,
    height: u32,
) -> NativeResult<WindowGeometry> {
    blocking::run(move || window_geometry::set_size(window, f64::from(width), f64::from(height)))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn reset_window_geometry(
    window: tauri::WebviewWindow,
    center: bool,
) -> NativeResult<WindowGeometry> {
    blocking::run(move || window_geometry::reset(window, center)).await
}

#[tauri::command]
#[specta::specta]
pub fn get_desktop_status(app: tauri::AppHandle) -> NativeResult<DesktopStatus> {
    Ok(desktop::status(&app))
}

#[tauri::command]
#[specta::specta]
pub async fn get_autostart_enabled(app: tauri::AppHandle) -> NativeResult<bool> {
    blocking::run(move || desktop::get_autostart(&app)).await
}

#[tauri::command]
#[specta::specta]
pub async fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> NativeResult<bool> {
    blocking::run(move || desktop::set_autostart(&app, enabled)).await
}

#[tauri::command]
#[specta::specta]
pub fn record_frontend_error(
    state: State<'_, DiagnosticsState>,
    error: FrontendError,
) -> NativeResult<()> {
    diagnostics::record(&state, error)
}

#[tauri::command]
#[specta::specta]
pub async fn get_diagnostics_report(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> NativeResult<DiagnosticsReport> {
    let label = window.label().to_owned();
    blocking::run(move || diagnostics::report(&app, &label)).await
}

#[tauri::command]
#[specta::specta]
pub async fn check_for_update(app: tauri::AppHandle) -> NativeResult<UpdateStatus> {
    app.state::<UpdateManager>().check(&app).await
}

#[tauri::command]
#[specta::specta]
pub fn get_update_snapshot(
    manager: State<'_, UpdateManager>,
) -> NativeResult<Option<UpdateProgress>> {
    manager.snapshot()
}

#[tauri::command]
#[specta::specta]
pub async fn download_and_install_update(app: tauri::AppHandle) -> NativeResult<()> {
    app.state::<UpdateManager>().install(&app).await
}

#[tauri::command]
#[specta::specta]
pub fn relaunch_app(app: tauri::AppHandle) -> NativeResult<()> {
    app.restart();
}

#[tauri::command]
#[specta::specta]
pub fn quit_app(app: tauri::AppHandle) -> NativeResult<()> {
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn greet_contract_validates_trim_language_and_size() {
        assert_eq!(
            greet(" Ada ", Some("en")).unwrap(),
            "Hello, Ada! This message comes from Rust."
        );
        assert_eq!(
            greet(" 世界 ", None).unwrap(),
            "你好，世界！这条消息来自 Rust。"
        );
        assert_eq!(
            greet("   ", Some("en")).unwrap_err().code,
            ErrorCode::NameRequired
        );
        assert_eq!(greet("", None).unwrap_err().message, "名称不能为空");
        assert_eq!(
            greet(&"a".repeat(201), None).unwrap_err().code,
            ErrorCode::InputTooLong
        );
        assert_eq!(
            greet("Ada", Some("unknown")).unwrap(),
            greet("Ada", None).unwrap()
        );
    }
}
