//! 统一管理窗口尺寸，在缩放、远程桌面及显示器布局变化后保持窗口可用。
//! 尺寸以逻辑像素持久化，显示器坐标保留物理像素。

use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, RunEvent, Window, WindowEvent, plugin::TauriPlugin,
};
use tauri_plugin_window_state::AppHandleExt;

use crate::{
    error::{ErrorCode, NativeError, NativeResult},
    storage::{DataPaths, SettingsStore, WindowPosition, atomic_write},
};

const SETTLE: Duration = Duration::from_millis(300);
const TOPOLOGY_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct LogicalSize {
    width: f64,
    height: f64,
}

impl LogicalSize {
    fn valid(self) -> bool {
        [self.width, self.height]
            .into_iter()
            .all(|value| value.is_finite() && (1.0..=100_000.0).contains(&value))
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Clone, PartialEq)]
struct Display {
    area: Rect,
    scale: f64,
}

#[derive(Clone, Copy)]
struct Limits {
    min: LogicalSize,
    max_width: Option<f64>,
    max_height: Option<f64>,
}

#[derive(Debug, PartialEq)]
struct Placement {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    minimum: PhysicalSize<u32>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
    pub max_width: u32,
    pub max_height: u32,
    pub default_width: u32,
    pub default_height: u32,
}

fn intersection(a: Rect, b: Rect) -> f64 {
    ((a.x + a.width).min(b.x + b.width) - a.x.max(b.x)).max(0.0)
        * ((a.y + a.height).min(b.y + b.height) - a.y.max(b.y)).max(0.0)
}

fn distance_to_display(rect: Rect, display: Rect) -> f64 {
    let x = rect.x + rect.width / 2.0;
    let y = rect.y + rect.height / 2.0;
    let dx = x - x.clamp(display.x, display.x + display.width);
    let dy = y - y.clamp(display.y, display.y + display.height);
    dx * dx + dy * dy
}

fn choose_display(rect: Rect, displays: &[Display]) -> Option<&Display> {
    displays
        .iter()
        .filter(|display| {
            display.scale.is_finite()
                && display.scale > 0.0
                && display.area.width >= 1.0
                && display.area.height >= 1.0
        })
        .max_by(|a, b| {
            intersection(rect, a.area)
                .total_cmp(&intersection(rect, b.area))
                .then_with(|| {
                    distance_to_display(rect, b.area).total_cmp(&distance_to_display(rect, a.area))
                })
        })
}

fn fit_window(
    current: Rect,
    frame: LogicalSize,
    preferred: LogicalSize,
    limits: Limits,
    displays: &[Display],
    constrain_position: bool,
) -> Option<Placement> {
    let display = choose_display(current, displays)?;
    let area = display.area;
    // 预留原生边框和标题栏；小屏幕优先满足工作区约束，避免最小尺寸超出屏幕。
    let available_width = (area.width - frame.width * display.scale).floor().max(1.0);
    let available_height = (area.height - frame.height * display.scale)
        .floor()
        .max(1.0);
    let maximum = |value: Option<f64>, available: f64| {
        value
            .filter(|value| value.is_finite() && *value > 0.0)
            .map_or(available, |value| (value * display.scale).min(available))
            .floor()
            .max(1.0)
    };
    let max_width = maximum(limits.max_width, available_width);
    let max_height = maximum(limits.max_height, available_height);
    let min_width = (limits.min.width * display.scale)
        .round()
        .clamp(1.0, max_width);
    let min_height = (limits.min.height * display.scale)
        .round()
        .clamp(1.0, max_height);
    let width = (preferred.width * display.scale)
        .round()
        .clamp(min_width, max_width);
    let height = (preferred.height * display.scale)
        .round()
        .clamp(min_height, max_height);
    let outer_width = width + frame.width * display.scale;
    let outer_height = height + frame.height * display.scale;
    let title_is_reachable = displays.iter().any(|display| {
        let title = Rect {
            height: (32.0 * display.scale).min(current.height),
            ..current
        };
        let width = ((title.x + title.width).min(display.area.x + display.area.width)
            - title.x.max(display.area.x))
        .max(0.0);
        let height = ((title.y + title.height).min(display.area.y + display.area.height)
            - title.y.max(display.area.y))
        .max(0.0);
        width >= (128.0 * display.scale).min(title.width)
            && height >= (24.0 * display.scale).min(title.height)
    });
    // 允许拖动时部分移出屏幕；仅在环境恢复、窗口过大或标题栏不可达时完整移回。
    let reposition = constrain_position
        || current.width > area.width
        || current.height > area.height
        || !title_is_reachable;
    Some(Placement {
        size: PhysicalSize::new(width as u32, height as u32),
        position: PhysicalPosition::new(
            if reposition {
                current
                    .x
                    .clamp(area.x, (area.x + area.width - outer_width).max(area.x))
                    .round() as i32
            } else {
                current.x.round() as i32
            },
            if reposition {
                current
                    .y
                    .clamp(area.y, (area.y + area.height - outer_height).max(area.y))
                    .round() as i32
            } else {
                current.y.round() as i32
            },
        ),
        minimum: PhysicalSize::new(min_width as u32, min_height as u32),
    })
}

