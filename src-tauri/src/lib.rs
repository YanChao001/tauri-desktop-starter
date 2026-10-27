//! 应用入口，只做组装：注册插件、挂命令、启动逻辑。
//! 具体命令的实现放在 `commands.rs`，不要让这个文件变成第二个业务层。

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!(
    "The e2e WebDriver service requires a debug/test profile and must not be included in release builds"
);

mod app_config;
#[cfg(windows)]
mod autostart;
pub mod bindings;
mod blocking;
mod commands;
mod data_commands;
mod database;
mod demo_http;
mod desktop;
mod diagnostics;
mod error;
mod extension_commands;
mod extension_execution;
pub mod extension_host;
mod extension_lan;
mod extension_market;
mod extension_market_commands;
mod extension_network;
mod extension_paths;
mod extension_resources;
pub mod extension_runtime;
mod extension_services;
mod extension_storage;
pub mod extension_view;
mod extension_wallpaper;
mod extension_windows;
mod extension_worker;
pub mod extensions;
mod file_commands;
mod lifecycle;
mod network;
mod network_commands;
mod recovery;
mod redaction;
mod storage;
mod system_commands;
pub mod update_signature;
mod updater;
mod wallpaper_commands;
mod wallpapers;
mod window_geometry;
mod workbench;
mod workbench_commands;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_log::{RotationStrategy, TimezoneStrategy};
use tauri_plugin_window_state::StateFlags;

