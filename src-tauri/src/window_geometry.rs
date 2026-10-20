//! Keep normal windows usable after DPI, remote-desktop and monitor-layout changes.
//! Sizes are persisted in logical pixels; monitor coordinates remain physical pixels.

use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    Manager, PhysicalPosition, PhysicalSize, RunEvent, Window, WindowEvent, plugin::TauriPlugin,
};
use tauri_plugin_window_state::AppHandleExt;

use crate::storage::{DataPaths, atomic_write};

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
    // Leave room for native borders/title bars. An undersized screen takes precedence
    // over the application's normal minimum, so even an 800x600 desktop stays usable.
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
    // Normal drags may deliberately leave part of a window outside the desktop.
    // Bring it fully inside only for environment recovery, oversized windows or an
    // inaccessible title area; never turn each move event into edge snapping.
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
}

impl Entry {
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

struct GeometryState {
    path: PathBuf,
    cache: Mutex<Cache>,
    stopped: AtomicBool,
    queued: AtomicBool,
}

impl GeometryState {
    fn save(&self) {
        let bytes = self
            .cache
            .lock()
            .ok()
            .and_then(|cache| serde_json::to_vec_pretty(&cache.saved).ok());
        if let Some(bytes) = bytes
            && let Err(error) = atomic_write(&self.path, &bytes)
        {
            log::warn!("Cannot save logical window geometry: {error}");
        }
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
    // Read only our window thread's GUI state; no hooks, input synthesis or focus changes.
    unsafe {
        let thread = GetWindowThreadProcessId(hwnd.0, std::ptr::null_mut());
        thread != 0 && GetGUIThreadInfo(thread, &mut info) != 0 && info.flags & GUI_INMOVESIZE != 0
    }
}

#[cfg(not(windows))]
fn interacting(_window: &Window) -> bool {
    false
}

fn repair(window: &Window, state: &GeometryState, displays: &[Display]) -> tauri::Result<()> {
    if interacting(window) {
        if let Ok(mut cache) = state.cache.lock()
            && let Some(entry) = cache.entries.get_mut(window.label())
        {
            entry.schedule(false, false);
        }
        return Ok(());
    }
    // Consume before fallible APIs: unsupported global positioning must not loop.
    let pending = state.cache.lock().ok().and_then(|mut cache| {
        cache
            .entries
            .get_mut(window.label())
            .and_then(|entry| entry.pending.take())
    });
    let scale = window.scale_factor()?;
    if !scale.is_finite() || scale <= 0.0 {
        return Ok(());
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
            return Ok(());
        };
        let Some(entry) = cache.entries.get_mut(window.label()) else {
            return Ok(());
        };
        // Detect topology again here: an OS resize can precede the polling tick.
        // It must never overwrite the user's last normal logical size.
        let topology_changed = entry.topology != displays;
        entry.capture_resize(pending, scale, inner, is_special, topology_changed);
        let Some(placement) = fit_window(
            current,
            frame,
            entry.preferred,
            entry.limits,
            displays,
            topology_changed || pending.is_some_and(|pending| pending.constrain_position),
        ) else {
            return Ok(());
        };
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
        if placement.position != position {
            window.set_position(placement.position)?;
        }
        if placement.size != inner {
            window.set_size(placement.size)?;
        }
    }
    if changed {
        state.save();
    }
    Ok(())
}

fn track(window: Window) {
    let app = window.app_handle();
    let state = app.state::<Arc<GeometryState>>().inner().clone();
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let size = window.inner_size().unwrap_or(PhysicalSize::new(1120, 740));
    let monitors = displays(app);
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .or_else(|| app.config().app.windows.first());
    let limits = Limits {
        min: LogicalSize {
            width: config.and_then(|config| config.min_width).unwrap_or(1.0),
            height: config.and_then(|config| config.min_height).unwrap_or(1.0),
        },
        max_width: config.and_then(|config| config.max_width),
        max_height: config.and_then(|config| config.max_height),
    };
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
            .unwrap_or(LogicalSize {
                width: f64::from(size.width) / scale,
                height: f64::from(size.height) / scale,
            });
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
                was_special: special(&window),
                topology: monitors.clone(),
            },
        );
    }
    // Runs after window-state's ready callback, while the initial renderer is still hidden.
    if let Err(error) = repair(&window, &state, &monitors) {
        log::warn!("Cannot fit initial window: {error}");
    }
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
            state.save();
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
            // Migrate physical sizes once. The old plugin has no saved DPI; clamp this
            // best-effort conversion to the present work area and save future sizes in DIP.
            let legacy =
                read_json(&app.path().app_config_dir()?.join(app.filename())).unwrap_or_default();
            let state = Arc::new(GeometryState {
                path,
                cache: Mutex::new(Cache {
                    saved,
                    legacy,
                    entries: HashMap::new(),
                }),
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
                state.save();
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
}
