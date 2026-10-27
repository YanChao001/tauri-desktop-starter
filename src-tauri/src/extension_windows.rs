//! Only the trusted host creates windows. Plugins supply data, never a window URL.
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_services::ServicePermit,
    extensions::{ExtensionInfo, ExtensionStore, ExtensionWindowSize},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::{collections::HashMap, future::Future, sync::Mutex, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, utils::config::WindowConfig};

#[derive(Default)]
pub struct ExtensionWindows {
    creation: Mutex<()>,
    // Independent from creation: window-ready geometry callbacks run while a window is built.
    sizes: Mutex<HashMap<String, ExtensionWindowSize>>,
}

impl ExtensionWindows {
    pub(crate) fn default_size(&self, label: &str) -> Option<ExtensionWindowSize> {
        self.sizes.lock().ok()?.get(label).copied()
    }

    fn remember_size(&self, label: &str, size: Option<ExtensionWindowSize>) -> NativeResult<()> {
        let mut sizes = self.sizes.lock().map_err(|_| {
            NativeError::new(ErrorCode::WindowError, "Window configuration unavailable")
        })?;
        if let Some(size) = size {
            sizes.insert(label.to_owned(), size);
        } else {
            sizes.remove(label);
        }
        Ok(())
    }
}

fn label(id: &str, command: &str) -> String {
    format!("extension-{:x}", Sha256::digest(format!("{id}:{command}")))
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ExtensionWindowRequest {
    GetState,
    SetAlwaysOnTop { enabled: bool },
}

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionWindowState {
    pub always_on_top: bool,
}

fn parse_request(value: serde_json::Value) -> NativeResult<ExtensionWindowRequest> {
    // 内部标签的单元变体会忽略多余字段；不能让 get-state 暗带任意窗口身份。
    if value.get("action").and_then(serde_json::Value::as_str) == Some("get-state")
        && value.as_object().is_none_or(|request| request.len() != 1)
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Window state requests do not accept extra fields",
        ));
    }
    serde_json::from_value(value)
        .map_err(|_| NativeError::new(ErrorCode::InvalidArgument, "Invalid window service request"))
}

fn require_own_window(item: &ExtensionInfo, caller: &str) -> NativeResult<()> {
    let owns_window = item.package.manifest.commands.iter().any(|command| {
        command.ui.as_ref().is_some_and(|ui| ui.window)
            && label(&item.package.manifest.id, &command.id) == caller
    });
    if !owns_window {
        return Err(NativeError::new(
            ErrorCode::ExtensionUnavailable,
            "Window controls require this extension's own native window",
        ));
    }
    Ok(())
}

async fn native_state(
    window: &tauri::WebviewWindow,
    request: ExtensionWindowRequest,
    permit: &ServicePermit,
) -> NativeResult<ExtensionWindowState> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let native = window.clone();
    let permit = permit.clone();
    // 在主线程执行最终校验与窗口 API，避免持有生命周期锁等待原生线程回调。
    window
        .run_on_main_thread(move || {
            let result = permit.commit(|| {
                let failed = |error| {
                    NativeError::operation(
                        ErrorCode::WindowError,
                        "Cannot update the extension window",
                        error,
                    )
                };
                if let ExtensionWindowRequest::SetAlwaysOnTop { enabled } = request {
                    native.set_always_on_top(enabled).map_err(failed)?;
                }
                Ok(ExtensionWindowState {
                    always_on_top: native.is_always_on_top().map_err(failed)?,
                })
            });
            let _ = send.send(result);
        })
        .map_err(|error| {
            NativeError::operation(ErrorCode::WindowError, "Window controls unavailable", error)
        })?;
    receive
        .await
        .map_err(|_| NativeError::new(ErrorCode::WindowError, "Window controls unavailable"))?
}