fn logging_plugin(
    target: Option<tauri_plugin_log::TargetKind>,
) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let mut targets = vec![tauri_plugin_log::Target::new(
        tauri_plugin_log::TargetKind::Stderr,
    )];
    if let Some(target) = target {
        targets.push(tauri_plugin_log::Target::new(target));
    }
    tauri_plugin_log::Builder::new()
        .targets(targets)
        .level(log::LevelFilter::Info)
        .max_file_size(1_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(3))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    #[cfg(feature = "e2e")]
    let test_root = {
        assert!(
            context.config().identifier.ends_with(".e2e"),
            "E2E requires a separate identifier"
        );
        let path = std::env::var_os("STARTER_TEST_DATA_DIR")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_absolute() && path.parent().is_some())
            .expect("E2E requires an absolute STARTER_TEST_DATA_DIR");
        for window in &mut context.config_mut().app.windows {
            window.data_directory = Some(path.join("webview").join(&window.label));
            // WKWebView 不支持 data_directory，使用非持久化存储
            // 使尚不支持 dataStoreIdentifier 的 macOS 版本也能隔离测试数据
            #[cfg(target_os = "macos")]
            {
                window.incognito = true;
            }
        }
        path
    };
    let window_state = tauri_plugin_window_state::Builder::default().with_state_flags(
        StateFlags::all()
            .difference(StateFlags::DECORATIONS | StateFlags::VISIBLE | StateFlags::SIZE),
    );
    #[cfg(feature = "e2e")]
    let window_state =
        window_state.with_filename(test_root.join("config/window-state.json").to_string_lossy());
    #[cfg(feature = "e2e")]
    let log_target = tauri_plugin_log::TargetKind::Folder {
        path: test_root.join("logs"),
        file_name: Some("app".into()),
    };
    #[cfg(not(feature = "e2e"))]
    let log_target = tauri_plugin_log::TargetKind::LogDir {
        file_name: Some("app".into()),
    };
    let builder = tauri::Builder::default()
        .manage(desktop::DesktopState::default())
        .manage(demo_http::DemoHttpState::default())
        .manage(extension_windows::ExtensionWindows::default())
        .manage(extensions::ui::ExtensionUiStore::default())
        .manage(lifecycle::LifecycleState::default())
        .manage(system_commands::ActivationInbox::default());
    let builder = extensions::ui::register_protocol(builder);

    // 单实例必须最先注册，让重复启动在初始化日志等共享资源前退出。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        system_commands::activate(app, args, &cwd, "single-instance");
        desktop::request_show_main(app);
    }));

    let builder = builder
        // 尺寸由几何模块统一持久化，避免旧物理像素存档覆盖逻辑尺寸。
        // 装饰由平台配置决定；显示时机由前端首帧和下方兜底决定。
        // 插件默认会恢复旧的 decorations，并在窗口 ready 时直接 show()
        // （没有存档时也会），因此这两项不能参与状态恢复。
        .plugin(window_state.build())
        .plugin(window_geometry::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    #[cfg(all(desktop, not(windows), not(feature = "e2e")))]
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .app_name(context.config().identifier.clone())
            .build(),
    );
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let builder = builder.setup(move |app| {
        let paths = storage::DataPaths::resolve(app.handle())?;
        // 日志目录不可写时仍可进入数据恢复界面，不能让文件日志阻断启动。
        if let Err(error) = app.handle().plugin(logging_plugin(Some(log_target))) {
            app.handle().plugin(logging_plugin(None))?;
            log::warn!(
                "File logging is unavailable; using stderr: {}",
                redaction::redact(&error.to_string())
            );
        }
        let initialized = recovery::initialize(&paths)?;
        let workbench = workbench::WorkbenchState::open(initialized.recovery.workbench_root())?;
        let system = system_commands::SystemState::open(paths.config.join("workspace.json"));
        app.manage(extensions::ExtensionStore::new(
            paths.data.join("extensions"),
            initialized.recovery.is_isolated(),
        ));
        app.manage(extension_market::ExtensionMarket::new(
            paths.data.join("extension-market"),
            initialized.recovery.is_isolated(),
        ));
        app.manage(extension_host::ExtensionHostStore::new(
            paths.data.join("extension-data"),
            initialized.recovery.is_isolated(),
            app.config().identifier.clone(),
        ));
        app.manage(extension_services::ExtensionServices::default());
        app.manage(extension_lan::ExtensionLan::new(
            paths.data.join("extension-data/lan"),
            initialized.recovery.is_isolated(),
        ));
        app.manage(wallpapers::WallpaperStore::new(
            initialized.recovery.wallpaper_path(),
        ));
        app.manage(paths);
        app.manage(initialized.recovery);
        app.manage(initialized.settings);
        app.manage(initialized.database);
        app.manage(workbench);
        app.manage(system);
        system_commands::drain_activations(app.handle());
        app.manage(diagnostics::DiagnosticsState::default());
        app.manage(updater::UpdateManager::default());
        let handle = app.handle().clone();
        app.deep_link().on_open_url(move |event| {
            system_commands::activate(
                &handle,
                event.urls().iter().map(ToString::to_string).collect(),
                "",
                "deep-link",
            );
        });
        let arguments: Vec<String> = std::env::args().skip(1).collect();
        let has_link = arguments
            .iter()
            .any(|argument| system_commands::deep_link_route(argument).is_some());
        system_commands::activate(
            app.handle(),
            arguments,
            &std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy(),
            "startup",
        );
        if !has_link && let Ok(Some(urls)) = app.deep_link().get_current() {
            system_commands::activate(
                app.handle(),
                urls.iter().map(ToString::to_string).collect(),
                "",
                "deep-link-startup",
            );
        }
        desktop::log_startup(app.handle(), "native-state-ready");
        if let Err(error) = desktop::install_tray(app.handle()) {
            log::warn!("Tray is unavailable: {error}");
        }
        // 每次启动记一条，既方便对照版本，也顺便验证日志链路是通的
        log::info!("应用启动 v{}", app.package_info().version);

        // 启动 WebView2 前完成应用状态初始化；从工作线程创建窗口
        // 使事件循环能够继续接收单实例激活请求
        desktop::start_main(app.handle());
        Ok(())
    });

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let lifecycle = app.state::<lifecycle::LifecycleState>();
                if lifecycle.active_action().is_some()
                    && !lifecycle
                        .approved_exit
                        .load(std::sync::atomic::Ordering::Acquire)
                {
                    // 协商完成后仍可能正在安装；窗口关闭不能穿透执行期的占用。
                    api.prevent_close();
                } else if matches!(window.label(), "main" | "secondary")
                    && app.state::<storage::SettingsStore>().run_in_background()
                    && desktop::status(app).tray_available
                {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        log::warn!("Cannot hide window: {error}");
                    }
                } else if app
                    .state::<lifecycle::LifecycleState>()
                    .is_dirty(Some(window.label()))
                    || window.label().starts_with("extension-")
                {
                    api.prevent_close();
                    lifecycle::request_action(
                        app,
                        lifecycle::LifecycleAction::Close,
                        Some(window.label().into()),
                    );
                }
            }
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                workbench::handle_drop(window.app_handle(), window.label(), paths.clone());
            }
            if let tauri::WindowEvent::Destroyed = event {
                window
                    .app_handle()
                    .state::<demo_http::DemoHttpState>()
                    .cancel_window(window.label());
                window
                    .app_handle()
                    .state::<extensions::ui::ExtensionUiStore>()
                    .close_window(window.label());
                if let Err(error) = window
                    .app_handle()
                    .state::<extensions::ExtensionStore>()
                    .begin_window_close(window.label())
                {
                    log::warn!("Cannot stop destroyed window extensions: {error}");
                }
                let service_owners =
                    extension_services::take_window_owners(window.app_handle(), window.label());
                tauri::async_runtime::spawn(extension_services::close_window(
                    window.app_handle().clone(),
                    service_owners,
                ));
                window
                    .app_handle()
                    .state::<lifecycle::LifecycleState>()
                    .remove_window(window.label());
                if window.label() == "secondary"
                    && !window
                        .app_handle()
                        .state::<lifecycle::LifecycleState>()
                        .approved_exit
                        .load(std::sync::atomic::Ordering::Acquire)
                {
                    window
                        .app_handle()
                        .state::<system_commands::SystemState>()
                        .secondary_closed();
                }
            }
        })
        .invoke_handler(bindings::builder().invoke_handler())
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                // App::run 在结束时直接退出进程，须在最终退出事件回收拥有的 worker。
                extension_lan::shutdown(app);
                extension_runtime::shutdown_workers();
                return;
            }
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let state = app.state::<lifecycle::LifecycleState>();
                let reservation = match state.reserve_exit() {
                    Ok(Some(reservation)) => reservation,
                    Ok(None) => {
                        api.prevent_exit();
                        lifecycle::defer_exit_for_window_creation(app, code);
                        return;
                    }
                    Err(error) => {
                        api.prevent_exit();
                        log::warn!("Cannot reserve application exit: {error}");
                        return;
                    }
                };
                let mut can_exit = true;
                if !state
                    .approved_exit
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    if let Some(action) = state.active_action() {
                        // 已授权 Close 销毁最后一个窗口后可正常退出，不能留下无窗口进程。
                        if action != lifecycle::LifecycleAction::Close
                            || !app.webview_windows().is_empty()
                        {
                            api.prevent_exit();
                            can_exit = false;
                        }
                    } else if state.is_dirty(None) {
                        api.prevent_exit();
                        drop(reservation);
                        lifecycle::request_action(app, lifecycle::LifecycleAction::Quit, None);
                        return;
                    }
                }
                if can_exit {
                    if let Err(error) = reservation.commit() {
                        api.prevent_exit();
                        log::warn!("Cannot confirm application exit: {error}");
                        return;
                    }
                    state
                        .approved_exit
                        .store(true, std::sync::atomic::Ordering::Release);
                    let store = app.state::<extensions::ExtensionStore>();
                    let initiated = store.begin_shutdown();
                    // 正常退出先拒绝新运行并取消当前任务，等 broker 和 Wasm 实际结束后退出。
                    if store.is_running() {
                        api.prevent_exit();
                        if initiated {
                            let store = store.inner().clone();
                            let handle = app.clone();
                            let exit_code = code.unwrap_or(0);
                            tauri::async_runtime::spawn_blocking(move || {
                                store.wait_stopped();
                                handle.exit(exit_code);
                            });
                        }
                    }
                }
            }
        });
}
