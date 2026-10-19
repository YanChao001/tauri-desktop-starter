//! 应用入口，只做组装：注册插件、挂命令、启动逻辑。
//! 具体命令的实现放在 `commands.rs`，不要让这个文件变成第二个业务层。

mod commands;

use std::time::Duration;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, TimezoneStrategy};
use tauri_plugin_window_state::StateFlags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // 日志最先注册：后面任何插件或启动逻辑出错，都要能被记下来
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // release 下没有控制台，文件日志是唯一的排障入口
                    // 固定文件名，避免产品名带空格或改动后日志路径对不上文档
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("app".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                // 插件默认 KeepOne + 40KB：超限会直接删掉旧日志，排障时只剩最后一小段。
                // 保留 3 份历史归档及当前日志，单份 1MB，便于回溯现场。
                .max_file_size(1_000_000)
                .rotation_strategy(RotationStrategy::KeepSome(3))
                // 默认是 UTC，与用户反馈问题时的本地时间差 8 小时，排查容易对不上
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .build(),
        );

    // 单实例：重复启动时聚焦已有窗口，而不是再开一个（仅桌面端）。
    // 官方要求它尽早注册——只排在日志之后，先于其余插件，
    // 避免插件初始化期间第二个实例已经起来
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        // 装饰由平台配置决定；显示时机由前端首帧和下方兜底决定。
        // 插件默认会恢复旧的 decorations，并在窗口 ready 时直接 show()
        // （没有存档时也会），因此这两项不能参与状态恢复。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::all().difference(StateFlags::DECORATIONS | StateFlags::VISIBLE),
                )
                .build(),
        )
        .plugin(tauri_plugin_opener::init());

    let builder = builder.setup(|app| {
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
        .invoke_handler(tauri::generate_handler![commands::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
