//! 系统示例边界：只操作专用凭据项和内置 worker，不接受任意命令。

use crate::{
    app_config::INTEGRATION,
    blocking, desktop,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    storage,
    workbench::WorkbenchState,
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::BTreeMap,
    io::Read,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

const MAX_WORKSPACE_BYTES: usize = 16 * 1024;
const MAX_ACTIVATIONS: usize = 20;
const MAX_ACTIVATION_FILES: usize = 20;

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub id: u32,
    pub source: String,
    pub route: Option<String>,
    pub files: Vec<String>,
    pub resource_ids: Vec<String>,
    pub errors: Vec<String>,
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
    pending_activations: AtomicU32,
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
        let mut workspace: Workspace = std::fs::File::open(&path)
            .and_then(|file| {
                let mut bytes = Vec::new();
                file.take(MAX_WORKSPACE_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)?;
                Ok(bytes)
            })
            .ok()
            .filter(|bytes| bytes.len() <= MAX_WORKSPACE_BYTES)
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
            pending_activations: AtomicU32::new(0),
        }
    }

    fn next_activation_id(&self) -> Option<u32> {
        self.sequence
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value.checked_add(1)
            })
            .ok()
            .map(|value| value + 1)
    }

    fn record_activation(&self, activation: Activation) -> NativeResult<()> {
        let mut activations = self
            .activations
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Activation history unavailable"))?;
        let index = activations.partition_point(|value| value.id < activation.id);
        activations.insert(index, activation);
        if activations.len() > MAX_ACTIVATIONS {
            activations.remove(0);
        }
        Ok(())
    }

    fn reserve_activation(&self) -> bool {
        self.pending_activations
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                (value < MAX_ACTIVATIONS as u32).then_some(value + 1)
            })
            .is_ok()
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
        let mut next = workspace.clone();
        next.routes.insert(label.into(), route.into());
        if label == "secondary" {
            next.secondary_open = true;
        }
        storage::atomic_write(
            &self.path,
            &serde_json::to_vec(&next)
                .map_err(|_| NativeError::new(ErrorCode::Internal, "Cannot encode workspace"))?,
        )?;
        *workspace = next;
        Ok(())
    }
    pub fn secondary_closed(&self) {
        if let Ok(mut workspace) = self.workspace.lock() {
            let mut next = workspace.clone();
            next.secondary_open = false;
            if let Ok(bytes) = serde_json::to_vec(&next) {
                match storage::atomic_write(&self.path, &bytes) {
                    Ok(()) => *workspace = next,
                    Err(error) => log::warn!("Cannot persist the closed workspace window: {error}"),
                }
            }
        }
    }
}

struct ActivationPermit<'a>(&'a AtomicU32);
impl Drop for ActivationPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) fn deep_link_route(argument: &str) -> Option<String> {
    let url = url::Url::parse(argument).ok()?;
    if url.scheme() != INTEGRATION.deep_link_scheme
        || url.host_str() != Some("open")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(url.path(), "" | "/")
        || url.fragment().is_some()
    {
        return None;
    }
    url.query_pairs()
        .find(|(key, value)| key == "route" && allowed_route(value))
        .map(|(_, value)| value.into_owned())
}

struct ActivationInput {
    route: Option<String>,
    paths: Vec<PathBuf>,
}

