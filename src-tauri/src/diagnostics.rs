use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    sync::{Mutex, OnceLock},
    time::Instant,
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;

use crate::{
    database::Database,
    desktop::{self, DesktopStatus},
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
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

pub fn redact(text: &str) -> String {
    static URL_PATTERN: OnceLock<Regex> = OnceLock::new();
    let urls = URL_PATTERN.get_or_init(|| {
        Regex::new(r#"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s<>\"']+"#).expect("valid URL redaction pattern")
    });
    let sanitized_urls = urls.replace_all(text, |captures: &regex::Captures<'_>| {
        if let Ok(mut parsed) = url::Url::parse(&captures[0]) {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string()
        } else {
            "[url omitted]".into()
        }
    });
    static SECRET_PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = SECRET_PATTERN.get_or_init(|| Regex::new(r#"(?i)(authorization[\s\"'=:]+(?:bearer\s+)?|bearer\s+|(?:token|password|secret|api[_-]?key)[\s\"'=:]+)[^\s&\"']+"#).expect("valid redaction pattern"));
    let mut redacted = pattern
        .replace_all(&sanitized_urls, "$1[redacted]")
        .into_owned();
    for variable in ["USERPROFILE", "HOME"] {
        if let Some(value) = std::env::var_os(variable) {
            let home = value.to_string_lossy();
            if home.len() > 3 {
                redacted = redacted
                    .replace(home.as_ref(), "[home]")
                    .replace(&home.replace('\\', "/"), "[home]");
            }
        }
    }
    redacted
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_remove_common_secrets_and_home_paths() {
        let text = redact("request token=abc&password=secret Authorization: Bearer xyz");
        assert!(!text.contains("abc"));
        assert!(!text.contains("xyz"));
        if let Ok(home) = std::env::var("USERPROFILE") {
            assert!(!redact(&format!("{home}/file")).contains(&home));
        }
        assert!(text.contains("[redacted]"));
        let url =
            redact("fetch https://user:pass@example.com/path?code=oauth&session=private#secret");
        assert_eq!(url, "fetch https://example.com/path");
        assert!(!url.contains("user"));
        assert!(!url.contains("oauth"));
    }
}
