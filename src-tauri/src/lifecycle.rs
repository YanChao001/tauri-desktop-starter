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
struct Activity {
    action: Option<LifecycleAction>,
    window_creations: usize,
    exit_reservations: usize,
    exiting: bool,
}

#[derive(Default)]
pub struct LifecycleState {
    dirty: Mutex<HashMap<String, Vec<String>>>,
    pending: Arc<Mutex<Option<Pending>>>,
    active: Arc<Mutex<Activity>>,
    sequence: AtomicU32,
    waiting_for_window_creation: AtomicBool,
    pub approved_exit: AtomicBool,
}

impl LifecycleState {
    fn begin(&self, action: LifecycleAction) -> NativeResult<Operation> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?;
        if active.action.is_some()
            || active.window_creations > 0
            || active.exit_reservations > 0
            || active.exiting
            || self.approved_exit.load(Ordering::Acquire)
        {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "Another lifecycle operation or window creation is already running",
            ));
        }
        let id = self
            .sequence
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        active.action = Some(action);
        Ok(Operation {
            id,
            active: self.active.clone(),
            pending: self.pending.clone(),
        })
    }

    pub fn active_action(&self) -> Option<LifecycleAction> {
        self.active
            .lock()
            .map(|active| active.action)
            // 状态不可用时阻止破坏性动作，不把故障当作没有协商。
            .unwrap_or(Some(LifecycleAction::InstallUpdate))
    }

    /// 与退出协商原子互斥，构建窗口期间不持锁，避免原生事件重入死锁。
    pub fn begin_window_creation(&self) -> NativeResult<WindowCreation> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?;
        if active.action.is_some()
            || active.exit_reservations > 0
            || active.exiting
            || self.approved_exit.load(Ordering::Acquire)
        {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "A lifecycle operation is already running",
            ));
        }
        active.window_creations += 1;
        Ok(WindowCreation(self.active.clone()))
    }

    #[cfg(test)]
    fn creating_windows(&self) -> bool {
        self.active
            .lock()
            .map_or(true, |active| active.window_creations > 0)
    }

    /// 在判断是否真正退出前预留边界，期间不能插入新窗口或另一轮协商。
    pub fn reserve_exit(&self) -> NativeResult<Option<ExitReservation>> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?;
        if active.window_creations > 0 {
            return Ok(None);
        }
        active.exit_reservations += 1;
        Ok(Some(ExitReservation(self.active.clone())))
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
    active: Arc<Mutex<Activity>>,
    pending: Arc<Mutex<Option<Pending>>>,
}

impl Drop for Operation {
    fn drop(&mut self) {
        cancel_pending(&self.pending, self.id);
        if let Ok(mut active) = self.active.lock() {
            active.action = None;
        }
    }
}

pub struct WindowCreation(Arc<Mutex<Activity>>);

impl Drop for WindowCreation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.lock() {
            active.window_creations -= 1;
        }
    }
}

pub struct ExitReservation(Arc<Mutex<Activity>>);

impl ExitReservation {
    pub fn commit(self) -> NativeResult<()> {
        self.0
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Lifecycle state unavailable"))?
            .exiting = true;
        Ok(())
    }
}

impl Drop for ExitReservation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.lock() {
            active.exit_reservations -= 1;
        }
    }
}

