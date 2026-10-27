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
const INITIAL_CONFIRMATIONS: u8 = 10;

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

#[derive(Debug, Clone, Copy, PartialEq)]
struct Placement {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    minimum: PhysicalSize<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct InitialTarget {
    size: PhysicalSize<u32>,
    outer: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
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

fn outer_for_size(
    target: PhysicalSize<u32>,
    inner: PhysicalSize<u32>,
    outer: PhysicalSize<u32>,
) -> PhysicalSize<u32> {
    PhysicalSize::new(
        target
            .width
            .saturating_add(outer.width.saturating_sub(inner.width)),
        target
            .height
            .saturating_add(outer.height.saturating_sub(inner.height)),
    )
}

fn placement_confirmed(
    inner: PhysicalSize<u32>,
    outer: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    target_size: PhysicalSize<u32>,
    target_outer: PhysicalSize<u32>,
    target_position: PhysicalPosition<i32>,
) -> bool {
    inner == target_size
        && outer == target_outer
        && outer.width >= inner.width
        && outer.height >= inner.height
        && position.x.abs_diff(target_position.x) <= 1
        && position.y.abs_diff(target_position.y) <= 1
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

#[derive(Default, Deserialize)]
struct PluginWindowState {
    width: u32,
    height: u32,
    x: Option<i32>,
    y: Option<i32>,
    prev_x: Option<i32>,
    prev_y: Option<i32>,
    #[serde(default)]
    maximized: bool,
}

impl PluginWindowState {
    fn position(&self) -> Option<PhysicalPosition<i32>> {
        let position = if self.maximized {
            self.prev_x.zip(self.prev_y)
        } else {
            self.x.zip(self.y)
        };
        position.map(|(x, y)| PhysicalPosition::new(x, y))
    }
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
    initial_origin: Option<PhysicalPosition<i32>>,
    initial_confirmations: u8,
    initial_target: Option<InitialTarget>,
}

#[derive(Debug, PartialEq)]
enum InitialProgress {
    Waiting,
    Complete,
    Unconfirmed,
}

impl Entry {
    fn initial_rect(&self, current: Rect) -> Rect {
        if self.initial_position.is_some()
            && let Some(position) = self.initial_origin
        {
            return Rect {
                x: f64::from(position.x),
                y: f64::from(position.y),
                ..current
            };
        }
        current
    }

    fn confirm_initial(&mut self, visible: bool, confirmed: bool) -> InitialProgress {
        if self.initial_position.is_none() {
            return InitialProgress::Complete;
        }
        if visible && confirmed {
            self.initial_position = None;
            self.initial_origin = None;
            self.initial_target = None;
            return InitialProgress::Complete;
        }
        if visible {
            self.initial_confirmations = self.initial_confirmations.saturating_add(1);
            if self.initial_confirmations >= INITIAL_CONFIRMATIONS {
                self.initial_position = None;
                self.initial_origin = None;
                self.initial_target = None;
                return InitialProgress::Unconfirmed;
            }
        }
        // GTK 等窗口系统异步配置位置和尺寸；请求返回不代表真实布局已经生效。
        // 继续保护初始偏好，并交由工作线程复核，避免阻塞消息循环。
        // initial_position 已保护启动尺寸，不占用 DPI 或显式尺寸请求的 preserve 标记。
        self.schedule(false, false);
        InitialProgress::Waiting
    }

    fn observe_initial(
        &mut self,
        visible: bool,
        inner: PhysicalSize<u32>,
        outer: PhysicalSize<u32>,
        position: PhysicalPosition<i32>,
    ) {
        if self.initial_position.is_some()
            && visible
            && self.initial_target.is_some_and(|target| {
                placement_confirmed(
                    inner,
                    outer,
                    position,
                    target.size,
                    target.outer,
                    target.position,
                )
            })
        {
            // 原生配置事件确认后立即结束，避免等待下一轮复核时覆盖用户移动。
            self.initial_position = None;
            self.initial_origin = None;
            self.initial_target = None;
        }
    }

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
    legacy: HashMap<String, PluginWindowState>,
    positions: HashMap<String, PhysicalPosition<i32>>,
    entries: HashMap<String, Entry>,
}

impl Cache {
    fn observe_position(&mut self, label: &str, position: PhysicalPosition<i32>, normal: bool) {
        if normal
            && self
                .entries
                .get(label)
                .is_some_and(|entry| entry.initial_position.is_none())
        {
            // 保留进程内最近的正常位置，关闭后重建窗口不再使用过期的启动快照。
            self.positions.insert(label.to_owned(), position);
        }
    }

    fn reset_saved(&mut self, default: impl Fn(&str) -> Option<LogicalSize>) {
        // 同时重置未打开窗口的尺寸，防止下次创建窗口时重新载入旧值。
        self.saved.windows.retain(|label, preferred| {
            if let Some(size) = default(label) {
                *preferred = size;
                true
            } else {
                false
            }
        });
        for label in self.legacy.keys() {
            if let Some(size) = default(label) {
                self.saved.windows.insert(label.clone(), size);
            }
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
    let extension = label.starts_with("extension-");
    let extension_size = extension
        .then(|| {
            app.try_state::<crate::extension_windows::ExtensionWindows>()
                .and_then(|state| state.default_size(label))
        })
        .flatten();
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == label)
        .or_else(|| app.config().app.windows.first());
    (
        LogicalSize {
            width: extension_size.map_or_else(
                || config.map_or(1120.0, |config| config.width),
                |size| f64::from(size.width),
            ),
            height: extension_size.map_or_else(
                || config.map_or(740.0, |config| config.height),
                |size| f64::from(size.height),
            ),
        },
        Limits {
            min: LogicalSize {
                width: if extension {
                    360.0
                } else {
                    config.and_then(|config| config.min_width).unwrap_or(1.0)
                },
                height: if extension {
                    480.0
                } else {
                    config.and_then(|config| config.min_height).unwrap_or(1.0)
                },
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
        // 动态扩展未必在本次进程打开过；清除尺寸，让下次创建读取其当前清单默认。
        cache.reset_saved(|label| {
            (!label.starts_with("extension-")).then(|| configured(&handle, label).0)
        });
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
    let center = initial_position == Some(WindowPosition::Center);
    let maximized = center && window.is_maximized().unwrap_or(false);
    let fullscreen = center && window.is_fullscreen().unwrap_or(false);
    let minimized = center && window.is_minimized().unwrap_or(false);
    let result = (|| {
        if initial_position.is_some() {
            normalize_initial_frame(window)?;
        }
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
    // 异步还原尚未进入正常态时保留原显示状态，避免反复还原、最大化造成闪烁。
    let unavailable = center && (maximized || fullscreen || minimized) && special(window);
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
    let visible = window.is_visible().unwrap_or(true);
    if let Ok(mut cache) = state.cache.lock()
        && let Some(entry) = cache.entries.get_mut(window.label())
    {
        // 仅在真实布局已确认后消费策略；后续移动、聚焦和重复激活不再居中。
        let progress = if unavailable {
            entry.initial_position = None;
            entry.initial_origin = None;
            entry.initial_target = None;
            InitialProgress::Unconfirmed
        } else {
            entry.confirm_initial(
                visible,
                result.as_ref().is_ok_and(|confirmed| *confirmed) && restored.is_ok(),
            )
        };
        if progress == InitialProgress::Unconfirmed {
            log::warn!(
                "Window manager did not confirm initial placement for {}",
                window.label()
            );
        }
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
    let (placement, current, minimum_changed, changed) = {
        let Ok(mut cache) = state.cache.lock() else {
            return Ok(false);
        };
        let Some(entry) = cache.entries.get_mut(window.label()) else {
            return Ok(false);
        };
        // 系统尺寸事件可能早于轮询，重新检查布局，防止覆盖上一次正常逻辑尺寸。
        let topology_changed = entry.topology != displays;
        entry.capture_resize(pending, scale, inner, is_special, topology_changed);
        // 原生恢复可能仍在异步队列中；首次适配以明确存档目标为准，不能固化旧坐标。
        let current = entry.initial_rect(current);
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
        (placement, current, minimum_changed, changed)
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
        // 异步 resize 尚未配置时，按目标客户端尺寸加已测边框计算外框。
        // 已配置后该值即真实外框，避免旧尺寸或初始零缓存导致错误居中。
        let target_outer =
            outer_for_size(placement.size, window.inner_size()?, window.outer_size()?);
        let position = if center {
            centered_position(
                current,
                LogicalSize {
                    width: 0.0,
                    height: 0.0,
                },
                target_outer,
                displays,
            )
            .unwrap_or(placement.position)
        } else {
            placement.position
        };
        if let Ok(mut cache) = state.cache.lock()
            && let Some(entry) = cache.entries.get_mut(window.label())
            && entry.initial_position.is_some()
        {
            entry.initial_target = Some(InitialTarget {
                size: placement.size,
                outer: target_outer,
                position,
            });
        }
        if position != window.outer_position()? {
            window.set_position(position)?;
        }
        if changed {
            state.dirty.store(true, Ordering::Release);
        }
        return Ok(placement_confirmed(
            window.inner_size()?,
            window.outer_size()?,
            window.outer_position()?,
            placement.size,
            target_outer,
            position,
        ));
    }
    if changed {
        state.dirty.store(true, Ordering::Release);
    }
    Ok(!center)
}

/// 由主线程显示入口准备初始布局，异步窗口系统在配置事件后确认最终位置。
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
        let initial_origin = cache.positions.get(window.label()).copied();
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
                initial_origin,
                initial_confirmations: 0,
                initial_target: None,
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
            let observing = state.cache.lock().is_ok_and(|cache| {
                cache.entries.get(copy.label()).is_some_and(|entry| {
                    entry.initial_position.is_some() && entry.initial_target.is_some()
                })
            });
            // 只读原生缓存；窗口事件内不修改几何，也不持锁调用原生 API。
            let position = if observing || matches!(event, WindowEvent::Moved(_)) {
                copy.outer_position().ok()
            } else {
                None
            };
            let observed = if observing {
                (|| {
                    Some((
                        copy.is_visible().ok()?,
                        copy.inner_size().ok()?,
                        copy.outer_size().ok()?,
                        position?,
                    ))
                })()
            } else {
                None
            };
            if let Ok(mut cache) = state.cache.lock()
                && let Some(entry) = cache.entries.get_mut(copy.label())
            {
                if let Some((visible, inner, outer, position)) = observed {
                    entry.observe_initial(visible, inner, outer, position);
                }
                entry.was_special |= is_special;
                entry.schedule(resized, preserve || is_special);
                if let Some(position) = position {
                    cache.observe_position(copy.label(), position, !is_special);
                }
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
            let legacy: HashMap<String, PluginWindowState> =
                read_json(&app.path().app_config_dir()?.join(app.filename())).unwrap_or_default();
            // 位置沿用插件格式；在首次变更前捕获，避免异步恢复期间的移动污染目标。
            let positions = legacy
                .iter()
                .filter_map(|(label, state)| {
                    state.position().map(|position| (label.clone(), position))
                })
                .collect();
            let state = Arc::new(GeometryState {
                path,
                cache: Mutex::new(Cache {
                    saved,
                    legacy,
                    positions,
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
            initial_origin: None,
            initial_confirmations: 0,
            initial_target: None,
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
            initial_origin: None,
            initial_confirmations: 0,
            initial_target: None,
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
                initial_origin: None,
                initial_confirmations: 0,
                initial_target: None,
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

    fn starting_entry() -> Entry {
        Entry {
            preferred: size(1000.0, 680.0),
            limits: limits(),
            scale: 1.0,
            pending: None,
            last_applied: Some(PhysicalSize::new(1000, 680)),
            minimum: None,
            was_special: false,
            topology: Vec::new(),
            initial_position: Some(WindowPosition::Center),
            initial_origin: None,
            initial_confirmations: 0,
            initial_target: Some(InitialTarget {
                size: PhysicalSize::new(1000, 680),
                outer: PhysicalSize::new(1000, 680),
                position: PhysicalPosition::new(12, 44),
            }),
        }
    }

    #[test]
    fn initial_placement_waits_for_visible_configured_geometry_without_blocking() {
        let mut entry = starting_entry();
        assert_eq!(entry.confirm_initial(false, true), InitialProgress::Waiting);
        assert_eq!(entry.initial_confirmations, 0);
        assert!(!entry.pending.unwrap().preserve);
        assert_eq!(entry.confirm_initial(true, false), InitialProgress::Waiting);
        assert_eq!(entry.initial_position, Some(WindowPosition::Center));
        entry.observe_initial(
            true,
            PhysicalSize::new(1120, 740),
            PhysicalSize::new(1120, 740),
            PhysicalPosition::new(12, 44),
        );
        assert_eq!(entry.initial_position, Some(WindowPosition::Center));
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 680),
            PhysicalSize::new(0, 0),
            PhysicalPosition::new(12, 44),
        );
        assert_eq!(entry.initial_position, Some(WindowPosition::Center));
    }

    #[test]
    fn native_confirmation_consumes_centering_before_the_next_user_move() {
        let mut entry = starting_entry();
        assert_eq!(entry.confirm_initial(false, true), InitialProgress::Waiting);
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 680),
            PhysicalSize::new(1000, 680),
            PhysicalPosition::new(12, 44),
        );
        assert_eq!(entry.initial_position, None);
        assert_eq!(entry.initial_target, None);
        entry.schedule(true, false);
        let pending = entry.pending.take();
        entry.capture_resize(pending, 1.0, PhysicalSize::new(1010, 690), false, false);
        assert_eq!(entry.preferred, size(1010.0, 690.0));
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 680),
            PhysicalSize::new(1000, 680),
            PhysicalPosition::new(30, 30),
        );
        assert_eq!(
            entry.confirm_initial(true, false),
            InitialProgress::Complete
        );
        assert!(entry.pending.is_none());
    }

    #[test]
    fn mapped_frame_changes_require_recomputed_center_before_confirmation() {
        let mut entry = starting_entry();
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 680),
            PhysicalSize::new(1016, 718),
            PhysicalPosition::new(12, 44),
        );
        assert_eq!(entry.initial_position, Some(WindowPosition::Center));
        entry.initial_target = Some(InitialTarget {
            size: PhysicalSize::new(1000, 680),
            outer: PhysicalSize::new(1016, 718),
            position: PhysicalPosition::new(4, 25),
        });
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 680),
            PhysicalSize::new(1016, 718),
            PhysicalPosition::new(4, 25),
        );
        assert_eq!(entry.initial_position, None);
    }

    #[test]
    fn initial_confirmation_preserves_independent_size_and_dpi_protection() {
        let mut entry = starting_entry();
        entry.request_size(size(1000.0, 680.0), false);
        entry.confirm_initial(false, true);
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 680),
            PhysicalSize::new(1000, 680),
            PhysicalPosition::new(12, 44),
        );
        assert_eq!(entry.initial_position, None);
        assert!(entry.pending.unwrap().preserve);
    }

    #[test]
    fn unsupported_positioning_has_bounded_initial_confirmation() {
        let mut entry = starting_entry();
        for _ in 1..INITIAL_CONFIRMATIONS {
            assert_eq!(entry.confirm_initial(true, false), InitialProgress::Waiting);
        }
        assert_eq!(
            entry.confirm_initial(true, false),
            InitialProgress::Unconfirmed
        );
        assert_eq!(entry.initial_position, None);
        assert_eq!(entry.initial_target, None);
    }

    #[test]
    fn async_resize_centering_uses_target_size_and_preserves_measured_frame() {
        let target = PhysicalSize::new(1000, 680);
        assert_eq!(
            outer_for_size(
                target,
                PhysicalSize::new(1120, 740),
                PhysicalSize::new(0, 0)
            ),
            target
        );
        assert_eq!(
            outer_for_size(
                target,
                PhysicalSize::new(1120, 740),
                PhysicalSize::new(1136, 778)
            ),
            PhysicalSize::new(1016, 718)
        );
        assert_eq!(
            outer_for_size(target, target, PhysicalSize::new(1016, 718)),
            PhysicalSize::new(1016, 718)
        );
        assert_eq!(
            centered_position(
                rect(0.0, 0.0, 0.0, 0.0),
                size(0.0, 0.0),
                target,
                &[display(0.0, 0.0, 1024.0, 768.0, 1.0)]
            ),
            Some(PhysicalPosition::new(12, 44))
        );
    }

    #[test]
    fn saved_position_survives_async_restore_with_a_larger_initial_window() {
        let mut entry = starting_entry();
        entry.preferred = size(1000.0, 677.0);
        entry.initial_position = Some(WindowPosition::Remember);
        entry.initial_origin = Some(PhysicalPosition::new(24, 31));
        let monitors = [display(0.0, 31.0, 1024.0, 677.0, 1.0)];
        for current in [
            rect(0.0, 0.0, 1120.0, 740.0),
            rect(0.0, 31.0, 1000.0, 677.0),
        ] {
            let placement = fit_window(
                entry.initial_rect(current),
                size(0.0, 0.0),
                entry.preferred,
                entry.limits,
                &monitors,
                true,
            )
            .unwrap();
            assert_eq!(placement.size, PhysicalSize::new(1000, 677));
            assert_eq!(placement.position, PhysicalPosition::new(24, 31));
            entry.initial_target = Some(InitialTarget {
                size: placement.size,
                outer: placement.size,
                position: placement.position,
            });
        }
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 677),
            PhysicalSize::new(1000, 677),
            PhysicalPosition::new(0, 31),
        );
        assert_eq!(entry.initial_position, Some(WindowPosition::Remember));
        entry.observe_initial(
            true,
            PhysicalSize::new(1000, 677),
            PhysicalSize::new(1000, 677),
            PhysicalPosition::new(24, 31),
        );
        assert_eq!(entry.initial_position, None);
        assert_eq!(entry.initial_origin, None);
        let moved = rect(5.0, 31.0, 1000.0, 677.0);
        assert_eq!(entry.initial_rect(moved), moved);
    }

