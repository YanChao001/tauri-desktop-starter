use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::Instant;

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
    window_geometry,
};

pub struct DesktopState {
    pub tray_available: AtomicBool,
    menu: Mutex<Option<TrayMenu>>,
    window_creation: Mutex<()>,
    reveal_pending: AtomicBool,
    native_ready: AtomicBool,
    main_ready: AtomicBool,
    started: Instant,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            tray_available: AtomicBool::new(false),
            menu: Mutex::new(None),
            window_creation: Mutex::new(()),
            reveal_pending: AtomicBool::new(false),
            native_ready: AtomicBool::new(false),
            main_ready: AtomicBool::new(false),
            started: Instant::now(),
        }
    }
}

pub fn log_startup(app: &tauri::AppHandle, phase: &str) {
    let state = app.state::<DesktopState>();
    log::info!(
        "Startup phase={phase} elapsed_ms={}",
        state.started.elapsed().as_millis()
    );
}

/// WebView2 创建首个窗口期间，合并重复启动请求。
/// 单实例回调在 WM_COPYDATA 中同步执行，必须立即返回，避免后续启动等待超时。
pub fn request_show_main(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    // WM_COPYDATA 可能在插件初始化期间到达，setup 会在存储与托盘就绪后创建首个窗口。
    if !state.native_ready.load(Ordering::Acquire) {
        return;
    }
    if state.reveal_pending.swap(true, Ordering::AcqRel) {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = show_main(&handle) {
            log::error!("Cannot open main window: {error}");
        }
        handle
            .state::<DesktopState>()
            .reveal_pending
            .store(false, Ordering::Release);
    });
}

pub fn start_main(app: &tauri::AppHandle) {
    app.state::<DesktopState>()
        .native_ready
        .store(true, Ordering::Release);
    request_show_main(app);
}

/// WebView2 窗口创建必须离开同步命令和事件回调，以免阻塞原生消息循环。
pub fn dispatch(app: &tauri::AppHandle, action: fn(&tauri::AppHandle) -> NativeResult<()>) {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
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
        // 重复启动需等待首帧完成，由渲染进程或三秒兜底显示窗口。
        if !state.main_ready.load(Ordering::Acquire) {
            return Ok(());
        }
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
    let _lifecycle = app
        .state::<crate::lifecycle::LifecycleState>()
        .begin_window_creation()?;
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
    if label == "main" {
        app.state::<DesktopState>()
            .main_ready
            .store(false, Ordering::Release);
        log_startup(app, "window-create-start");
    }
    app.state::<crate::extensions::ExtensionStore>()
        .reopen_window(label)?;
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| NativeError::operation(ErrorCode::WindowError, "Cannot configure window", e))?
        .build()
        .map_err(|e| NativeError::operation(ErrorCode::WindowError, "Cannot create window", e))?;
    if label == "main" {
        log_startup(app, "window-created");
    }
    if let Err(error) = window_geometry::prepare(window.clone()) {
        log::warn!("Cannot prepare initial window geometry: {error}");
    }
    reveal_after_timeout(window);
    Ok(())
}

pub fn complete_frontend_startup(window: tauri::WebviewWindow) -> NativeResult<()> {
    window_geometry::prepare(window.clone())?;
    if window.label() == "main" {
        let app = window.app_handle();
        app.state::<DesktopState>()
            .main_ready
            .store(true, Ordering::Release);
        log_startup(app, "frontend-ready");
    }
    window
        .show()
        .and_then(|()| window.set_focus())
        .map_err(|error| {
            NativeError::operation(ErrorCode::WindowError, "Cannot reveal ready window", error)
        })
}

/// 保留首帧显示兜底；用户已关闭的窗口不会再次打开。
pub fn reveal_after_timeout(window: tauri::WebviewWindow) {
    let cancelled = Arc::new(AtomicBool::new(false));
    let cancellation = cancelled.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
        ) {
            cancellation.store(true, Ordering::Release);
        }
    });
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let app = window.app_handle().clone();
        let _ = app.run_on_main_thread(move || {
            if !cancelled.load(Ordering::Acquire)
                && !window.is_visible().unwrap_or(true)
                && !window.is_minimized().unwrap_or(false)
            {
                if let Err(error) = window_geometry::before_show(&window.as_ref().window()) {
                    log::warn!("Cannot prepare fallback window geometry: {error}");
                }
                if window.label() == "main" {
                    window
                        .app_handle()
                        .state::<DesktopState>()
                        .main_ready
                        .store(true, Ordering::Release);
                    log_startup(window.app_handle(), "window-reveal-fallback");
                }
                let _ = window.show();
            }
        });
    });
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
                request_show_main(app);
            }
            "secondary" => {
                dispatch(app, open_secondary);
            }
            "quit" => {
                crate::lifecycle::request_action(app, crate::lifecycle::LifecycleAction::Quit, None)
            }
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
                request_show_main(tray.app_handle());
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
