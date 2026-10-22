//! 原生退出协商：仅在全部相关窗口完成保存或明确放弃后执行操作。

use crate::error::{ErrorCode, NativeError, NativeResult, bounded_text};
use serde::Serialize;
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU32, Ordering},
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, Serialize, Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LifecycleAction {
    Close,
    Quit,
    Restart,
    InstallUpdate,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleRequest {
    pub id: u32,
    pub action: LifecycleAction,
    pub windows: Vec<String>,
}

struct Pending {
    id: u32,
    waiting: HashSet<String>,
    participants: HashSet<String>,
    result: oneshot::Sender<bool>,
}

fn cancel_pending(pending: &Mutex<Option<Pending>>, id: u32) {
    if let Ok(mut pending) = pending.lock()
        && pending.as_ref().is_some_and(|value| value.id == id)
        && let Some(value) = pending.take()
    {
        let _ = value.result.send(false);
    }
}

#[derive(Default)]
pub struct LifecycleState {
    dirty: Mutex<HashMap<String, Vec<String>>>,
    pending: Arc<Mutex<Option<Pending>>>,
    active: Arc<Mutex<Option<LifecycleAction>>>,
    sequence: AtomicU32,
    pub approved_exit: AtomicBool,
}

impl LifecycleState {
    fn begin(&self, action: LifecycleAction) -> NativeResult<Operation> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?;
        if active.is_some() {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "Another lifecycle operation is already running",
            ));
        }
        let id = self
            .sequence
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        *active = Some(action);
        Ok(Operation {
            id,
            active: self.active.clone(),
            pending: self.pending.clone(),
        })
    }

    pub fn active_action(&self) -> Option<LifecycleAction> {
        self.active
            .lock()
            .map(|active| *active)
            // 状态不可用时阻止破坏性动作，不把故障当作没有协商。
            .unwrap_or(Some(LifecycleAction::InstallUpdate))
    }

    pub fn is_dirty(&self, label: Option<&str>) -> bool {
        self.dirty
            .lock()
            .map(|values| match label {
                Some(label) => values.get(label).is_some_and(|names| !names.is_empty()),
                None => values.values().any(|names| !names.is_empty()),
            })
            .unwrap_or(true)
    }

    fn cancel(&self, id: u32) {
        cancel_pending(&self.pending, id);
    }

    pub fn remove_window(&self, label: &str) {
        if let Ok(mut dirty) = self.dirty.lock() {
            dirty.remove(label);
        }
        let waiting = self.pending.lock().ok().and_then(|pending| {
            pending
                .as_ref()
                .filter(|p| p.waiting.contains(label))
                .map(|p| p.id)
        });
        if let Some(id) = waiting {
            self.cancel(id);
        }
    }

    fn respond(&self, label: &str, id: u32, approved: bool) -> NativeResult<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?;
        let request = pending
            .as_mut()
            .filter(|p| p.id == id && p.participants.contains(label))
            .ok_or_else(|| NativeError::new(ErrorCode::Conflict, "Close request expired"))?;
        if !approved {
            if let Some(value) = pending.take() {
                let _ = value.result.send(false);
            }
            return Ok(());
        }
        request.waiting.remove(label);
        self.dirty
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?
            .remove(label);
        if request.waiting.is_empty()
            && let Some(value) = pending.take()
        {
            let _ = value.result.send(true);
        }
        Ok(())
    }
}

struct Operation {
    id: u32,
    active: Arc<Mutex<Option<LifecycleAction>>>,
    pending: Arc<Mutex<Option<Pending>>>,
}

impl Drop for Operation {
    fn drop(&mut self) {
        cancel_pending(&self.pending, self.id);
        if let Ok(mut active) = self.active.lock() {
            *active = None;
        }
    }
}

pub struct Authorization {
    app: tauri::AppHandle,
    operation: Operation,
    requested: bool,
}
impl Drop for Authorization {
    fn drop(&mut self) {
        let id = self.operation.id;
        if self.requested {
            let _ = self.app.emit("app://lifecycle-finished", id);
        }
        // operation 随后释放占用，覆盖事件通知及实际执行阶段。
    }
}

pub async fn authorize(
    app: &tauri::AppHandle,
    action: LifecycleAction,
    only: Option<&str>,
) -> NativeResult<Authorization> {
    let state = app.state::<LifecycleState>();
    let mut authorization = Authorization {
        app: app.clone(),
        operation: state.begin(action)?,
        requested: false,
    };
    let mut windows: Vec<String> = state
        .dirty
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?
        .iter()
        .filter(|(label, names)| !names.is_empty() && only.is_none_or(|only| *label == only))
        .map(|(label, _)| label.clone())
        .collect();
    // 安装器运行前冻结全部应用窗口，包含当前没有脏稿的窗口。
    if action == LifecycleAction::InstallUpdate
        || (!windows.is_empty()
            && matches!(action, LifecycleAction::Quit | LifecycleAction::Restart))
    {
        windows = app
            .webview_windows()
            .into_keys()
            .filter(|label| matches!(label.as_str(), "main" | "secondary"))
            .collect();
    }
    if windows.is_empty() {
        return Ok(authorization);
    }
    let id = authorization.operation.id;
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state
            .pending
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?;
        *pending = Some(Pending {
            id,
            waiting: windows.iter().cloned().collect(),
            participants: windows.iter().cloned().collect(),
            result: tx,
        });
    }
    authorization.requested = true;
    let request = LifecycleRequest {
        id,
        action,
        windows: windows.clone(),
    };
    for label in &windows {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.show();
            let _ = window.set_focus();
        }
        if app
            .emit_to(label, "app://lifecycle-request", &request)
            .is_err()
        {
            state.cancel(id);
        }
    }
    let accepted = tokio::time::timeout(std::time::Duration::from_secs(180), rx)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false);
    if accepted {
        let _ = app.emit("app://lifecycle-executing", id);
        Ok(authorization)
    } else {
        Err(NativeError::new(
            ErrorCode::UserCancelled,
            "The operation was cancelled; your work is preserved",
        ))
    }
}