fn centered_position(
    current: Rect,
    frame: LogicalSize,
    size: PhysicalSize<u32>,
    displays: &[Display],
) -> Option<PhysicalPosition<i32>> {
    let display = choose_display(current, displays)?;
    Some(PhysicalPosition::new(
        (display.area.x
            + (display.area.width - f64::from(size.width) - frame.width * display.scale) / 2.0)
            .round() as i32,
        (display.area.y
            + (display.area.height - f64::from(size.height) - frame.height * display.scale) / 2.0)
            .round() as i32,
    ))
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedGeometry {
    schema_version: u32,
    windows: HashMap<String, LogicalSize>,
}

fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Option<T> {
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= 64 * 1024)
        .then(|| serde_json::from_slice(&bytes).ok())
        .flatten()
}

#[derive(Deserialize)]
struct LegacySize {
    width: u32,
    height: u32,
}

#[derive(Clone, Copy)]
struct Pending {
    due: Instant,
    resized: bool,
    preserve: bool,
    constrain_position: bool,
}

struct Entry {
    preferred: LogicalSize,
    limits: Limits,
    scale: f64,
    pending: Option<Pending>,
    last_applied: Option<PhysicalSize<u32>>,
    minimum: Option<PhysicalSize<u32>>,
    was_special: bool,
    topology: Vec<Display>,
    initial_position: Option<WindowPosition>,
}

impl Entry {
    fn request_size(&mut self, preferred: LogicalSize, center: bool) {
        self.preferred = preferred;
        // 原生还原和缩放会同步触发事件，先保护目标尺寸以免被旧事件覆盖。
        self.pending = Some(Pending {
            due: Instant::now() + SETTLE,
            resized: false,
            preserve: true,
            constrain_position: center,
        });
    }

    fn schedule(&mut self, resized: bool, preserve: bool) {
        let pending = self.pending.get_or_insert(Pending {
            due: Instant::now() + SETTLE,
            resized: false,
            preserve: false,
            constrain_position: false,
        });
        pending.due = Instant::now() + SETTLE;
        pending.resized |= resized;
        pending.preserve |= preserve;
    }

    fn capture_resize(
        &mut self,
        pending: Option<Pending>,
        scale: f64,
        inner: PhysicalSize<u32>,
        is_special: bool,
        topology_changed: bool,
    ) {
        if !is_special
            && self.initial_position.is_none()
            && !self.was_special
            && !topology_changed
            && pending.is_some_and(|pending| pending.resized && !pending.preserve)
            && self.scale == scale
            && self.last_applied != Some(inner)
            && inner.width > 0
            && inner.height > 0
        {
            let size = LogicalSize {
                width: f64::from(inner.width) / scale,
                height: f64::from(inner.height) / scale,
            };
            if size.valid() {
                self.preferred = size;
            }
        }
    }
}

struct Cache {
    saved: SavedGeometry,
    legacy: HashMap<String, LegacySize>,
    entries: HashMap<String, Entry>,
}

impl Cache {
    fn reset_saved(&mut self, default: impl Fn(&str) -> LogicalSize) {
        // 同时重置未打开窗口的尺寸，防止下次创建窗口时重新载入旧值。
        for (label, preferred) in &mut self.saved.windows {
            *preferred = default(label);
        }
        for label in self.legacy.keys() {
            self.saved.windows.insert(label.clone(), default(label));
        }
        self.legacy.clear();
    }
}

struct GeometryState {
    path: PathBuf,
    cache: Mutex<Cache>,
    writing: Mutex<()>,
    operations: Mutex<()>,
    dirty: AtomicBool,
    stopped: AtomicBool,
    queued: AtomicBool,
}

impl GeometryState {
    fn save(&self) -> NativeResult<()> {
        let _writing = self.writing.lock().map_err(|_| geometry_unavailable())?;
        let bytes = serde_json::to_vec_pretty(
            &self.cache.lock().map_err(|_| geometry_unavailable())?.saved,
        )
        .map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot encode window geometry", error)
        })?;
        atomic_write(&self.path, &bytes).map_err(|error| {
            NativeError::operation(ErrorCode::StorageIo, "Cannot save window geometry", error)
        })
    }
}

fn displays(app: &tauri::AppHandle) -> Vec<Display> {
    let mut displays = app
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Display {
                area: Rect {
                    x: f64::from(area.position.x),
                    y: f64::from(area.position.y),
                    width: f64::from(area.size.width),
                    height: f64::from(area.size.height),
                },
                scale: monitor.scale_factor(),
            }
        })
        .collect::<Vec<_>>();
    displays.sort_by(|a, b| {
        a.area
            .x
            .total_cmp(&b.area.x)
            .then_with(|| a.area.y.total_cmp(&b.area.y))
    });
    displays
}

fn geometry_unavailable() -> NativeError {
    NativeError::new(ErrorCode::WindowError, "Window geometry is unavailable")
}

fn window_error(error: tauri::Error) -> NativeError {
    NativeError::operation(
        ErrorCode::WindowError,
        "Cannot update window geometry",
        error,
    )
}

fn configured(app: &tauri::AppHandle, label: &str) -> (LogicalSize, Limits) {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == label)
        .or_else(|| app.config().app.windows.first());
    (
        LogicalSize {
            width: config.map_or(1120.0, |config| config.width),
            height: config.map_or(740.0, |config| config.height),
        },
        Limits {
            min: LogicalSize {
                width: config.and_then(|config| config.min_width).unwrap_or(1.0),
                height: config.and_then(|config| config.min_height).unwrap_or(1.0),
            },
            max_width: config.and_then(|config| config.max_width),
            max_height: config.and_then(|config| config.max_height),
        },
    )
}

