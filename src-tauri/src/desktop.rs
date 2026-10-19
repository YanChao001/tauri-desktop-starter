use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

use serde::Serialize;
use specta::Type;
use tauri::{
    Manager, WebviewUrl, WebviewWindowBuilder,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
#[cfg(not(windows))]
use tauri_plugin_autostart::ManagerExt;

use crate::{
    error::{ErrorCode, NativeError, NativeResult},
    storage::SettingsStore,
};

#[derive(Default)]
pub struct DesktopState {
    pub tray_available: AtomicBool,
    menu: Mutex<Option<TrayMenu>>,
    window_creation: Mutex<()>,
}

/// WebView2 window creation must run outside synchronous commands and event handlers.
pub fn dispatch(app: &tauri::AppHandle, action: fn(&tauri::AppHandle) -> NativeResult<()>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = action(&handle) {
            log::warn!("{error}");
        }
    });
}

struct TrayMenu {
    show: MenuItem<tauri::Wry>,
    secondary: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

fn tray_labels(app: &tauri::AppHandle) -> [&'static str; 3] {
    let english = app
        .state::<SettingsStore>()
        .snapshot()
        .ok()
        .is_some_and(|snapshot| {
            snapshot
                .settings
                .get("language")
                .and_then(serde_json::Value::as_str)
                == Some("en")
        });
    if english {
        ["Show window", "New window", "Quit"]
    } else {
        ["显示窗口", "新窗口", "退出"]
    }
}

pub fn refresh_tray(app: &tauri::AppHandle) -> NativeResult<()> {
    let state = app.try_state::<DesktopState>().ok_or_else(|| {
        NativeError::new(
            ErrorCode::WindowError,
            "Application window state is not ready",
        )
    })?;
    let menu = state
        .menu
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Tray menu is unavailable"))?;
    if let Some(menu) = menu.as_ref() {
        let labels = tray_labels(app);
        menu.show
            .set_text(labels[0])
            .and_then(|()| menu.secondary.set_text(labels[1]))
            .and_then(|()| menu.quit.set_text(labels[2]))
            .map_err(|e| {
                NativeError::operation(ErrorCode::WindowError, "Cannot update tray language", e)
            })?;
    }
    Ok(())
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStatus {
    pub tray_available: bool,
    pub secondary_open: bool,
    pub autostart_supported: bool,
    pub run_in_background: bool,
}

pub fn show_main(app: &tauri::AppHandle) -> NativeResult<()> {
    let state = app.try_state::<DesktopState>().ok_or_else(|| {
        NativeError::new(
            ErrorCode::WindowError,
            "Application startup is not complete",
        )
    })?;
    let _creation = state
        .window_creation
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Window creation is unavailable"))?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
            .map_err(|e| {
                NativeError::operation(ErrorCode::WindowError, "Cannot show main window", e)
            })?;
    } else {
        create_window(app, "main")?;
    }
    Ok(())
}

fn create_window(app: &tauri::AppHandle, label: &str) -> NativeResult<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or_else(|| {
            NativeError::new(
                ErrorCode::WindowError,
                "Main window configuration is missing",
            )
        })?;
    let mut config = config.clone();
    config.label = label.into();
    #[cfg(feature = "e2e")]
    {
        let paths = app.state::<crate::storage::DataPaths>();
        config.data_directory = paths
            .config
            .parent()
            .map(|root| root.join("webview").join(label));
    }
    config.visible = false;
    config.url = WebviewUrl::App("index.html".into());
    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| NativeError::operation(ErrorCode::WindowError, "Cannot configure window", e))?
        .build()
        .map_err(|e| NativeError::operation(ErrorCode::WindowError, "Cannot create window", e))?;
    // The renderer reveals after loading shared preferences; retain a fallback for startup errors.
    let handle = app.clone();
    let label = label.to_owned();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let copy = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Some(window) = copy.get_webview_window(&label)
                && !window.is_visible().unwrap_or(true)
            {
                let _ = window.show();
            }
        });
    });
    Ok(())
}

pub fn open_secondary(app: &tauri::AppHandle) -> NativeResult<()> {
    let state = app.state::<DesktopState>();
    let _creation = state
        .window_creation
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Window creation is unavailable"))?;
    if let Some(window) = app.get_webview_window("secondary") {
        window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
            .map_err(|e| {
                NativeError::operation(ErrorCode::WindowError, "Cannot focus secondary window", e)
            })
    } else {
        create_window(app, "secondary")
    }
}

pub fn status(app: &tauri::AppHandle) -> DesktopStatus {
    DesktopStatus {
        tray_available: app
            .state::<DesktopState>()
            .tray_available
            .load(Ordering::Acquire),
        secondary_open: app.get_webview_window("secondary").is_some(),
        autostart_supported: !cfg!(feature = "e2e"),
        run_in_background: app.state::<SettingsStore>().run_in_background(),
    }
}

pub fn get_autostart(app: &tauri::AppHandle) -> NativeResult<bool> {
    if cfg!(feature = "e2e") {
        return Err(NativeError::new(
            ErrorCode::PlatformUnavailable,
            "Autostart is disabled in isolated test builds",
        ));
    }
    #[cfg(windows)]
    {
        crate::autostart::enabled(&app.config().identifier)
    }
    #[cfg(not(windows))]
    app.autolaunch().is_enabled().map_err(|e| {
        NativeError::operation(
            ErrorCode::AutostartError,
            "Cannot read system autostart state",
            e,
        )
    })
}

pub fn set_autostart(app: &tauri::AppHandle, enabled: bool) -> NativeResult<bool> {
    if cfg!(feature = "e2e") {
        return Err(NativeError::new(
            ErrorCode::PlatformUnavailable,
            "Autostart is disabled in isolated test builds",
        ));
    }
    #[cfg(windows)]
    {
        crate::autostart::set(&app.config().identifier, enabled)
    }
    #[cfg(not(windows))]
    {
        let manager = app.autolaunch();
        if enabled {
            manager.enable()
        } else if manager.is_enabled().unwrap_or(true) {
            manager.disable()
        } else {
            Ok(())
        }
        .map_err(|e| {
            NativeError::operation(
                ErrorCode::AutostartError,
                "Cannot change system autostart state",
                e,
            )
        })?;
        get_autostart(app)
    }
}

pub fn install_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let labels = tray_labels(app);
    let show = MenuItem::with_id(app, "show", labels[0], true, None::<&str>)?;
    let secondary = MenuItem::with_id(app, "secondary", labels[1], true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels[2], true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &secondary, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip(app.package_info().name.clone())
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                dispatch(app, show_main);
            }
            "secondary" => {
                dispatch(app, open_secondary);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                dispatch(tray.app_handle(), show_main);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    if let Ok(mut menu) = app.state::<DesktopState>().menu.lock() {
        *menu = Some(TrayMenu {
            show,
            secondary,
            quit,
        });
    }
    app.state::<DesktopState>()
        .tray_available
        .store(true, Ordering::Release);
    Ok(())
}
