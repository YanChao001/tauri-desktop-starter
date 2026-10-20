//! 应用入口，只做组装：注册插件、挂命令、启动逻辑。
//! 具体命令的实现放在 `commands.rs`，不要让这个文件变成第二个业务层。

#[cfg(all(feature = "e2e", not(debug_assertions)))]
compile_error!(
    "The e2e WebDriver service requires a debug/test profile and must not be included in release builds"
);

#[cfg(windows)]
mod autostart;
pub mod bindings;
mod blocking;
mod commands;
mod database;
mod desktop;
mod diagnostics;
mod error;
mod storage;
pub mod update_signature;
mod updater;
mod window_geometry;

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
    let builder = tauri::Builder::default().manage(desktop::DesktopState::default());

    // 单实例必须最先注册，让重复启动在初始化日志等共享资源前退出。
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        desktop::request_show_main(app);
    }));

    let builder = builder
        // 其余插件初始化前启用日志，保留启动失败的排障信息
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // 正式构建默认不显示控制台，使用文件日志排查运行问题
                    // 固定文件名，避免产品名带空格或改动后日志路径对不上文档
                    tauri_plugin_log::Target::new(log_target),
                ])
                .level(log::LevelFilter::Info)
                // 插件默认 KeepOne + 40KB：超限会直接删掉旧日志，排障时只剩最后一小段。
                // 保留 3 份历史归档及当前日志，单份 1MB，便于回溯现场。
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                // 默认 UTC 可能与用户本地时间不同，使用本地时间便于对应问题发生时刻
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        )
        // 尺寸由几何模块统一持久化，避免旧物理像素存档覆盖逻辑尺寸。
        // 装饰由平台配置决定；显示时机由前端首帧和下方兜底决定。
        // 插件默认会恢复旧的 decorations，并在窗口 ready 时直接 show()
        // （没有存档时也会），因此这两项不能参与状态恢复。
        .plugin(window_state.build())
        .plugin(window_geometry::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

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
        app.manage(diagnostics::DiagnosticsState::default());
        app.manage(updater::UpdateManager::default());
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