/// 关闭最后窗口时，仍在创建的新窗口决定是否需要继续运行。
pub fn defer_exit_for_window_creation(app: &tauri::AppHandle, code: Option<i32>) {
    let state = app.state::<LifecycleState>();
    if !state
        .waiting_for_window_creation
        .swap(true, Ordering::AcqRel)
    {
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state = handle.state::<LifecycleState>();
            let reservation = loop {
                match state.reserve_exit() {
                    Ok(Some(reservation)) => break reservation,
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(10)),
                    Err(error) => {
                        log::warn!("Cannot resume deferred exit: {error}");
                        state
                            .waiting_for_window_creation
                            .store(false, Ordering::Release);
                        return;
                    }
                }
            };
            state
                .waiting_for_window_creation
                .store(false, Ordering::Release);
            let allowed = state.approved_exit.load(Ordering::Acquire)
                || (!state.is_dirty(None)
                    && state
                        .active_action()
                        .is_none_or(|action| action == LifecycleAction::Close));
            // 先预留再查看窗口，避免空窗口检查后又完成一次新建。
            if handle.webview_windows().is_empty() && allowed {
                if let Err(error) = reservation.commit() {
                    log::warn!("Cannot confirm deferred exit: {error}");
                    return;
                }
                state.approved_exit.store(true, Ordering::Release);
                handle.exit(code.unwrap_or(0));
            }
        });
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
            .filter(|label| {
                matches!(label.as_str(), "main" | "secondary") || label.starts_with("extension-")
            })
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
                    let store = app
                        .state::<crate::extensions::ExtensionStore>()
                        .inner()
                        .clone();
                    let owner = window.label().to_owned();
                    let closing_store = store.clone();
                    let closing_owner = owner.clone();
                    if let Err(error) = crate::blocking::run(move || {
                        closing_store.begin_window_close(&closing_owner)?;
                        closing_store.wait_window_stopped(&closing_owner);
                        Ok(())
                    })
                    .await
                    {
                        log::warn!("Cannot stop closing window extensions: {error}");
                        return;
                    }
                    if let Err(error) = window.destroy() {
                        // 销毁失败时窗口仍可继续工作，恢复其运行入口。
                        if let Err(reopen_error) = store.reopen_window(&owner) {
                            log::warn!("Cannot restore window extension entry: {reopen_error}");
                        }
                        log::warn!("Cannot close window: {error}");
                    }
                }
            }
            LifecycleAction::Quit => {
                app.state::<LifecycleState>()
                    .approved_exit
                    .store(true, Ordering::Release);
                app.exit(0);
            }
            LifecycleAction::Restart => {
                let extensions = app
                    .state::<crate::extensions::ExtensionStore>()
                    .inner()
                    .clone();
                if crate::blocking::run(move || {
                    // 先获得阻塞执行名额；队列满时不能提前永久关闭扩展入口。
                    extensions.begin_shutdown();
                    extensions.wait_stopped();
                    Ok(())
                })
                .await
                .is_err()
                {
                    return;
                }
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

    #[test]
    fn window_creation_and_lifecycle_authorization_cannot_overtake_each_other() {
        let state = LifecycleState::default();
        let main = state.begin_window_creation().unwrap();
        let extension = state.begin_window_creation().unwrap();
        assert!(state.creating_windows());
        // 查询会重新加锁；创建租约不能将锁一直持有至原生 build 返回。
        assert!(state.active_action().is_none());
        for action in [LifecycleAction::Quit, LifecycleAction::InstallUpdate] {
            assert_eq!(state.begin(action).err().unwrap().code, ErrorCode::Conflict);
        }
        drop(main);
        assert!(state.begin(LifecycleAction::Restart).is_err());
        drop(extension);
        assert!(!state.creating_windows());
        let update = state.begin(LifecycleAction::InstallUpdate).unwrap();
        assert_eq!(
            state.begin_window_creation().err().unwrap().code,
            ErrorCode::Conflict
        );
        drop(update);
        assert!(state.begin_window_creation().is_ok());
        state.approved_exit.store(true, Ordering::Release);
        assert!(state.begin_window_creation().is_err());
        assert!(state.begin(LifecycleAction::InstallUpdate).is_err());
    }

    #[test]
    fn exit_decisions_and_window_creation_share_an_atomic_boundary() {
        let state = LifecycleState::default();
        let creation = state.begin_window_creation().unwrap();
        assert!(state.reserve_exit().unwrap().is_none());
        drop(creation);
        let exit = state.reserve_exit().unwrap().unwrap();
        assert!(state.begin_window_creation().is_err());
        assert!(state.begin(LifecycleAction::Quit).is_err());
        // 主退出回调与延迟退出检查可以同时预留，取消一方不能释放另一方的边界。
        let deferred = state.reserve_exit().unwrap().unwrap();
        drop(exit);
        assert!(state.begin_window_creation().is_err());
        drop(deferred);
        assert!(state.begin_window_creation().is_ok());

        state.reserve_exit().unwrap().unwrap().commit().unwrap();
        assert!(state.begin_window_creation().is_err());
        assert!(state.begin(LifecycleAction::Restart).is_err());
        // 等实际 Wasm 停止后重新收到 ExitRequested 时，仍可完成同一次退出。
        let retry = state.reserve_exit().unwrap().unwrap();
        drop(retry);
        assert!(state.begin_window_creation().is_err());
    }
}