fn measure(window: &Window) -> NativeResult<(Rect, LogicalSize, Vec<Display>)> {
    let scale = window.scale_factor().map_err(window_error)?;
    if !scale.is_finite() || scale <= 0.0 {
        return Err(geometry_unavailable());
    }
    let inner = window.inner_size().map_err(window_error)?;
    let outer = window.outer_size().map_err(window_error)?;
    let position = window.outer_position().map_err(window_error)?;
    Ok((
        Rect {
            x: f64::from(position.x),
            y: f64::from(position.y),
            width: f64::from(outer.width),
            height: f64::from(outer.height),
        },
        LogicalSize {
            width: f64::from(outer.width.saturating_sub(inner.width)) / scale,
            height: f64::from(outer.height.saturating_sub(inner.height)) / scale,
        },
        displays(window.app_handle()),
    ))
}

fn describe(window: &Window, state: &GeometryState) -> NativeResult<WindowGeometry> {
    let (current, frame, monitors) = measure(window)?;
    let display = choose_display(current, &monitors).ok_or_else(geometry_unavailable)?;
    let (default, limits) = configured(window.app_handle(), window.label());
    let remembered = state
        .cache
        .lock()
        .map_err(|_| geometry_unavailable())?
        .entries
        .get(window.label())
        .map_or(default, |entry| entry.preferred);
    let preferred = if special(window) {
        remembered
    } else {
        let inner = window.inner_size().map_err(window_error)?;
        let scale = window.scale_factor().map_err(window_error)?;
        LogicalSize {
            width: f64::from(inner.width) / scale,
            height: f64::from(inner.height) / scale,
        }
    };
    let largest = fit_window(
        current,
        frame,
        LogicalSize {
            width: 100_000.0,
            height: 100_000.0,
        },
        limits,
        &monitors,
        false,
    )
    .ok_or_else(geometry_unavailable)?;
    let min_width = (f64::from(largest.minimum.width) / display.scale).ceil();
    let min_height = (f64::from(largest.minimum.height) / display.scale).ceil();
    let max_width = (f64::from(largest.size.width) / display.scale)
        .floor()
        .max(min_width);
    let max_height = (f64::from(largest.size.height) / display.scale)
        .floor()
        .max(min_height);
    Ok(WindowGeometry {
        width: preferred.width.round().clamp(min_width, max_width) as u32,
        height: preferred.height.round().clamp(min_height, max_height) as u32,
        min_width: min_width as u32,
        min_height: min_height as u32,
        max_width: max_width as u32,
        max_height: max_height as u32,
        default_width: default.width.round() as u32,
        default_height: default.height.round() as u32,
    })
}

fn on_main_thread<T: Send + 'static>(
    app: &tauri::AppHandle,
    operation: impl FnOnce() -> NativeResult<T> + Send + 'static,
) -> NativeResult<T> {
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(operation());
    })
    .map_err(window_error)?;
    receive.recv().map_err(|_| geometry_unavailable())?
}

/// 原生几何变更统一进入主线程；等待和写盘留在调用方工作线程。
pub fn read(window: tauri::WebviewWindow) -> NativeResult<WindowGeometry> {
    let app = window.app_handle().clone();
    let state = app.state::<Arc<GeometryState>>().inner().clone();
    on_main_thread(&app, move || describe(&window.as_ref().window(), &state))
}

fn apply_preferred(
    window: &Window,
    state: &GeometryState,
    preferred: LogicalSize,
    center: bool,
) -> NativeResult<()> {
    let previous = {
        let mut cache = state.cache.lock().map_err(|_| geometry_unavailable())?;
        let entry = cache
            .entries
            .get_mut(window.label())
            .ok_or_else(geometry_unavailable)?;
        let previous = entry.preferred;
        entry.request_size(preferred, center);
        previous
    };
    let result = (|| {
        if window.is_fullscreen().map_err(window_error)? {
            window.set_fullscreen(false).map_err(window_error)?;
        }
        if window.is_minimized().map_err(window_error)? {
            window.unminimize().map_err(window_error)?;
        }
        if window.is_maximized().map_err(window_error)? {
            window.unmaximize().map_err(window_error)?;
        }
        let (current, frame, monitors) = measure(window)?;
        let (_, limits) = configured(window.app_handle(), window.label());
        let mut placement = fit_window(current, frame, preferred, limits, &monitors, center)
            .ok_or_else(geometry_unavailable)?;
        if center {
            placement.position = centered_position(current, frame, placement.size, &monitors)
                .ok_or_else(geometry_unavailable)?;
        }
        // 不持有缓存锁调用窗口 API，避免事件回调重入后互相等待。
        window
            .set_min_size(Some(placement.minimum))
            .map_err(window_error)?;
        window.set_size(placement.size).map_err(window_error)?;
        window
            .set_position(placement.position)
            .map_err(window_error)?;
        let mut cache = state.cache.lock().map_err(|_| geometry_unavailable())?;
        if let Some(entry) = cache.entries.get_mut(window.label()) {
            entry.minimum = Some(placement.minimum);
            entry.last_applied = Some(placement.size);
            entry.was_special = false;
        }
        cache
            .saved
            .windows
            .insert(window.label().to_owned(), preferred);
        Ok(())
    })();
    if result.is_err() {
        if let Ok(mut cache) = state.cache.lock()
            && let Some(entry) = cache.entries.get_mut(window.label())
        {
            entry.preferred = previous;
            entry.schedule(false, true);
        }
    } else {
        state.dirty.store(true, Ordering::Release);
    }
    result
}

