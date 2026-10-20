// 正式构建使用 Windows GUI 子系统，避免启动时额外显示控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri_desktop_starter_lib::run()
}
