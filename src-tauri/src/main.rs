// 正式构建使用 Windows GUI 子系统，避免启动时额外显示控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--extension-worker") {
        if std::env::args_os().len() != 2 {
            std::process::exit(2);
        }
        std::process::exit(tauri_desktop_starter_lib::extension_runtime::worker_main());
    }
    // 固定子进程协议在初始化 Tauri/单实例之前处理，不执行用户提供的命令。
    if std::env::args().nth(1).as_deref() == Some("--demo-worker") {
        let input = std::env::args().nth(2).unwrap_or_default();
        if input.len() > 1000 || input.contains('\0') {
            std::process::exit(2);
        }
        println!(
            "{}",
            serde_json::json!({ "input": input, "characters": input.chars().count(), "uppercase": input.to_uppercase() })
        );
        return;
    }
    tauri_desktop_starter_lib::run();
    tauri_desktop_starter_lib::extension_runtime::shutdown_workers();
}