fn activation_input(args: Vec<String>, cwd: &str) -> Option<ActivationInput> {
    let mut route = None;
    let mut paths = Vec::new();
    for argument in args.into_iter().take(32) {
        if argument.len() > 4096 {
            continue;
        }
        if let Some(target) = deep_link_route(&argument) {
            route = Some(target);
            continue;
        }
        // Finder 的文件关联通过 deep-link 插件传入 file URL；按 URL 规则解码，
        // 不把百分号编码或远端 authority 直接拼成文件路径。
        let path = if let Ok(url) = url::Url::parse(&argument)
            && url.scheme() == "file"
        {
            if !url.username().is_empty()
                || url.password().is_some()
                || url.port().is_some()
                || url.host_str().is_some_and(|host| host != "localhost")
                || url.query().is_some()
                || url.fragment().is_some()
            {
                continue;
            }
            let Ok(path) = url.to_file_path() else {
                continue;
            };
            path
        } else {
            PathBuf::from(&argument)
        };
        // 无效深链与其他 URL 不是相对文件路径；Windows 的盘符绝对路径仍可关联打开。
        if !path.is_absolute() && (argument.contains("://") || url::Url::parse(&argument).is_ok()) {
            continue;
        }
        let path = if path.is_absolute() {
            path
        } else {
            if !std::path::Path::new(cwd).is_absolute() {
                continue;
            }
            PathBuf::from(cwd).join(path)
        };
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case(&INTEGRATION.file_extension))
        {
            paths.push(path);
        }
    }
    if route.is_none() && paths.is_empty() {
        return None;
    }
    if !paths.is_empty() && route.is_none() {
        route = Some("/workbench".into());
    }
    Some(ActivationInput { route, paths })
}

fn ready_activation(
    input: ActivationInput,
    id: u32,
    source: String,
    workbench: Option<&WorkbenchState>,
) -> Activation {
    let mut activation = Activation {
        id,
        source,
        route: input.route,
        files: input
            .paths
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect(),
        resource_ids: Vec::new(),
        errors: Vec::new(),
    };
    if let Some(workbench) = workbench {
        for path in input.paths.iter().take(MAX_ACTIVATION_FILES) {
            match workbench.document(path) {
                Ok(document) => activation.resource_ids.push(document.id),
                Err(error) => activation.errors.push(format!(
                    "{}: {}",
                    path.file_name().unwrap_or_default().to_string_lossy(),
                    error.message,
                )),
            }
        }
        if input.paths.len() > MAX_ACTIVATION_FILES {
            activation
                .errors
                .push("Only the first 20 associated files were opened".into());
        }
    } else if !input.paths.is_empty() {
        activation
            .errors
            .push("Too many file-open requests are pending; try opening the files again".into());
    }
    if !activation.errors.is_empty() {
        activation.route = Some("/workbench".into());
    }
    activation
}

fn publish_activation(app: &tauri::AppHandle, activation: Activation) {
    if let Err(error) = app
        .state::<SystemState>()
        .record_activation(activation.clone())
    {
        log::warn!("Cannot retain activation result: {error}");
    }
    let _ = app.emit_to("main", "app://activation", activation);
}

