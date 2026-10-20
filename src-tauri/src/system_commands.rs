//! 系统示例边界：只操作专用凭据项和内置 worker，不接受任意命令。

use crate::{
    blocking, desktop,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    storage,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub id: u32,
    pub source: String,
    pub route: Option<String>,
    pub files: Vec<String>,
}
#[derive(Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub routes: BTreeMap<String, String>,
    pub secondary_open: bool,
}
pub struct SystemState {
    path: PathBuf,
    workspace: Mutex<Workspace>,
    activations: Mutex<Vec<Activation>>,
    sequence: AtomicU32,
}
#[derive(Default)]
pub struct ActivationInbox(Mutex<Vec<(Vec<String>, String, String)>>);

pub fn drain_activations(app: &tauri::AppHandle) {
    let queued = app
        .state::<ActivationInbox>()
        .0
        .lock()
        .map(|mut values| std::mem::take(&mut *values))
        .unwrap_or_default();
    for (args, cwd, source) in queued {
        activate(app, args, &cwd, &source);
    }
}

pub fn allowed_route(route: &str) -> bool {
    matches!(
        route,
        "/" | "/components"
            | "/motion"
            | "/desktop"
            | "/database"
            | "/bridge"
            | "/diagnostics"
            | "/updates"
            | "/settings"
            | "/workbench"
            | "/tasks"
            | "/system"
            | "/network"
            | "/data-studio"
            | "/media"
            | "/catalog"
            | "/recovery"
    )
}

impl SystemState {
    pub fn open(path: PathBuf) -> Self {
        let mut workspace: Workspace = std::fs::read(&path)
            .ok()
            .and_then(|v| serde_json::from_slice(&v).ok())
            .unwrap_or_default();
        workspace.routes.retain(|label, route| {
            matches!(label.as_str(), "main" | "secondary") && allowed_route(route)
        });
        Self {
            path,
            workspace: Mutex::new(workspace),
            activations: Mutex::new(Vec::new()),
            sequence: AtomicU32::new(0),
        }
    }
    pub fn set_route(&self, label: &str, route: &str) -> NativeResult<()> {
        if !matches!(label, "main" | "secondary") || !allowed_route(route) {
            return Err(NativeError::new(
                ErrorCode::InvalidArgument,
                "Unsupported workspace route",
            ));
        }
        let mut workspace = self
            .workspace
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Workspace unavailable"))?;
        workspace.routes.insert(label.into(), route.into());
        if label == "secondary" {
            workspace.secondary_open = true;
        }
        storage::atomic_write(
            &self.path,
            &serde_json::to_vec(&*workspace)
                .map_err(|_| NativeError::new(ErrorCode::Internal, "Cannot encode workspace"))?,
        )
    }
    pub fn secondary_closed(&self) {
        if let Ok(mut workspace) = self.workspace.lock() {
            workspace.secondary_open = false;
            if let Ok(bytes) = serde_json::to_vec(&*workspace) {
                let _ = storage::atomic_write(&self.path, &bytes);
            }
        }
    }
}

pub fn activate(app: &tauri::AppHandle, args: Vec<String>, cwd: &str, source: &str) {
    let Some(state) = app.try_state::<SystemState>() else {
        if let Some(inbox) = app.try_state::<ActivationInbox>()
            && let Ok(mut queued) = inbox.0.lock()
            && queued.len() < 20
        {
            queued.push((
                args.into_iter()
                    .take(32)
                    .map(|v| v.chars().take(4096).collect())
                    .collect(),
                cwd.chars().take(4096).collect(),
                source.into(),
            ));
        }
        return;
    };
    let mut route = None;
    let mut paths = Vec::new();
    for argument in args.into_iter().take(32) {
        if argument.len() > 4096 {
            continue;
        }
        if let Ok(url) = url::Url::parse(&argument)
            && url.scheme() == "tdemo"
            && url.host_str() == Some("open")
        {
            route = url
                .query_pairs()
                .find(|(k, v)| k == "route" && allowed_route(v))
                .map(|(_, v)| v.into_owned());
            continue;
        }
        let path = PathBuf::from(&argument);
        let path = if path.is_absolute() {
            path
        } else {
            PathBuf::from(cwd).join(path)
        };
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("tdemo"))
            && path.is_file()
        {
            paths.push(path);
        }
    }
    if route.is_none() && paths.is_empty() {
        return;
    }
    if !paths.is_empty() {
        crate::workbench::handle_drop(app, "main", paths.clone());
        if route.is_none() {
            route = Some("/workbench".into());
        }
    }
    let activation = Activation {
        id: state.sequence.fetch_add(1, Ordering::Relaxed) + 1,
        source: source.into(),
        route,
        files: paths
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect(),
    };
    if let Ok(mut activations) = state.activations.lock() {
        activations.push(activation.clone());
        if activations.len() > 20 {
            activations.remove(0);
        }
    }
    let _ = app.emit_to("main", "app://activation", &activation);
    desktop::request_show_main(app);
}