pub fn request_action(app: &tauri::AppHandle, action: LifecycleAction, label: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _authorization = match authorize(&app, action, label.as_deref()).await {
            Ok(value) => value,
            Err(error) => {
                if error.code != ErrorCode::UserCancelled {
                    log::warn!("Lifecycle request: {error}");
                }
                return;
            }
        };
        match action {
            LifecycleAction::Close => {
                if let Some(window) = label.and_then(|label| app.get_webview_window(&label)) {
                    let _ = window.destroy();
                }
            }
            LifecycleAction::Quit => {
                app.state::<LifecycleState>()
                    .approved_exit
                    .store(true, Ordering::Release);
                app.exit(0);
            }
            LifecycleAction::Restart => {
                app.state::<LifecycleState>()
                    .approved_exit
                    .store(true, Ordering::Release);
                app.restart();
            }
            LifecycleAction::InstallUpdate => {}
        }
    });
}

#[tauri::command]
#[specta::specta]
pub fn set_window_work_state(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LifecycleState>,
    names: Vec<String>,
) -> NativeResult<()> {
    if names.len() > 20 {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Too many unsaved work items",
        ));
    }
    for name in &names {
        bounded_text(name, 160, "Work label")?;
    }
    state
        .dirty
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?
        .insert(window.label().to_owned(), names);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn respond_lifecycle(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, LifecycleState>,
    id: u32,
    approved: bool,
) -> NativeResult<()> {
    state.respond(window.label(), id, approved)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dirty_state_is_per_window_and_destroy_cancels_pending() {
        let state = LifecycleState::default();
        state
            .dirty
            .lock()
            .unwrap()
            .insert("main".into(), vec!["Notes".into()]);
        assert!(state.is_dirty(None));
        assert!(!state.is_dirty(Some("secondary")));
        let (tx, mut rx) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(Pending {
            id: 1,
            waiting: HashSet::from(["main".into()]),
            participants: HashSet::from(["main".into()]),
            result: tx,
        });
        state.remove_window("main");
        assert!(!state.is_dirty(None));
        assert_eq!(rx.try_recv(), Ok(false));
    }
    #[test]
    fn authorization_stays_exclusive_after_the_last_window_approves() {
        let state = LifecycleState::default();
        let operation = state.begin(LifecycleAction::InstallUpdate).unwrap();
        // 无脏工作同样不能穿透正在执行的安装。
        assert!(!state.is_dirty(None));
        assert!(matches!(
            state.begin(LifecycleAction::Quit),
            Err(NativeError {
                code: ErrorCode::Conflict,
                ..
            })
        ));
        let (tx, mut rx) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(Pending {
            id: operation.id,
            waiting: HashSet::from(["main".into()]),
            participants: HashSet::from(["main".into()]),
            result: tx,
        });
        state.respond("main", operation.id, true).unwrap();
        assert_eq!(rx.try_recv(), Ok(true));
        assert!(state.pending.lock().unwrap().is_none());
        assert!(state.begin(LifecycleAction::Restart).is_err());
        assert_eq!(state.active_action(), Some(LifecycleAction::InstallUpdate));
        drop(operation);
        assert!(state.begin(LifecycleAction::Quit).is_ok());
    }

    #[test]
    fn cancellation_and_dropped_async_operations_release_pending_work() {
        for explicitly_cancel in [true, false] {
            let state = LifecycleState::default();
            let operation = state.begin(LifecycleAction::Restart).unwrap();
            let (tx, mut rx) = oneshot::channel();
            *state.pending.lock().unwrap() = Some(Pending {
                id: operation.id,
                waiting: HashSet::from(["main".into()]),
                participants: HashSet::from(["main".into()]),
                result: tx,
            });
            if explicitly_cancel {
                state.respond("main", operation.id, false).unwrap();
            }
            drop(operation);
            assert_eq!(rx.try_recv(), Ok(false));
            assert!(state.pending.lock().unwrap().is_none());
            assert!(state.active_action().is_none());
            assert!(state.begin(LifecycleAction::Quit).is_ok());
        }
    }

    #[test]
    fn finishing_an_old_request_does_not_cancel_a_new_request() {
        let state = LifecycleState::default();
        let (tx, mut rx) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(Pending {
            id: 2,
            waiting: HashSet::from(["main".into()]),
            participants: HashSet::from(["main".into()]),
            result: tx,
        });
        state.cancel(1);
        assert!(rx.try_recv().is_err());
        assert_eq!(state.pending.lock().unwrap().as_ref().unwrap().id, 2);
        state.cancel(2);
        assert_eq!(rx.try_recv(), Ok(false));
    }
}
