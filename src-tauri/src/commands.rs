//! Renderer-facing commands. DTOs and stable error codes are exported from Rust.

use tauri::{Emitter, Manager, State};

use crate::{
    database::{Database, Note, NoteInput, NoteUpdate},
    desktop::{self, DesktopStatus},
    diagnostics::{self, DiagnosticsReport, DiagnosticsState, FrontendError},
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    storage::{JsonValue, SETTINGS_EVENT, SettingsSnapshot, SettingsStore},
    updater::{UpdateManager, UpdateProgress, UpdateStatus},
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
    store: State<'_, SettingsStore>,
    settings: JsonValue,
    expected_revision: i32,
) -> NativeResult<SettingsSnapshot> {
    let settings = serde_json::to_value(settings).map_err(|e| {
        NativeError::operation(ErrorCode::InvalidArgument, "Settings JSON is invalid", e)
    })?;
    let snapshot = store.save(settings, expected_revision)?;
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
}

#[tauri::command]
#[specta::specta]
pub async fn list_notes(
    database: State<'_, Database>,
    search: Option<String>,
) -> NativeResult<Vec<Note>> {
    database.list(search.as_deref().unwrap_or_default())
}

#[tauri::command]
#[specta::specta]
pub async fn create_note(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    input: NoteInput,
) -> NativeResult<Note> {
    let note = database.create(input)?;
    let _ = app.emit("app://notes-changed", ());
    Ok(note)
}

#[tauri::command]
#[specta::specta]
pub async fn update_note(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    input: NoteUpdate,
) -> NativeResult<Note> {
    let note = database.update(input)?;
    let _ = app.emit("app://notes-changed", ());
    Ok(note)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_note(
    app: tauri::AppHandle,
    database: State<'_, Database>,
    id: i32,
) -> NativeResult<()> {
    database.delete(id)?;
    let _ = app.emit("app://notes-changed", ());
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn open_secondary_window(app: tauri::AppHandle) -> NativeResult<()> {
    desktop::open_secondary(&app)
}

#[tauri::command]
#[specta::specta]
pub fn get_desktop_status(app: tauri::AppHandle) -> NativeResult<DesktopStatus> {
    Ok(desktop::status(&app))
}

#[tauri::command]
#[specta::specta]
pub async fn get_autostart_enabled(app: tauri::AppHandle) -> NativeResult<bool> {
    desktop::get_autostart(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> NativeResult<bool> {
    desktop::set_autostart(&app, enabled)
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
    diagnostics::report(&app, window.label())
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
