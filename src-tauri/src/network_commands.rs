//! 宿主 HTTP 演示的类型化命令；沿用原插件能力的主 / 次窗口边界。

use crate::{
    demo_http::{DemoHttpState, HttpDemoRequest, HttpDemoResponse},
    error::{ErrorCode, NativeError, NativeResult},
    storage::SettingsStore,
};
use tauri::{Manager, ipc::Channel};

fn require_demo_window(label: &str) -> NativeResult<()> {
    if matches!(label, "main" | "secondary") {
        Ok(())
    } else {
        Err(NativeError::new(
            ErrorCode::PlatformUnavailable,
            "HTTP demo is available only in the main and secondary windows",
        ))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn request_demo_http(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request_id: String,
    input: HttpDemoRequest,
    on_started: Channel<()>,
) -> NativeResult<HttpDemoResponse> {
    require_demo_window(window.label())?;
    let mode = app.state::<SettingsStore>().network_mode()?;
    app.state::<DemoHttpState>()
        .request(window.label(), request_id, input, mode, on_started)
        .await
}

#[tauri::command]
#[specta::specta]
pub fn cancel_demo_http(
    state: tauri::State<'_, DemoHttpState>,
    window: tauri::WebviewWindow,
    request_id: String,
) -> NativeResult<()> {
    require_demo_window(window.label())?;
    state.cancel(window.label(), &request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_the_http_plugin_window_scope() {
        assert!(require_demo_window("main").is_ok());
        assert!(require_demo_window("secondary").is_ok());
        for label in ["notes", "notes-1", "extensions", "extension-ui-1"] {
            assert_eq!(
                require_demo_window(label).unwrap_err().code,
                ErrorCode::PlatformUnavailable
            );
        }
    }
}
