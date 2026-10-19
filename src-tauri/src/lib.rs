use std::time::Duration;

use tauri::Manager;

// 前端通过 invoke("greet", { name }) 调用，返回值会自动序列化成 TypeScript 字符串
#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{name}！这条消息来自 Rust。")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init());

    // 单实例：重复启动时聚焦已有窗口，而不是再开一个（仅桌面端）
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .setup(|app| {
            // 窗口默认隐藏以等待首帧渲染，这里做兜底：
            // 万一前端异常没能主动 show()，3 秒后强制显示，避免"点了图标没反应"
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                if let Some(window) = handle.get_webview_window("main")
                    && !window.is_visible().unwrap_or(true)
                {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
