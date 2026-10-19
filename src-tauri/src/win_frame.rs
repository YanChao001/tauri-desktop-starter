//! Windows 专用：剥掉 tao 误加的原生标题栏样式位。
//!
//! 背景（tao issue #1106）：tao 0.37.1 的 `WindowFlags::to_window_styles()`
//! 对顶层窗口**无条件**包含 `WS_CAPTION`，无装饰窗口只靠 `WM_NCCALCSIZE`
//! 返回 0 在视觉上隐藏标题栏；而 `WindowFlags::apply_diff` 在
//! show/minimize/maximize 等任何 flag 变化时都会用 `to_window_styles()`
//! 重算并重刷样式，把 `WS_CAPTION` 加回来——于是自定义标题栏上方
//! 会冒出原生标题栏（含最小化/最大化/关闭按钮），Windows 上表现为
//! 双层标题栏。
//!
//! 这里在 Rust 侧直接清除标题栏相关样式位。刻意保留：
//! - `WS_THICKFRAME`：tauri-runtime-wry 的无边框缩放手柄通过
//!   `GetWindowLongPtrW(GWL_STYLE) & WS_SIZEBOX` 判断窗口可否调整
//!   尺寸，剥掉它会导致边缘拖拽缩放失效；DWM 阴影与 Windows 11
//!   圆角同样依赖它。
//! - `WS_SYSMENU`：保留 Alt+F4 / Alt+Space 等系统行为。
//!
//! 调用时机：窗口创建后，以及每次焦点获得 / 尺寸变化后——
//! apply_diff 只在这些时刻重刷样式。函数幂等，样式干净时立即返回，
//! 可以放心挂在窗口事件回调里。

#![cfg(windows)]

use raw_window_handle::HasWindowHandle;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetWindowLongPtrW, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SetWindowLongPtrW, SetWindowPos, WS_BORDER, WS_CAPTION, WS_DLGFRAME,
};

/// 标题栏及其组成边框位。`WS_CAPTION` 本身就是 `WS_BORDER | WS_DLGFRAME`
/// 的组合，一并列出以防未来常量关系变化。
const CAPTION_BITS: u32 = WS_CAPTION | WS_BORDER | WS_DLGFRAME;

/// 按新样式重算非客户区：不动位置/尺寸/层级，也不抢焦点。
const REFRESH_FRAME: u32 =
    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE;

/// 清除 `window` 的原生标题栏样式（若存在），并触发系统重算窗口框架。
///
/// 泛型约束 `HasWindowHandle` 让同一个函数同时接受
/// `tauri::Window` 与 `tauri::WebviewWindow`（两者的 `hwnd()` 返回
/// 类型不同，但都实现了该 trait）。
pub fn strip_native_caption<W: HasWindowHandle>(window: &W) {
    let Ok(handle) = window.window_handle() else {
        return;
    };
    let raw_window_handle::RawWindowHandle::Win32(handle) = handle.as_raw() else {
        // 非 Win32 句柄，没有标题栏样式可剥
        return;
    };
    let hwnd = handle.hwnd.get() as HWND;

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let stripped = style & !CAPTION_BITS;
        if stripped == style {
            // 已经是无标题栏状态，不做无谓的重绘
            return;
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, stripped as isize);
        // 必须带 SWP_FRAMECHANGED，否则系统不会按新样式重算非客户区，
        // 标题栏不会立即消失
        SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, REFRESH_FRAME);
    }
}
