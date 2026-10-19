//! 应用入口，只做组装：注册插件、挂命令、启动逻辑。
//! 具体命令的实现放在 `commands.rs`，不要让这个文件变成第二个业务层。

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!(
    "The e2e WebDriver service requires a debug/test profile and must not be included in release builds"
);

#[cfg(windows)]
mod autostart;
pub mod bindings;
mod commands;
mod database;
mod desktop;
mod diagnostics;
mod error;
mod storage;
pub mod update_signature;
mod updater;

use std::time::Duration;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, TimezoneStrategy};
use tauri_plugin_window_state::StateFlags;

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
            // WKWebView does not support data_directory; use a non-persistent store
            // so test runs remain isolated on macOS versions before dataStoreIdentifier.
            #[cfg(target_os = "macos")]
            {
                window.incognito = true;
            }
        }
        path
    };
    let window_state = tauri_plugin_window_state::Builder::default().with_state_flags(
        StateFlags::all().difference(StateFlags::DECORATIONS | StateFlags::VISIBLE),
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
    let builder = tauri::Builder::default();

    // 单实例必须最先注册，让重复启动在初始化日志等共享资源前退出。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        desktop::dispatch(app, desktop::show_main);
    }));

    let builder = builder
        // 其余插件初始化前启用日志，保留启动失败的排障信息
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // release 下没有控制台，文件日志是唯一的排障入口
                    // 固定文件名，避免产品名带空格或改动后日志路径对不上文档
                    tauri_plugin_log::Target::new(log_target),
                ])
                .level(log::LevelFilter::Info)
                // 插件默认 KeepOne + 40KB：超限会直接删掉旧日志，排障时只剩最后一小段。
                // 保留 3 份历史归档及当前日志，单份 1MB，便于回溯现场。
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                // 默认是 UTC，与用户反馈问题时的本地时间差 8 小时，排查容易对不上
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        // 装饰由平台配置决定；显示时机由前端首帧和下方兜底决定。
        // 插件默认会恢复旧的 decorations，并在窗口 ready 时直接 show()
        // （没有存档时也会），因此这两项不能参与状态恢复。
        .plugin(window_state.build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(all(desktop, not(windows), not(feature = "e2e")))]
    let builder = builder.plugin(
        tauri_plugin_autostart::Builder::new()
            .app_name(context.config().identifier.clone())
            .build(),
    );
    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let builder = builder.setup(|app| {
        let paths = storage::DataPaths::resolve(app.handle())?;
        let settings = storage::SettingsStore::open(paths.config.join("settings.json"))?;
        let database = database::Database::open(&paths.data.join("starter.sqlite3"))?;
        app.manage(paths);
        app.manage(settings);
        app.manage(database);
        app.manage(desktop::DesktopState::default());
        app.manage(diagnostics::DiagnosticsState::default());
        app.manage(updater::UpdateManager::default());
        if let Err(error) = desktop::install_tray(app.handle()) {
            log::warn!("Tray is unavailable: {error}");
        }
        // 每次启动记一条，既方便对照版本，也顺便验证日志链路是通的
        log::info!("应用启动 v{}", app.package_info().version);

        // 窗口默认隐藏以等待首帧渲染，这里做兜底：
        // 万一前端异常没能主动 show()，3 秒后强制显示，避免"点了图标没反应"
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            let handle2 = handle.clone();
            // 窗口操作统一回到主线程执行，避免跨线程改窗口状态
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = handle2.get_webview_window("main")
                    && !window.is_visible().unwrap_or(true)
                {
                    let _ = window.show();
                }
            });
        });
        Ok(())
    });

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<storage::SettingsStore>().run_in_background()
                    && desktop::status(app).tray_available
                {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        log::warn!("Cannot hide window: {error}");
                    }
                }
            }
        })
        .invoke_handler(bindings::builder().invoke_handler())
        .run(context)
        .expect("error while running tauri application");
}