pub fn set_size(
    window: tauri::WebviewWindow,
    width: f64,
    height: f64,
) -> NativeResult<WindowGeometry> {
    let preferred = LogicalSize { width, height };
    if !preferred.valid() || width.fract() != 0.0 || height.fract() != 0.0 {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Window dimensions must be positive whole logical pixels",
        ));
    }
    let app = window.app_handle().clone();
    let state = app.state::<Arc<GeometryState>>().inner().clone();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| geometry_unavailable())?;
    let copy = state.clone();
    let result = on_main_thread(&app, move || {
        let native = window.as_ref().window();
        let bounds = describe(&native, &copy)?;
        if !(f64::from(bounds.min_width)..=f64::from(bounds.max_width)).contains(&width)
            || !(f64::from(bounds.min_height)..=f64::from(bounds.max_height)).contains(&height)
        {
            return Err(NativeError::new(
                ErrorCode::InvalidArgument,
                "Window dimensions exceed the current display limits",
            ));
        }
        apply_preferred(&native, &copy, preferred, false)?;
        describe(&native, &copy)
    })?;
    state.save()?;
    Ok(result)
}

pub fn reset(window: tauri::WebviewWindow, center: bool) -> NativeResult<WindowGeometry> {
    let app = window.app_handle().clone();
    let state = app.state::<Arc<GeometryState>>().inner().clone();
    let _operation = state
        .operations
        .lock()
        .map_err(|_| geometry_unavailable())?;
    let handle = app.clone();
    let copy = state.clone();
    let result = on_main_thread(&app, move || {
        for webview in handle.webview_windows().values() {
            let native = webview.as_ref().window();
            let (default, _) = configured(&handle, native.label());
            apply_preferred(&native, &copy, default, center)?;
        }
        let mut cache = copy.cache.lock().map_err(|_| geometry_unavailable())?;
        cache.reset_saved(|label| configured(&handle, label).0);
        drop(cache);
        describe(&window.as_ref().window(), &copy)
    })?;
    state.save()?;
    Ok(result)
}

fn special(window: &Window) -> bool {
    window.is_minimized().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
        || window.is_fullscreen().unwrap_or(true)
}

#[cfg(windows)]
fn interacting(window: &Window) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GUI_INMOVESIZE, GUITHREADINFO, GetGUIThreadInfo, GetWindowThreadProcessId,
    };
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let mut info = GUITHREADINFO {
        cbSize: size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    // 只读取本进程窗口线程的 GUI 状态，不安装钩子、不合成输入、不改变焦点。
    unsafe {
        let thread = GetWindowThreadProcessId(hwnd.0, std::ptr::null_mut());
        thread != 0 && GetGUIThreadInfo(thread, &mut info) != 0 && info.flags & GUI_INMOVESIZE != 0
    }
}

#[cfg(not(windows))]
fn interacting(_window: &Window) -> bool {
    false
}

#[cfg(windows)]
fn normalize_initial_frame(window: &Window) -> tauri::Result<()> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetWindowPos,
    };
    let hwnd = window.hwnd()?;
    // Tao 初建的隐藏无装饰窗口可能仍保留原生标题栏的客户端边界。
    // ready 回调返回后仅重算非客户区，确保尺寸换算使用已生效的边框。
    // 调用时不持有缓存或插件锁，也不改变位置、尺寸、层级或焦点。
    let applied = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if applied == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn normalize_initial_frame(_window: &Window) -> tauri::Result<()> {
    Ok(())
}

fn repair(window: &Window, state: &GeometryState, displays: &[Display]) -> tauri::Result<()> {
    let initial_position = state.cache.lock().ok().and_then(|cache| {
        cache
            .entries
            .get(window.label())
            .and_then(|entry| entry.initial_position)
    });
    if initial_position.is_some() {
        normalize_initial_frame(window)?;
    }
    let center = initial_position == Some(WindowPosition::Center);
    let maximized = center && window.is_maximized()?;
    let fullscreen = center && window.is_fullscreen()?;
    let minimized = center && window.is_minimized()?;
    let result = (|| {
        // 最大化与全屏仍保留；先调整正常窗口位置，再恢复原显示状态。
        if fullscreen {
            window.set_fullscreen(false)?;
        }
        if maximized {
            window.unmaximize()?;
        }
        if minimized {
            window.unminimize()?;
        }
        repair_normal(window, state, displays, center)
    })();
    let restored = (|| {
        if maximized {
            window.maximize()?;
        }
        if fullscreen {
            window.set_fullscreen(true)?;
        }
        if minimized {
            window.minimize()?;
        }
        Ok(())
    })();
    if matches!(result, Ok(true))
        && restored.is_ok()
        && let Ok(mut cache) = state.cache.lock()
        && let Some(entry) = cache.entries.get_mut(window.label())
    {
        // 每个新窗口只消费一次策略，后续移动、聚焦和重复激活均不再居中。
        entry.initial_position = None;
    }
    result.map(|_| ()).and(restored)
}