#[tauri::command]
#[specta::specta]
pub fn activation_snapshot(state: tauri::State<'_, SystemState>) -> NativeResult<Vec<Activation>> {
    state
        .activations
        .lock()
        .map(|v| v.clone())
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Activation history unavailable"))
}
#[tauri::command]
#[specta::specta]
pub fn get_workspace(state: tauri::State<'_, SystemState>) -> NativeResult<Workspace> {
    state
        .workspace
        .lock()
        .map(|v| v.clone())
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Workspace unavailable"))
}
#[tauri::command]
#[specta::specta]
pub async fn save_workspace_route(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    route: String,
) -> NativeResult<()> {
    let label = window.label().to_owned();
    blocking::run(move || app.state::<SystemState>().set_route(&label, &route)).await
}
#[tauri::command]
#[specta::specta]
pub async fn open_notes_window(app: tauri::AppHandle) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<SystemState>()
            .set_route("secondary", "/database")?;
        desktop::open_secondary(&app)?;
        let _ = app.emit_to("secondary", "app://workspace-route", "/database");
        Ok(())
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn restore_workspace(app: tauri::AppHandle) -> NativeResult<()> {
    blocking::run(move || {
        let workspace = get_workspace(app.state())?;
        if workspace.secondary_open {
            desktop::open_secondary(&app)?;
        }
        for (label, route) in workspace.routes {
            let _ = app.emit_to(label, "app://workspace-route", route);
        }
        Ok(())
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub fn activate_main(app: tauri::AppHandle) -> NativeResult<()> {
    desktop::request_show_main(&app);
    Ok(())
}

fn credential(app: &tauri::AppHandle) -> NativeResult<keyring::Entry> {
    if cfg!(feature = "e2e") {
        return Err(NativeError::new(
            ErrorCode::PlatformUnavailable,
            "Credential store is disabled in isolated E2E builds",
        ));
    }
    keyring::Entry::new(&app.config().identifier, "desktop-demo-credential").map_err(|error| {
        NativeError::operation(
            ErrorCode::CredentialError,
            "Cannot access system credential store",
            error,
        )
    })
}
#[tauri::command]
#[specta::specta]
pub async fn set_demo_credential(app: tauri::AppHandle, value: String) -> NativeResult<()> {
    bounded_text(&value, 1000, "Credential")?;
    if value.is_empty() {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Credential cannot be empty",
        ));
    }
    blocking::run(move || {
        credential(&app)?.set_password(&value).map_err(|error| {
            NativeError::operation(
                ErrorCode::CredentialError,
                "Cannot store demo credential",
                error,
            )
        })
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn get_demo_credential(app: tauri::AppHandle) -> NativeResult<Option<String>> {
    blocking::run(move || match credential(&app)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(NativeError::operation(
            ErrorCode::CredentialError,
            "Cannot read demo credential",
            error,
        )),
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn delete_demo_credential(app: tauri::AppHandle) -> NativeResult<()> {
    blocking::run(move || match credential(&app)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(NativeError::operation(
            ErrorCode::CredentialError,
            "Cannot delete demo credential",
            error,
        )),
    })
    .await
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DemoWorkerOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}
#[tauri::command]
#[specta::specta]
pub async fn run_demo_sidecar(
    app: tauri::AppHandle,
    input: String,
) -> NativeResult<DemoWorkerOutput> {
    bounded_text(&input, 1000, "Worker input")?;
    let exe = std::env::current_exe()
        .map_err(|e| NativeError::operation(ErrorCode::Internal, "Cannot locate demo worker", e))?;
    let output = app
        .shell()
        .command(exe)
        .args(["--demo-worker", &input])
        .output()
        .await
        .map_err(|e| NativeError::operation(ErrorCode::Internal, "Cannot run demo worker", e))?;
    Ok(DemoWorkerOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_restores_only_known_labels_and_routes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.json");
        let state = SystemState::open(path.clone());
        state.set_route("secondary", "/database").unwrap();
        assert!(state.set_route("main", "https://external.example").is_err());
        let reopened = SystemState::open(path);
        assert_eq!(
            reopened.workspace.lock().unwrap().routes["secondary"],
            "/database"
        );
        assert!(reopened.workspace.lock().unwrap().secondary_open);
    }
}