async fn confirmed_state<F, Pending>(
    enabled: bool,
    mut state: ExtensionWindowState,
    mut read: F,
) -> NativeResult<ExtensionWindowState>
where
    F: FnMut() -> Pending,
    Pending: Future<Output = NativeResult<ExtensionWindowState>>,
{
    // macOS 的 setLevel 与 Linux 窗口状态事件异步生效；只发一次设置，等待真实状态确认。
    for _ in 0..40 {
        if state.always_on_top == enabled {
            return Ok(state);
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
        state = read().await?;
    }
    if state.always_on_top == enabled {
        Ok(state)
    } else {
        Err(NativeError::new(
            ErrorCode::WindowError,
            "Window state change was not confirmed",
        ))
    }
}

pub(crate) async fn request(
    window: tauri::WebviewWindow,
    item: ExtensionInfo,
    value: serde_json::Value,
    permit: ServicePermit,
) -> NativeResult<serde_json::Value> {
    let request = parse_request(value)?;
    require_own_window(&item, window.label())?;
    let state = native_state(&window, request, &permit).await?;
    let state = match request {
        ExtensionWindowRequest::GetState => state,
        ExtensionWindowRequest::SetAlwaysOnTop { enabled } => {
            confirmed_state(enabled, state, || {
                native_state(&window, ExtensionWindowRequest::GetState, &permit)
            })
            .await?
        }
    };
    serde_json::to_value(state)
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Cannot encode window state"))
}

fn window_config(
    mut config: WindowConfig,
    id: &str,
    command: &str,
    title: String,
    size: Option<ExtensionWindowSize>,
) -> WindowConfig {
    config.label = label(id, command);
    config.url = WebviewUrl::App(format!("index.html#/extension-window/{id}/{command}").into());
    config.title = title;
    // 入口可声明初始尺寸；缺省沿用主窗口，后续由统一几何服务记忆并适配显示器。
    if let Some(size) = size {
        config.width = f64::from(size.width);
        config.height = f64::from(size.height);
    }
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
            .creation
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
        let size = item
            .package
            .manifest
            .commands
            .iter()
            .find(|command| command.id == command_id)
            .and_then(|command| command.ui.as_ref())
            .and_then(|ui| ui.window_size);
        state.remember_size(&window_label, size)?;
        let config = window_config(
            main_config,
            &id,
            &command_id,
            item.package.manifest.name,
            size,
        );
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

#[tauri::command]
#[specta::specta]
pub fn open_extension_center(app: tauri::AppHandle) -> NativeResult<()> {
    use tauri::Emitter;
    app.emit_to("main", "app://workspace-route", "/extensions")
        .map_err(|error| {
            NativeError::operation(
                ErrorCode::WindowError,
                "Cannot open extension center",
                error,
            )
        })?;
    crate::desktop::request_show_main(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::{
        ExtensionManifest, ExtensionOrigin, ExtensionPermission, ExtensionPreview,
    };
    use serde_json::json;

    fn service_item() -> ExtensionInfo {
        let manifest: ExtensionManifest = serde_json::from_value(json!({
            "formatVersion": 3, "apiVersion": 2, "minHostVersion": "0.1.7",
            "id": "test.window", "version": "1.0.0", "name": "Own window", "author": "Test",
            "description": "Own-window boundary", "permissions": [],
            "optionalPermissions": ["window:control"], "network": [],
            "commands": [{"id":"open", "title":"Open", "function":"open", "inputFormat":"json", "resultFormat":"view", "permissions":[], "ui":{"window":true,"sidebar":true}}]
        })).unwrap();
        ExtensionInfo {
            package: ExtensionPreview {
                manifest,
                sha256: "a".repeat(64),
                bytes: 1,
                ui_documents: Vec::new(),
            },
            generation: 1,
            enabled: true,
            granted_permissions: vec![ExtensionPermission::WindowControl],
            origin: ExtensionOrigin::Local,
            previous_package: None,
            previous_origin: None,
        }
    }

    #[test]
    fn window_service_requests_cannot_supply_labels_or_other_native_actions() {
        assert_eq!(
            parse_request(json!({"action":"get-state"})).unwrap(),
            ExtensionWindowRequest::GetState
        );
        for enabled in [true, false] {
            assert_eq!(
                parse_request(json!({"action":"set-always-on-top", "enabled":enabled})).unwrap(),
                ExtensionWindowRequest::SetAlwaysOnTop { enabled }
            );
        }
        for request in [
            json!({"action":"get-state", "label":"main"}),
            json!({"action":"get-state", "enabled":true}),
            json!({"action":"set-always-on-top", "enabled":true, "label":"main"}),
            json!({"action":"set-always-on-top", "enabled":"true"}),
            json!({"action":"set-always-on-top"}),
            json!({"action":"close"}),
            json!({"action":"set-size", "width":420}),
        ] {
            assert!(matches!(
                parse_request(request).unwrap_err().code,
                ErrorCode::InvalidArgument
            ));
        }
        assert_eq!(
            serde_json::to_value(ExtensionWindowState {
                always_on_top: true
            })
            .unwrap(),
            json!({"alwaysOnTop":true})
        );
    }

    #[test]
    fn only_the_installations_declared_independent_window_can_be_controlled() {
        let mut item = service_item();
        let own_label = label("test.window", "open");
        require_own_window(&item, &own_label).unwrap();
        for caller in [
            "main".to_owned(),
            "secondary".into(),
            label("test.other", "open"),
            label("test.window", "other"),
        ] {
            assert!(matches!(
                require_own_window(&item, &caller).unwrap_err().code,
                ErrorCode::ExtensionUnavailable
            ));
        }
        item.package.manifest.commands[0]
            .ui
            .as_mut()
            .unwrap()
            .window = false;
        assert!(require_own_window(&item, &own_label).is_err());
    }

    #[test]
    fn queued_window_changes_cannot_commit_after_close_pause_or_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionStore::new(directory.path().join("extensions"), false);
        let caller = label("test.window", "open");
        let token = store.window_run_token(caller.clone()).unwrap();
        let permit = ServicePermit::for_test(store.begin_service(token).unwrap());
        let mut calls = 0;
        permit
            .commit(|| {
                calls += 1;
                Ok(())
            })
            .unwrap();
        let pause = store.pause();
        assert!(
            permit
                .commit(|| {
                    calls += 1;
                    Ok(())
                })
                .is_err()
        );
        drop(pause);
        store.begin_window_close(&caller).unwrap();
        assert!(
            permit
                .commit(|| {
                    calls += 1;
                    Ok(())
                })
                .is_err()
        );
        store.reopen_window(&caller).unwrap();
        assert!(
            permit
                .commit(|| {
                    calls += 1;
                    Ok(())
                })
                .is_err()
        );
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    async fn asynchronous_window_changes_wait_for_the_actual_state() {
        let mut reads = 0;
        let state = confirmed_state(
            false,
            ExtensionWindowState {
                always_on_top: true,
            },
            || {
                reads += 1;
                std::future::ready(Ok(ExtensionWindowState {
                    always_on_top: reads < 2,
                }))
            },
        )
        .await
        .unwrap();
        assert!(!state.always_on_top);
        assert_eq!(reads, 2);
    }

    #[tokio::test]
    async fn unconfirmed_or_revoked_window_changes_do_not_return_requested_success() {
        let stale = ExtensionWindowState {
            always_on_top: false,
        };
        let error = confirmed_state(true, stale, || std::future::ready(Ok(stale)))
            .await
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::WindowError));
        let error = confirmed_state(true, stale, || {
            std::future::ready(Err(NativeError::new(
                ErrorCode::ExtensionUnavailable,
                "Window lease changed",
            )))
        })
        .await
        .unwrap_err();
        assert!(matches!(error.code, ErrorCode::ExtensionUnavailable));
    }

    #[test]
    fn labels_are_bounded_and_distinct_per_entry() {
        assert_eq!(label("starter.lab", "open"), label("starter.lab", "open"));
        assert_ne!(label("starter.lab", "open"), label("starter.lab", "game"));
        assert_eq!(label("starter.lab", "open").len(), 74);
    }

    #[test]
    fn declared_game_size_keeps_the_host_window_chrome_and_other_entry_defaults() {
        let source: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main: WindowConfig =
            serde_json::from_value(source["app"]["windows"][0].clone()).unwrap();
        let size = ExtensionWindowSize {
            width: 1100,
            height: 820,
        };
        let game = window_config(
            main.clone(),
            "market.snake",
            "play",
            "Snake".into(),
            Some(size),
        );
        let other = window_config(main.clone(), "starter.lab", "open", "Lab".into(), None);
        assert_eq!((game.width, game.height), (1100.0, 820.0));
        assert_eq!((other.width, other.height), (main.width, main.height));
        assert_eq!(game.decorations, main.decorations);
        assert_eq!(
            (game.min_width, game.min_height),
            (Some(360.0), Some(480.0))
        );

        let windows = ExtensionWindows::default();
        // Window-ready callbacks can read the entry default during the serialized build.
        let _creating = windows.creation.lock().unwrap();
        windows.remember_size(&game.label, Some(size)).unwrap();
        assert_eq!(windows.default_size(&game.label), Some(size));
        assert_eq!(windows.default_size(&other.label), None);
        windows.remember_size(&game.label, None).unwrap();
        assert_eq!(windows.default_size(&game.label), None);
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
            let config = window_config(main.clone(), "starter.lab", "open", "Lab".into(), None);
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
            assert_eq!(actual["width"], main["width"]);
            assert_eq!(actual["height"], main["height"]);
            assert_eq!(
                config.url,
                WebviewUrl::App("index.html#/extension-window/starter.lab/open".into())
            );
        }
    }
}
