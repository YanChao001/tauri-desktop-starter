//! 应用入口，只做组装：注册插件、挂命令、启动逻辑。
//! 具体命令的实现放在 `commands.rs`，不要让这个文件变成第二个业务层。

mod commands;
mod win_frame;

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

        // tao 0.37.1 对顶层窗口无条件施加 WS_CAPTION（tao issue #1106），
        // 无装饰窗口只靠 WM_NCCALCSIZE 返回 0 视觉隐藏；而 show/maximize
        // 等任何 flag 变化都会经 apply_diff 用 to_window_styles() 重刷
        // 样式，把 WS_CAPTION 加回来——表现为自定义标题栏上方冒出
        // 原生标题栏。这里在 Rust 侧直接剥掉标题栏样式位，
        // 保留 WS_THICKFRAME 供无边框缩放手柄和 DWM 阴影使用。
        #[cfg(windows)]
        {
            if let Some(window) = app.get_webview_window("main") {
                win_frame::strip_native_caption(&window);
            }
        }

        // 窗口默认隐藏以等待首帧渲染，这里做兜底：
        // 万一前端异常没能主动 show()，3 秒后强制显示，避免"点了图标没反应"
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(3));
            let handle2 = handle.clone();
            // 窗口操作统一回到主线程执行，避免跨线程改窗口状态
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = handle2.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                    // show() 会经 apply_diff 把标题栏样式加回来；
                    // 若窗口没能获得焦点（Focused 事件不触发），
                    // 这里在显示后再补剥一次
                    #[cfg(windows)]
                    win_frame::strip_native_caption(&window);
                }
            });
        });
        Ok(())
    });

    // apply_diff 只在窗口 flag 变化时重刷样式，而这些时刻都会伴随
    // 下面的事件；在这里兜底剥掉被重新加上的标题栏。
    // 仅 Windows 需要，非 Windows 平台整个 hook 不挂，避免未使用变量警告
    #[cfg(windows)]
    let builder = builder.on_window_event(|window, event| {
        if matches!(
            event,
            tauri::WindowEvent::Focused(true)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::Moved(_)
        ) {
            win_frame::strip_native_caption(window);
        }
    });

    builder
        .invoke_handler(tauri::generate_handler![commands::greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
