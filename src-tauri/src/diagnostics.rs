use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    sync::Mutex,
    time::Instant,
};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;

use crate::{
    database::Database,
    desktop::{self, DesktopStatus},
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    redaction::redact,
    storage::{DataPaths, SettingsStore},
    updater,
};

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FrontendError {
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
}

pub struct DiagnosticsState(Mutex<(Instant, u32)>);
impl Default for DiagnosticsState {
    fn default() -> Self {
        Self(Mutex::new((Instant::now(), 0)))
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub app_version: String,
    pub tauri_version: String,
    pub platform: String,
    pub architecture: String,
    pub window_label: String,
    pub settings_revision: i32,
    pub database_version: i32,
    pub desktop: DesktopStatus,
    pub autostart_enabled: Option<bool>,
    pub updater_configured: bool,
    pub recent_logs: String,
}

pub fn record(state: &DiagnosticsState, error: FrontendError) -> NativeResult<()> {
    bounded_text(&error.message, 4096, "Error message")?;
    bounded_text(
        error.stack.as_deref().unwrap_or_default(),
        8192,
        "Error stack",
    )?;
    bounded_text(
        error.component_stack.as_deref().unwrap_or_default(),
        8192,
        "Component stack",
    )?;
    let mut rate = state
        .0
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Diagnostics state is unavailable"))?;
    if rate.0.elapsed().as_secs() >= 60 {
        *rate = (Instant::now(), 0);
    }
    if rate.1 >= 30 {
        return Ok(());
    }
    rate.1 += 1;
    log::error!(target: "frontend", "{}\n{}\n{}", redact(&error.message), redact(error.stack.as_deref().unwrap_or_default()), redact(error.component_stack.as_deref().unwrap_or_default()));
    Ok(())
}

pub fn report(app: &tauri::AppHandle, label: &str) -> NativeResult<DiagnosticsReport> {
    let paths = app.state::<DataPaths>();
    let recent_logs = match File::open(paths.logs.join("app.log")) {
        Ok(mut file) => {
            let size = file
                .metadata()
                .map_err(|e| {
                    NativeError::operation(ErrorCode::StorageIo, "Cannot read log metadata", e)
                })?
                .len();
            file.seek(SeekFrom::Start(size.saturating_sub(64 * 1024)))
                .map_err(|e| {
                    NativeError::operation(ErrorCode::StorageIo, "Cannot seek log file", e)
                })?;
            let mut bytes = Vec::new();
            file.take(64 * 1024).read_to_end(&mut bytes).map_err(|e| {
                NativeError::operation(ErrorCode::StorageIo, "Cannot read recent logs", e)
            })?;
            redact(&String::from_utf8_lossy(&bytes))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(NativeError::operation(
                ErrorCode::StorageIo,
                "Cannot read application log",
                error,
            ));
        }
    };
    Ok(DiagnosticsReport {
        app_version: app.package_info().version.to_string(),
        tauri_version: tauri::VERSION.into(),
        platform: std::env::consts::OS.into(),
        architecture: std::env::consts::ARCH.into(),
        window_label: label.into(),
        settings_revision: app.state::<SettingsStore>().snapshot()?.revision,
        database_version: app.state::<Database>().version()?,
        desktop: desktop::status(app),
        autostart_enabled: desktop::get_autostart(app).ok(),
        updater_configured: updater::load_policy(&paths).is_ok_and(|value| value.is_some()),
        recent_logs,
    })
}