    #[test]
    fn plugin_positions_restore_normal_bounds_and_allow_missing_legacy_coordinates() {
        let normal: PluginWindowState = serde_json::from_value(serde_json::json!({
            "width": 0, "height": 0, "x": 24, "y": 31,
            "prev_x": 0, "prev_y": 31, "maximized": false
        }))
        .unwrap();
        assert_eq!(normal.position(), Some(PhysicalPosition::new(24, 31)));
        let maximized = PluginWindowState {
            maximized: true,
            ..normal
        };
        assert_eq!(maximized.position(), Some(PhysicalPosition::new(0, 31)));
        let legacy: PluginWindowState =
            serde_json::from_str(r#"{"width":1120,"height":740}"#).unwrap();
        assert_eq!(legacy.position(), None);
    }

    #[test]
    fn recreated_windows_use_the_latest_confirmed_normal_position() {
        let mut cache = Cache {
            saved: SavedGeometry::default(),
            legacy: HashMap::new(),
            positions: HashMap::from([("secondary".into(), PhysicalPosition::new(24, 31))]),
            entries: HashMap::from([("secondary".into(), starting_entry())]),
        };
        cache.observe_position("secondary", PhysicalPosition::new(0, 0), true);
        assert_eq!(cache.positions["secondary"], PhysicalPosition::new(24, 31));
        cache.entries.get_mut("secondary").unwrap().initial_position = None;
        cache.observe_position("secondary", PhysicalPosition::new(50, 60), true);
        cache.observe_position("secondary", PhysicalPosition::new(0, 0), false);
        cache.entries.remove("secondary");
        assert_eq!(cache.positions["secondary"], PhysicalPosition::new(50, 60));
    }

    #[test]
    fn reset_includes_closed_windows_and_prevents_legacy_sizes_from_returning() {
        let mut cache = Cache {
            saved: SavedGeometry {
                schema_version: 1,
                windows: HashMap::from([
                    ("main".into(), size(1400.0, 900.0)),
                    ("closed".into(), size(1600.0, 1000.0)),
                    ("extension-game".into(), size(1500.0, 1100.0)),
                ]),
            },
            legacy: HashMap::from([
                (
                    "legacy".into(),
                    PluginWindowState {
                        width: 2000,
                        height: 1200,
                        ..Default::default()
                    },
                ),
                ("extension-legacy".into(), PluginWindowState::default()),
            ]),
            positions: HashMap::new(),
            entries: HashMap::new(),
        };
        cache.reset_saved(|label| {
            if label.starts_with("extension-") {
                None
            } else if label == "closed" {
                Some(size(960.0, 640.0))
            } else {
                Some(size(1120.0, 740.0))
            }
        });
        assert_eq!(cache.saved.windows["main"], size(1120.0, 740.0));
        assert_eq!(cache.saved.windows["closed"], size(960.0, 640.0));
        assert_eq!(cache.saved.windows["legacy"], size(1120.0, 740.0));
        assert!(!cache.saved.windows.contains_key("extension-game"));
        assert!(!cache.saved.windows.contains_key("extension-legacy"));
        assert!(cache.legacy.is_empty());
    }
}
