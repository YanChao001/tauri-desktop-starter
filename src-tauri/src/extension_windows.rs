//! Only the trusted host creates windows. Plugins supply data, never a window URL.
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extensions::ExtensionStore,
};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, utils::config::WindowConfig};

#[derive(Default)]
pub struct ExtensionWindows(Mutex<()>);

fn label(id: &str, command: &str) -> String {
    format!("extension-{:x}", Sha256::digest(format!("{id}:{command}")))
}

fn window_config(mut config: WindowConfig, id: &str, command: &str, title: String) -> WindowConfig {
    config.label = label(id, command);
    config.url = WebviewUrl::App(format!("index.html#/extension-window/{id}/{command}").into());
    config.title = title;
    config.width = 1000.0;
    config.height = 760.0;
    config.min_width = Some(360.0);
    config.min_height = Some(480.0);
    // 平台装饰继承主窗口；前端复用自绘标题栏，macOS 保留 Overlay 红绿灯。
    config.resizable = true;
    config.maximizable = true;
    config.minimizable = true;
    config.closable = true;
    config.visible = false;
    config.fullscreen = false;
    config.maximized = false;
    config
}

#[tauri::command]
#[specta::specta]
pub async fn open_extension_window(
    app: tauri::AppHandle,
    id: String,
    command_id: String,
    expected_sha256: String,
    expected_generation: i32,
) -> NativeResult<()> {
    blocking::run(move || {
        let state = app.state::<ExtensionWindows>();
        let _creation = state
            .0
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Window creation unavailable"))?;
        let item = app.state::<ExtensionStore>().window_entry(
            &id,
            &command_id,
            &expected_sha256,
            expected_generation,
        )?;
        let window_label = label(&id, &command_id);
        let failed = |error| {
            NativeError::operation(
                ErrorCode::WindowError,
                "Cannot open extension window",
                error,
            )
        };
        if let Some(window) = app.get_webview_window(&window_label) {
            return window
                .unminimize()
                .and_then(|()| window.show())
                .and_then(|()| window.set_focus())
                .map_err(failed);
        }
        let _lifecycle = app
            .state::<crate::lifecycle::LifecycleState>()
            .begin_window_creation()?;
        // Validated reverse-domain IDs and command IDs cannot inject URL syntax.
        let main_config = app
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == "main")
            .cloned()
            .ok_or_else(|| {
                NativeError::new(ErrorCode::WindowError, "Window configuration missing")
            })?;
        let config = window_config(main_config, &id, &command_id, item.package.manifest.name);
        #[cfg(feature = "e2e")]
        let config = {
            let mut config = config;
            config.data_directory = app
                .state::<crate::storage::DataPaths>()
                .config
                .parent()
                .map(|root| root.join("webview").join(&config.label));
            config
        };
        app.state::<ExtensionStore>().reopen_window(&window_label)?;
        let window = WebviewWindowBuilder::from_config(&app, &config)
            .map_err(failed)?
            .build()
            .map_err(failed)?;
        crate::desktop::reveal_after_timeout(window);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_are_bounded_and_distinct_per_entry() {
        assert_eq!(label("starter.lab", "open"), label("starter.lab", "open"));
        assert_ne!(label("starter.lab", "open"), label("starter.lab", "game"));
        assert_eq!(label("starter.lab", "open").len(), 74);
    }

    #[test]
    fn extension_windows_preserve_each_platforms_main_window_chrome() {
        for source in [
            include_str!("../tauri.conf.json"),
            include_str!("../tauri.macos.conf.json"),
        ] {
            let document: serde_json::Value = serde_json::from_str(source).unwrap();
            let main: WindowConfig =
                serde_json::from_value(document["app"]["windows"][0].clone()).unwrap();
            let config = window_config(main.clone(), "starter.lab", "open", "Lab".into());
            let main = serde_json::to_value(main).unwrap();
            let actual = serde_json::to_value(&config).unwrap();
            for property in ["decorations", "titleBarStyle", "hiddenTitle"] {
                assert_eq!(actual[property], main[property], "{property}");
            }
            assert!(!config.visible);
            assert!(
                config.resizable && config.minimizable && config.maximizable && config.closable
            );
            assert_eq!(config.title, "Lab");
            assert_eq!(
                config.url,
                WebviewUrl::App("index.html#/extension-window/starter.lab/open".into())
            );
        }
    }
}