fn repair_normal(
    window: &Window,
    state: &GeometryState,
    displays: &[Display],
    center: bool,
) -> tauri::Result<bool> {
    if interacting(window) {
        if let Ok(mut cache) = state.cache.lock()
            && let Some(entry) = cache.entries.get_mut(window.label())
        {
            entry.schedule(false, false);
        }
        return Ok(false);
    }
    // 先消费待处理项，避免不支持全局定位的平台反复重试同一任务。
    let pending = state.cache.lock().ok().and_then(|mut cache| {
        cache
            .entries
            .get_mut(window.label())
            .and_then(|entry| entry.pending.take())
    });
    let scale = window.scale_factor()?;
    if !scale.is_finite() || scale <= 0.0 {
        return Ok(false);
    }
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let position = window.outer_position()?;
    let is_special = special(window);
    let current = Rect {
        x: f64::from(position.x),
        y: f64::from(position.y),
        width: f64::from(outer.width),
        height: f64::from(outer.height),
    };
    let frame = LogicalSize {
        width: f64::from(outer.width.saturating_sub(inner.width)) / scale,
        height: f64::from(outer.height.saturating_sub(inner.height)) / scale,
    };
    let (placement, minimum_changed, changed) = {
        let Ok(mut cache) = state.cache.lock() else {
            return Ok(false);
        };
        let Some(entry) = cache.entries.get_mut(window.label()) else {
            return Ok(false);
        };
        // 系统尺寸事件可能早于轮询，重新检查布局，防止覆盖上一次正常逻辑尺寸。
        let topology_changed = entry.topology != displays;
        entry.capture_resize(pending, scale, inner, is_special, topology_changed);
        let Some(mut placement) = fit_window(
            current,
            frame,
            entry.preferred,
            entry.limits,
            displays,
            topology_changed || pending.is_some_and(|pending| pending.constrain_position),
        ) else {
            return Ok(false);
        };
        if center
            && let Some(position) = centered_position(current, frame, placement.size, displays)
        {
            placement.position = position;
        }
        let minimum_changed = entry.minimum != Some(placement.minimum);
        entry.minimum = Some(placement.minimum);
        entry.last_applied = Some(placement.size);
        entry.scale = scale;
        entry.was_special = is_special;
        entry.topology = displays.to_vec();
        let preferred = entry.preferred;
        let changed = cache
            .saved
            .windows
            .insert(window.label().to_owned(), preferred)
            != Some(preferred);
        (placement, minimum_changed, changed)
    };
    if minimum_changed {
        window.set_min_size(Some(placement.minimum))?;
    }
    if !is_special {
        // Windows 的最小尺寸更新会触发客户端区域重算，不能沿用更新前的 inner。
        // 否则旧尺寸恰好等于目标时会跳过修正，把非客户区差值保存成用户尺寸。
        if placement.size != window.inner_size()? {
            window.set_size(placement.size)?;
        }
        // 居中依据最终外框尺寸，避免首次非客户区重算后残留半个边框差值。
        let position = if center {
            centered_position(
                current,
                LogicalSize {
                    width: 0.0,
                    height: 0.0,
                },
                window.outer_size()?,
                displays,
            )
            .unwrap_or(placement.position)
        } else {
            placement.position
        };
        if position != window.outer_position()? {
            window.set_position(position)?;
        }
    }
    if changed {
        state.dirty.store(true, Ordering::Release);
    }
    Ok(true)
}

/// 仅由主线程显示入口调用，确保首帧和超时兜底都先完成初始几何布局。
pub fn before_show(window: &Window) -> NativeResult<()> {
    let app = window.app_handle();
    let state = app.state::<Arc<GeometryState>>();
    let initial = state
        .cache
        .lock()
        .map_err(|_| geometry_unavailable())?
        .entries
        .get(window.label())
        .ok_or_else(geometry_unavailable)?
        .initial_position
        .is_some();
    if initial {
        repair(window, &state, &displays(app)).map_err(window_error)?;
    }
    Ok(())
}

/// ready 回调返回后再切入主线程，避免持有 Tauri 插件锁时触发原生事件重入。
pub fn prepare(window: tauri::WebviewWindow) -> NativeResult<()> {
    let app = window.app_handle().clone();
    on_main_thread(&app, move || before_show(&window.as_ref().window()))
}