pub fn activate(app: &tauri::AppHandle, args: Vec<String>, cwd: &str, source: &str) {
    let Some(state) = app.try_state::<SystemState>() else {
        if let Some(inbox) = app.try_state::<ActivationInbox>()
            && let Ok(mut queued) = inbox.0.lock()
            && queued.len() < MAX_ACTIVATIONS
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
    let Some(input) = activation_input(args, cwd) else {
        return;
    };
    let Some(id) = state.next_activation_id() else {
        log::warn!("Activation sequence is exhausted");
        return;
    };
    if input.paths.is_empty() || !state.reserve_activation() {
        publish_activation(app, ready_activation(input, id, source.into(), None));
    } else {
        let handle = app.clone();
        let source = source.to_owned();
        tauri::async_runtime::spawn_blocking(move || {
            let state = handle.state::<SystemState>();
            let _permit = ActivationPermit(&state.pending_activations);
            let activation =
                ready_activation(input, id, source, Some(&handle.state::<WorkbenchState>()));
            publish_activation(&handle, activation);
        });
    }
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
    fn completed_file_activations_remain_loadable_from_the_startup_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory
            .path()
            .join(format!("selected.{}", INTEGRATION.file_extension));
        let contents = r#"{"privateDocument":"retained only in the selected file"}"#;
        std::fs::write(&file, contents).unwrap();
        let workbench = WorkbenchState::open(directory.path().join("workbench")).unwrap();
        let state = SystemState::open(directory.path().join("workspace.json"));
        let input = activation_input(vec![file.to_string_lossy().into_owned()], "").unwrap();
        let id = state.next_activation_id().unwrap();
        let result = ready_activation(input, id, "startup".into(), Some(&workbench));
        assert!(result.errors.is_empty());
        assert_eq!(result.resource_ids.len(), 1);
        assert_eq!(result.route.as_deref(), Some("/workbench"));
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("privateDocument"));
        assert!(!serialized.contains(directory.path().to_string_lossy().as_ref()));
        state.record_activation(result).unwrap();

        let snapshot = state.activations.lock().unwrap().clone();
        assert_eq!(snapshot.len(), 1);
        let reopened = workbench.load(&snapshot[0].resource_ids[0]).unwrap();
        assert_eq!(reopened.content.as_deref(), Some(contents));
    }

    #[test]
    fn failed_file_activations_keep_visible_errors_without_advertising_invalid_resources() {
        let directory = tempfile::tempdir().unwrap();
        let invalid = directory
            .path()
            .join(format!("invalid.{}", INTEGRATION.file_extension));
        let missing = directory
            .path()
            .join(format!("missing.{}", INTEGRATION.file_extension));
        std::fs::write(&invalid, [0xff, 0xfe]).unwrap();
        let workbench = WorkbenchState::open(directory.path().join("workbench")).unwrap();
        let input = activation_input(
            vec![
                format!("{}://open?route=/settings", INTEGRATION.deep_link_scheme),
                invalid.to_string_lossy().into_owned(),
                missing.to_string_lossy().into_owned(),
            ],
            "",
        )
        .unwrap();
        let result = ready_activation(input, 1, "startup".into(), Some(&workbench));
        assert_eq!(result.route.as_deref(), Some("/workbench"));
        assert!(result.resource_ids.is_empty());
        assert_eq!(result.errors.len(), 2);
        assert!(
            result
                .errors
                .iter()
                .all(|error| !error.contains(directory.path().to_string_lossy().as_ref()))
        );
    }

    #[test]
    fn activation_history_orders_by_receipt_and_keeps_only_twenty_ready_results() {
        let directory = tempfile::tempdir().unwrap();
        let state = SystemState::open(directory.path().join("workspace.json"));
        let ids = (0..22)
            .map(|_| state.next_activation_id().unwrap())
            .collect::<Vec<_>>();
        assert!(state.activations.lock().unwrap().is_empty());
        for id in ids.into_iter().rev() {
            state
                .record_activation(ready_activation(
                    ActivationInput {
                        route: Some("/settings".into()),
                        paths: Vec::new(),
                    },
                    id,
                    "deep-link".into(),
                    None,
                ))
                .unwrap();
        }
        let snapshot = state.activations.lock().unwrap();
        assert_eq!(snapshot.len(), MAX_ACTIVATIONS);
        assert_eq!(
            snapshot.iter().map(|value| value.id).collect::<Vec<_>>(),
            (3..=22).collect::<Vec<_>>()
        );
    }

    #[test]
    fn activation_admission_is_bounded_and_releases_its_slot() {
        let directory = tempfile::tempdir().unwrap();
        let state = SystemState::open(directory.path().join("workspace.json"));
        for _ in 0..MAX_ACTIVATIONS {
            assert!(state.reserve_activation());
        }
        assert!(!state.reserve_activation());
        drop(ActivationPermit(&state.pending_activations));
        assert!(state.reserve_activation());
        let input = activation_input(
            vec![format!("pending.{}", INTEGRATION.file_extension)],
            directory.path().to_str().unwrap(),
        )
        .unwrap();
        let result = ready_activation(input, 1, "startup".into(), None);
        assert_eq!(result.route.as_deref(), Some("/workbench"));
        assert_eq!(result.errors.len(), 1);
        assert!(result.resource_ids.is_empty());
    }

    #[test]
    fn activation_paths_resolve_against_the_sender_and_never_treat_urls_as_files() {
        let directory = tempfile::tempdir().unwrap();
        let filename = format!("relative.{}", INTEGRATION.file_extension);
        let cwd = directory.path().to_str().unwrap();
        let input = activation_input(vec![filename.clone()], cwd).unwrap();
        assert_eq!(input.paths, vec![directory.path().join(&filename)]);
        assert!(activation_input(vec![filename.clone()], "").is_none());
        assert!(
            activation_input(vec![format!("https://example.invalid/{filename}")], cwd).is_none()
        );
        assert!(
            activation_input(
                vec![format!("{}://[.{filename}", INTEGRATION.deep_link_scheme)],
                cwd
            )
            .is_none()
        );
        let input = activation_input(vec![filename; 40], cwd).unwrap();
        assert_eq!(input.paths.len(), 32);
    }

    #[test]
    fn native_file_urls_decode_local_names_and_reject_remote_or_ambiguous_targets() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory
            .path()
            .join(format!("关联 文档.{}", INTEGRATION.file_extension));
        let url = url::Url::from_file_path(&file).unwrap();
        let input = activation_input(vec![url.to_string()], "").unwrap();
        assert_eq!(input.paths, vec![file]);
        for argument in [
            format!("{url}?download=1"),
            format!("{url}#fragment"),
            format!(
                "file://remote-server/share/document.{}",
                INTEGRATION.file_extension
            ),
            "file:///tmp/unrelated.txt".into(),
        ] {
            assert!(
                activation_input(vec![argument.clone()], "").is_none(),
                "accepted {argument}"
            );
        }
    }

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

    #[test]
    fn failed_workspace_save_preserves_the_committed_snapshot_and_can_retry() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.json");
        let state = SystemState::open(path.clone());
        state.set_route("main", "/settings").unwrap();
        let committed = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        assert!(state.set_route("secondary", "/database").is_err());
        {
            let workspace = state.workspace.lock().unwrap();
            assert_eq!(workspace.routes.len(), 1);
            assert_eq!(workspace.routes["main"], "/settings");
            assert!(!workspace.secondary_open);
        }

        std::fs::remove_dir(&path).unwrap();
        std::fs::write(&path, committed).unwrap();
        state.set_route("secondary", "/database").unwrap();
        let reopened = SystemState::open(path.clone());
        assert!(reopened.workspace.lock().unwrap().secondary_open);
        assert_eq!(
            reopened.workspace.lock().unwrap().routes["secondary"],
            "/database"
        );
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        reopened.secondary_closed();
        assert!(reopened.workspace.lock().unwrap().secondary_open);
        std::fs::remove_dir(&path).unwrap();
        reopened.secondary_closed();
        assert!(!reopened.workspace.lock().unwrap().secondary_open);
        assert!(
            !SystemState::open(path)
                .workspace
                .lock()
                .unwrap()
                .secondary_open
        );
    }

    #[test]
    fn oversized_workspace_falls_back_without_replacing_the_original() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.json");
        let contents = serde_json::to_vec(&serde_json::json!({
            "routes": {"main": "/settings"},
            "secondaryOpen": true,
            "padding": "x".repeat(MAX_WORKSPACE_BYTES),
        }))
        .unwrap();
        std::fs::write(&path, &contents).unwrap();
        let state = SystemState::open(path.clone());
        let workspace = state.workspace.lock().unwrap();
        assert!(workspace.routes.is_empty());
        assert!(!workspace.secondary_open);
        assert_eq!(std::fs::read(path).unwrap(), contents);
    }

    #[test]
    fn branded_deep_links_only_accept_the_local_open_endpoint_and_known_routes() {
        let scheme = &INTEGRATION.deep_link_scheme;
        assert_eq!(
            deep_link_route(&format!("{scheme}://open?route=%2Fsettings")),
            Some("/settings".into()),
        );
        for value in [
            format!("{scheme}://open?route=https%3A%2F%2Fexample.com"),
            format!("{scheme}://open?route=/unknown"),
            format!("{scheme}://other?route=/settings"),
            format!("{scheme}://user:secret@open?route=/settings"),
            format!("{scheme}://open:1234?route=/settings"),
            format!("{scheme}://open/another?route=/settings"),
            format!("{scheme}://open?route=/settings#fragment"),
            "https://open?route=/settings".into(),
            "relative-document.json".into(),
        ] {
            assert!(deep_link_route(&value).is_none(), "accepted {value}");
        }
    }
}