fn track(window: Window) {
    let app = window.app_handle();
    let state = app.state::<Arc<GeometryState>>().inner().clone();
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let monitors = displays(app);
    let (default, limits) = configured(app, window.label());
    let was_special = special(&window);
    let initial_position = app
        .try_state::<SettingsStore>()
        .map_or(WindowPosition::default(), |store| store.window_position());
    if let Ok(mut cache) = state.cache.lock() {
        let preferred = cache
            .saved
            .windows
            .get(window.label())
            .copied()
            .or_else(|| {
                cache.legacy.get(window.label()).map(|legacy| LogicalSize {
                    width: f64::from(legacy.width) / scale,
                    height: f64::from(legacy.height) / scale,
                })
            })
            .filter(|size| size.valid())
            .unwrap_or(default);
        cache.entries.insert(
            window.label().to_owned(),
            Entry {
                preferred,
                limits,
                scale,
                pending: Some(Pending {
                    due: Instant::now(),
                    resized: false,
                    preserve: true,
                    constrain_position: true,
                }),
                last_applied: None,
                minimum: None,
                was_special,
                topology: monitors.clone(),
                initial_position: Some(initial_position),
            },
        );
    }
    // ready 回调执行时 Tauri 仍持有插件锁；Win32 几何变更会重入事件循环。
    // 因此由工作线程在回调返回后调度首次修复，避免再次获取插件锁造成死锁。
    let copy = window.clone();
    window.on_window_event(move |event| {
        let preserve = matches!(event, WindowEvent::ScaleFactorChanged { .. });
        let resized = matches!(event, WindowEvent::Resized(_));
        if preserve
            || resized
            || matches!(event, WindowEvent::Moved(_) | WindowEvent::Focused(true))
        {
            let is_special = special(&copy);
            if let Ok(mut cache) = state.cache.lock()
                && let Some(entry) = cache.entries.get_mut(copy.label())
            {
                entry.was_special |= is_special;
                entry.schedule(resized, preserve || is_special);
            }
        } else if matches!(event, WindowEvent::Destroyed) {
            if let Ok(mut cache) = state.cache.lock() {
                cache.entries.remove(copy.label());
            }
            state.dirty.store(true, Ordering::Release);
        }
    });
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("window-geometry")
        .setup(|app, _| {
            let paths = DataPaths::resolve(app)?;
            let path = paths.config.join("window-geometry.json");
            let saved = read_json::<SavedGeometry>(&path)
                .filter(|saved| saved.schema_version == 1)
                .unwrap_or(SavedGeometry {
                    schema_version: 1,
                    windows: HashMap::new(),
                });
            // 旧插件未保存 DPI，仅在缺少逻辑存档时迁移物理尺寸，并按当前工作区约束。
            let legacy =
                read_json(&app.path().app_config_dir()?.join(app.filename())).unwrap_or_default();
            let state = Arc::new(GeometryState {
                path,
                cache: Mutex::new(Cache {
                    saved,
                    legacy,
                    entries: HashMap::new(),
                }),
                writing: Mutex::new(()),
                operations: Mutex::new(()),
                dirty: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
                queued: AtomicBool::new(false),
            });
            app.manage(state.clone());
            let handle = app.clone();
            std::thread::Builder::new()
                .name("window-geometry".into())
                .spawn(move || {
                    let mut topology = Vec::new();
                    let mut next_topology = Instant::now();
                    while !state.stopped.load(Ordering::Acquire) {
                        std::thread::sleep(Duration::from_millis(100));
                        // 同步写盘和杀毒扫描留在工作线程，避免阻塞启动及窗口事件。
                        if state.dirty.swap(false, Ordering::AcqRel)
                            && let Err(error) = state.save()
                        {
                            log::warn!("{error}");
                        }
                        if Instant::now() >= next_topology {
                            let current = displays(&handle);
                            if !current.is_empty() && current != topology {
                                if let Ok(mut cache) = state.cache.lock() {
                                    for entry in cache.entries.values_mut() {
                                        entry.schedule(false, true);
                                        if let Some(pending) = entry.pending.as_mut() {
                                            pending.constrain_position = true;
                                        }
                                    }
                                }
                                topology = current;
                            }
                            next_topology = Instant::now() + TOPOLOGY_INTERVAL;
                        }
                        let due = state.cache.lock().is_ok_and(|cache| {
                            cache.entries.values().any(|entry| {
                                entry
                                    .pending
                                    .is_some_and(|pending| pending.due <= Instant::now())
                            })
                        });
                        if !due || state.queued.swap(true, Ordering::AcqRel) {
                            continue;
                        }
                        let state2 = state.clone();
                        let copy = handle.clone();
                        if handle
                            .run_on_main_thread(move || {
                                let monitors = displays(&copy);
                                for webview in copy.webview_windows().values() {
                                    let window = webview.as_ref().window();
                                    let due = state2.cache.lock().is_ok_and(|cache| {
                                        cache.entries.get(window.label()).is_some_and(|entry| {
                                            entry.pending.is_some_and(|pending| {
                                                pending.due <= Instant::now()
                                            })
                                        })
                                    });
                                    if due && let Err(error) = repair(&window, &state2, &monitors) {
                                        log::warn!("Cannot fit window: {error}");
                                    }
                                }
                                state2.queued.store(false, Ordering::Release);
                            })
                            .is_err()
                        {
                            state.queued.store(false, Ordering::Release);
                        }
                    }
                })?;
            Ok(())
        })
        .on_window_ready(track)
        .on_event(|app, event| {
            if matches!(event, RunEvent::Exit) {
                let state = app.state::<Arc<GeometryState>>();
                state.stopped.store(true, Ordering::Release);
                if let Err(error) = state.save() {
                    log::warn!("{error}");
                }
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn size(width: f64, height: f64) -> LogicalSize {
        LogicalSize { width, height }
    }
    fn display(x: f64, y: f64, width: f64, height: f64, scale: f64) -> Display {
        Display {
            area: Rect {
                x,
                y,
                width,
                height,
            },
            scale,
        }
    }
    fn limits() -> Limits {
        Limits {
            min: size(880.0, 600.0),
            max_width: None,
            max_height: None,
        }
    }
    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn disconnected_remote_screen_returns_window_to_current_work_area() {
        let fitted = fit_window(
            rect(4000.0, 120.0, 4000.0, 2200.0),
            size(0.0, 0.0),
            size(1120.0, 740.0),
            limits(),
            &[display(0.0, 0.0, 1920.0, 1040.0, 1.0)],
            true,
        )
        .unwrap();
        assert_eq!(fitted.size, PhysicalSize::new(1120, 740));
        assert_eq!(fitted.position, PhysicalPosition::new(800, 120));
    }

    #[test]
    fn dpi_changes_preserve_logical_size_and_fit_work_area() {
        let preferred = size(1120.0, 740.0);
        let high = fit_window(
            rect(0.0, 0.0, 1120.0, 740.0),
            size(0.0, 0.0),
            preferred,
            limits(),
            &[display(0.0, 0.0, 3840.0, 2080.0, 2.0)],
            true,
        )
        .unwrap();
        let normal = fit_window(
            rect(0.0, 0.0, 2240.0, 1480.0),
            size(0.0, 0.0),
            preferred,
            limits(),
            &[display(0.0, 0.0, 1920.0, 1040.0, 1.0)],
            true,
        )
        .unwrap();
        assert_eq!(high.size, PhysicalSize::new(2240, 1480));
        assert_eq!(normal.size, PhysicalSize::new(1120, 740));
    }

    #[test]
    fn negative_monitor_positions_and_taskbars_are_respected() {
        let monitors = [
            display(-1920.0, -1200.0, 1920.0, 1160.0, 1.0),
            display(0.0, 40.0, 1920.0, 1000.0, 1.0),
        ];
        let fitted = fit_window(
            rect(-1800.0, -1300.0, 1120.0, 740.0),
            size(0.0, 0.0),
            size(1120.0, 740.0),
            limits(),
            &monitors,
            true,
        )
        .unwrap();
        assert_eq!(fitted.position, PhysicalPosition::new(-1800, -1200));
    }

    #[test]
    fn tiny_screen_reduces_minimum_and_accounts_for_native_frame() {
        let fitted = fit_window(
            rect(0.0, 0.0, 1120.0, 740.0),
            size(16.0, 38.0),
            size(1120.0, 740.0),
            limits(),
            &[display(0.0, 0.0, 800.0, 560.0, 1.0)],
            true,
        )
        .unwrap();
        assert_eq!(fitted.minimum, PhysicalSize::new(784, 522));
        assert_eq!(fitted.size, PhysicalSize::new(784, 522));
        assert_eq!(fitted.position, PhysicalPosition::new(0, 0));
    }

    #[test]
    fn correction_is_idempotent_and_keeps_valid_user_placement() {
        let monitors = [display(0.0, 0.0, 1920.0, 1040.0, 1.0)];
        let current = rect(100.0, 150.0, 1120.0, 740.0);
        let first = fit_window(
            current,
            size(0.0, 0.0),
            size(1120.0, 740.0),
            limits(),
            &monitors,
            false,
        )
        .unwrap();
        let again = fit_window(
            rect(
                f64::from(first.position.x),
                f64::from(first.position.y),
                f64::from(first.size.width),
                f64::from(first.size.height),
            ),
            size(0.0, 0.0),
            size(1120.0, 740.0),
            limits(),
            &monitors,
            false,
        )
        .unwrap();
        assert_eq!(first, again);
        assert_eq!(first.position, PhysicalPosition::new(100, 150));
    }

    #[test]
    fn configured_maximum_and_fractional_dpi_are_honored() {
        let fitted = fit_window(
            rect(0.0, 0.0, 1500.0, 1000.0),
            size(0.0, 0.0),
            size(1120.0, 740.0),
            Limits {
                max_width: Some(1000.0),
                ..limits()
            },
            &[display(0.0, 0.0, 1920.0, 1040.0, 1.25)],
            true,
        )
        .unwrap();
        assert_eq!(fitted.size, PhysicalSize::new(1250, 925));
        assert!(
            fit_window(
                rect(0.0, 0.0, 1.0, 1.0),
                size(0.0, 0.0),
                size(1.0, 1.0),
                limits(),
                &[],
                true,
            )
            .is_none()
        );
    }

    #[test]
    fn centering_uses_the_restored_monitor_work_area_and_keeps_the_remembered_size() {
        let monitors = [
            display(-2560.0, 40.0, 2560.0, 1360.0, 2.0),
            display(0.0, 0.0, 1920.0, 1040.0, 1.0),
        ];
        let current = rect(-2400.0, 100.0, 1120.0, 740.0);
        let frame = size(8.0, 20.0);
        let placement = fit_window(
            current,
            frame,
            size(1000.0, 640.0),
            limits(),
            &monitors,
            true,
        )
        .unwrap();
        assert_eq!(placement.size, PhysicalSize::new(2000, 1280));
        assert_eq!(
            centered_position(current, frame, placement.size, &monitors),
            Some(PhysicalPosition::new(-2288, 60))
        );

        let moved = fit_window(
            rect(-2500.0, 80.0, 2016.0, 1320.0),
            frame,
            size(1000.0, 640.0),
            limits(),
            &monitors,
            false,
        )
        .unwrap();
        assert_eq!(moved.position, PhysicalPosition::new(-2500, 80));
        assert_eq!(moved.size, placement.size);
    }

    #[test]
    fn centering_recovers_a_disconnected_monitor_before_first_display() {
        let monitors = [display(0.0, 40.0, 1920.0, 1000.0, 1.0)];
        let current = rect(6000.0, -1200.0, 4000.0, 2200.0);
        let placement = fit_window(
            current,
            size(0.0, 0.0),
            size(1120.0, 740.0),
            limits(),
            &monitors,
            true,
        )
        .unwrap();
        assert_eq!(placement.size, PhysicalSize::new(1120, 740));
        assert_eq!(
            centered_position(current, size(0.0, 0.0), placement.size, &monitors),
            Some(PhysicalPosition::new(400, 170))
        );
    }

    #[test]
    fn ordinary_partial_offscreen_moves_are_allowed_but_the_title_must_stay_reachable() {
        let monitors = [display(0.0, 0.0, 1920.0, 1040.0, 1.0)];
        let fit = |x, y| {
            fit_window(
                rect(x, y, 1120.0, 740.0),
                size(0.0, 0.0),
                size(1120.0, 740.0),
                limits(),
                &monitors,
                false,
            )
            .unwrap()
        };
        assert_eq!(
            fit(-180.0, 100.0).position,
            PhysicalPosition::new(-180, 100)
        );
        assert_eq!(
            fit(1500.0, 100.0).position,
            PhysicalPosition::new(1500, 100)
        );
        assert_eq!(fit(100.0, -5.0).position, PhysicalPosition::new(100, -5));
        assert_eq!(fit(-1080.0, 100.0).position, PhysicalPosition::new(0, 100));
        assert_eq!(fit(100.0, -100.0).position, PhysicalPosition::new(100, 0));
    }

    #[test]
    fn only_user_resizes_replace_preferred_logical_size() {
        let entry = || Entry {
            preferred: size(1120.0, 740.0),
            limits: limits(),
            scale: 1.0,
            pending: None,
            last_applied: None,
            minimum: None,
            was_special: false,
            topology: Vec::new(),
            initial_position: None,
        };
        let resize = Some(Pending {
            due: Instant::now(),
            resized: true,
            preserve: false,
            constrain_position: false,
        });
        let mut user = entry();
        user.capture_resize(resize, 1.0, PhysicalSize::new(1000, 700), false, false);
        assert_eq!(user.preferred, size(1000.0, 700.0));
        for (scale, special, topology, previous_special, applied) in [
            (2.0, false, false, false, None),
            (1.0, true, false, false, None),
            (1.0, false, true, false, None),
            (1.0, false, false, true, None),
            (1.0, false, false, false, Some(PhysicalSize::new(1000, 700))),
        ] {
            let mut state = entry();
            state.was_special = previous_special;
            state.last_applied = applied;
            state.capture_resize(
                resize,
                scale,
                PhysicalSize::new(1000, 700),
                special,
                topology,
            );
            assert_eq!(state.preferred, size(1120.0, 740.0));
        }
    }

    #[test]
    fn logical_sizes_round_trip_per_window_without_saved_monitor_dpi() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("window-geometry.json");
        let saved = SavedGeometry {
            schema_version: 1,
            windows: HashMap::from([
                ("main".into(), size(1120.0, 740.0)),
                ("secondary".into(), size(960.0, 640.0)),
            ]),
        };
        atomic_write(&file, &serde_json::to_vec(&saved).unwrap()).unwrap();
        let loaded: SavedGeometry = read_json(&file).unwrap();
        assert_eq!(loaded.windows["main"], size(1120.0, 740.0));
        assert_eq!(loaded.windows["secondary"], size(960.0, 640.0));
        let fitted = fit_window(
            rect(0.0, 0.0, 1120.0, 740.0),
            size(0.0, 0.0),
            loaded.windows["main"],
            limits(),
            &[display(0.0, 0.0, 3840.0, 2080.0, 2.0)],
            true,
        )
        .unwrap();
        assert_eq!(fitted.size, PhysicalSize::new(2240, 1480));
    }

    #[test]
    fn explicit_size_request_cannot_be_overwritten_by_queued_native_resize() {
        let mut entry = Entry {
            preferred: size(1400.0, 900.0),
            limits: limits(),
            scale: 1.0,
            pending: None,
            last_applied: None,
            minimum: None,
            was_special: false,
            topology: Vec::new(),
            initial_position: None,
        };
        entry.schedule(true, false);
        entry.request_size(size(1120.0, 740.0), false);
        entry.schedule(true, false);
        let pending = entry.pending.take();
        entry.capture_resize(pending, 1.0, PhysicalSize::new(1400, 900), false, false);
        assert_eq!(entry.preferred, size(1120.0, 740.0));
        assert!(!pending.unwrap().constrain_position);
        entry.request_size(size(1000.0, 680.0), true);
        assert!(entry.pending.unwrap().constrain_position);
    }

    #[test]
    fn initial_client_frame_changes_never_become_user_size_preferences() {
        for policy in [WindowPosition::Remember, WindowPosition::Center] {
            let mut entry = Entry {
                preferred: size(1120.0, 740.0),
                limits: limits(),
                scale: 1.25,
                pending: None,
                last_applied: Some(PhysicalSize::new(1400, 925)),
                minimum: None,
                was_special: false,
                topology: Vec::new(),
                initial_position: Some(policy),
            };
            let resize = Some(Pending {
                due: Instant::now(),
                resized: true,
                preserve: false,
                constrain_position: false,
            });
            entry.capture_resize(resize, 1.25, PhysicalSize::new(1400, 962), false, false);
            assert_eq!(entry.preferred, size(1120.0, 740.0));
            entry.initial_position = None;
            entry.capture_resize(resize, 1.25, PhysicalSize::new(1250, 850), false, false);
            assert_eq!(entry.preferred, size(1000.0, 680.0));
        }
    }

    #[test]
    fn reset_includes_closed_windows_and_prevents_legacy_sizes_from_returning() {
        let mut cache = Cache {
            saved: SavedGeometry {
                schema_version: 1,
                windows: HashMap::from([
                    ("main".into(), size(1400.0, 900.0)),
                    ("closed".into(), size(1600.0, 1000.0)),
                ]),
            },
            legacy: HashMap::from([(
                "legacy".into(),
                LegacySize {
                    width: 2000,
                    height: 1200,
                },
            )]),
            entries: HashMap::new(),
        };
        cache.reset_saved(|label| {
            if label == "closed" {
                size(960.0, 640.0)
            } else {
                size(1120.0, 740.0)
            }
        });
        assert_eq!(cache.saved.windows["main"], size(1120.0, 740.0));
        assert_eq!(cache.saved.windows["closed"], size(960.0, 640.0));
        assert_eq!(cache.saved.windows["legacy"], size(1120.0, 740.0));
        assert!(cache.legacy.is_empty());
    }
}
