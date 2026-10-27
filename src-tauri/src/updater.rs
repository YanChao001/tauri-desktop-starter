use std::{
    fs::File,
    io::Read,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicI32, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    network::NetworkMode,
    storage::{DataPaths, SettingsStore},
};

pub const UPDATE_EVENT: &str = "app://update-progress";

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolicy {
    pub endpoint: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub operation_id: i32,
    pub configured: bool,
    pub available: bool,
    pub current_version: String,
    pub endpoint: Option<String>,
    pub checked_at: Option<f64>,
    pub version: Option<String>,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum UpdateStage {
    Checking,
    Checked,
    Downloading,
    Installing,
    Installed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub operation_id: i32,
    pub stage: UpdateStage,
    pub downloaded: f64,
    pub total: Option<f64>,
    pub status: Option<UpdateStatus>,
    pub error: Option<NativeError>,
}

#[derive(Default)]
pub struct UpdateManager {
    busy: AtomicBool,
    pending: Mutex<Option<(UpdatePolicy, Update)>>,
    operation: AtomicI32,
    latest: Mutex<Option<UpdateProgress>>,
}

struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl UpdateManager {
    pub fn snapshot(&self) -> NativeResult<Option<UpdateProgress>> {
        self.latest
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Update snapshot is unavailable"))
    }

    fn next_operation(&self) -> NativeResult<i32> {
        self.operation
            .try_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value.checked_add(1)
            })
            .map(|previous| previous + 1)
            .map_err(|_| {
                NativeError::new(ErrorCode::Internal, "Update operation counter exhausted")
            })
    }

    fn publish(&self, app: &tauri::AppHandle, mut progress: UpdateProgress) {
        if let Some(status) = progress.status.as_mut() {
            status.operation_id = progress.operation_id;
        }
        if let Ok(mut latest) = self.latest.lock() {
            *latest = Some(progress.clone());
        }
        if let Err(error) = app.emit(UPDATE_EVENT, progress) {
            log::warn!("Cannot broadcast updater state: {error}");
        }
    }

    fn event(
        &self,
        app: &tauri::AppHandle,
        operation_id: i32,
        stage: UpdateStage,
        error: Option<NativeError>,
        status: Option<UpdateStatus>,
    ) {
        let previous = if matches!(stage, UpdateStage::Checking) {
            None
        } else {
            self.snapshot()
                .ok()
                .flatten()
                .and_then(|value| value.status)
        };
        self.publish(
            app,
            UpdateProgress {
                operation_id,
                stage,
                downloaded: 0.0,
                total: None,
                status: status.or(previous),
                error,
            },
        );
    }

    fn enter(&self) -> NativeResult<BusyGuard<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                NativeError::new(
                    ErrorCode::UpdateBusy,
                    "An update operation is already running",
                )
            })?;
        let guard = BusyGuard(&self.busy);
        if self
            .snapshot()?
            .is_some_and(|progress| matches!(progress.stage, UpdateStage::Installed))
        {
            return Err(NativeError::new(
                ErrorCode::UpdateBusy,
                "The update is installed; restart before checking again",
            ));
        }
        Ok(guard)
    }

    pub async fn check(&self, app: &tauri::AppHandle) -> NativeResult<UpdateStatus> {
        let _guard = self.enter()?;
        let operation_id = self.next_operation()?;
        self.event(app, operation_id, UpdateStage::Checking, None, None);
        let result = self.check_inner(app, operation_id).await;
        match &result {
            Ok(status) => self.event(
                app,
                operation_id,
                UpdateStage::Checked,
                None,
                Some(status.clone()),
            ),
            Err(error) => self.event(
                app,
                operation_id,
                UpdateStage::Failed,
                Some(error.clone()),
                None,
            ),
        }
        result
    }

    async fn check_inner(
        &self,
        app: &tauri::AppHandle,
        operation_id: i32,
    ) -> NativeResult<UpdateStatus> {
        *self
            .pending
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Update state is unavailable"))? =
            None;
        let mut status = UpdateStatus {
            operation_id,
            configured: false,
            available: false,
            current_version: app.package_info().version.to_string(),
            endpoint: None,
            checked_at: None,
            version: None,
            body: None,
            date: None,
        };
        let paths = app.state::<DataPaths>().inner().clone();
        let Some(policy) = blocking::run(move || load_policy(&paths)).await? else {
            return Ok(status);
        };
        status.configured = true;
        status.endpoint = Some(policy.endpoint.clone());
        let endpoint = validate_policy(&policy)?;
        let network_mode = app.state::<SettingsStore>().network_mode()?;
        let updater = app
            .updater_builder()
            .pubkey(&policy.public_key)
            .endpoints(vec![endpoint])
            .and_then(|builder| {
                let builder = if network_mode == NetworkMode::Direct {
                    builder.no_proxy()
                } else {
                    builder
                };
                builder
                    .timeout(Duration::from_secs(300))
                    .configure_client(|client| client.https_only(true))
                    .build()
            })
            .map_err(|e| {
                NativeError::operation(
                    ErrorCode::UpdateCheckFailed,
                    "Cannot configure the update client",
                    e,
                )
            })?;
        // 检查有独立超时；下载仍保留构建器的 300 秒预算。
        let update = tokio::time::timeout(Duration::from_secs(20), updater.check())
            .await
            .map_err(|error| {
                NativeError::operation(
                    ErrorCode::UpdateCheckTimeout,
                    "Update check timed out",
                    error,
                )
            })?
            .map_err(check_error)?;
        status.checked_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|duration| duration.as_secs_f64() * 1000.0);
        if let Some(update) = update {
            status.available = true;
            status.version = Some(update.version.clone());
            status.body = update
                .body
                .as_ref()
                .map(|body| body.chars().take(8000).collect());
            status.date = update.date.map(|value| value.to_string());
            *self.pending.lock().map_err(|_| {
                NativeError::new(ErrorCode::Internal, "Update state is unavailable")
            })? = Some((policy, update));
        }
        Ok(status)
    }

    pub async fn install(&self, app: &tauri::AppHandle) -> NativeResult<()> {
        let _guard = self.enter()?;
        let operation_id = self.next_operation()?;
        self.event(app, operation_id, UpdateStage::Downloading, None, None);
        let result = self.install_inner(app, operation_id).await;
        match &result {
            Ok(()) => self.event(app, operation_id, UpdateStage::Installed, None, None),
            Err(error) if error.code == ErrorCode::UserCancelled => {
                self.event(app, operation_id, UpdateStage::Cancelled, None, None)
            }
            Err(error) => self.event(
                app,
                operation_id,
                UpdateStage::Failed,
                Some(error.clone()),
                None,
            ),
        }
        result
    }

    async fn install_inner(&self, app: &tauri::AppHandle, operation_id: i32) -> NativeResult<()> {
        let (policy, mut update) = self
            .pending
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Update state is unavailable"))?
            .as_ref()
            .cloned()
            .ok_or_else(|| {
                NativeError::new(
                    ErrorCode::UpdateNotConfigured,
                    "Check for an available update before installing",
                )
            })?;
        let paths = app.state::<DataPaths>().inner().clone();
        if blocking::run(move || load_policy(&paths)).await?.as_ref() != Some(&policy) {
            return Err(NativeError::new(
                ErrorCode::UpdateNotConfigured,
                "Update deployment configuration changed; check again",
            ));
        }
        // 检查结果会缓存更新句柄；下载按此刻已提交的宿主偏好重新选择传输。
        // configure_client 只限制 HTTPS，不捕获检查时的代理模式。
        update.no_proxy = app.state::<SettingsStore>().network_mode()? == NetworkMode::Direct;
        let mut downloaded = 0_f64;
        let mut last_event = Instant::now();
        let handle = app.clone();
        let bytes = update
            .download(
                move |chunk, total| {
                    downloaded += chunk as f64;
                    if last_event.elapsed() < Duration::from_millis(100)
                        && total.is_none_or(|value| downloaded < value as f64)
                    {
                        return;
                    }
                    last_event = Instant::now();
                    self.publish(
                        &handle,
                        UpdateProgress {
                            operation_id,
                            stage: UpdateStage::Downloading,
                            downloaded,
                            total: total.map(|value| value as f64),
                            status: self
                                .snapshot()
                                .ok()
                                .flatten()
                                .and_then(|value| value.status),
                            error: None,
                        },
                    );
                },
                || {},
            )
            .await
            .map_err(|e| {
                NativeError::operation(
                    ErrorCode::UpdateDownloadFailed,
                    "Cannot download or verify update",
                    e,
                )
            })?;
        let authorization = crate::lifecycle::authorize(
            app,
            crate::lifecycle::LifecycleAction::InstallUpdate,
            None,
        )
        .await?;
        self.event(app, operation_id, UpdateStage::Installing, None, None);
        let extensions = app.state::<crate::extensions::ExtensionStore>().pause();
        blocking::run(move || {
            // 停止等待不会取消阻塞安装；占用必须随真实安装任务完成后再释放。
            let _authorization = authorization;
            extensions.wait_stopped();
            let _extensions = extensions;
            update.install(bytes).map_err(|e| {
                NativeError::operation(
                    ErrorCode::UpdateInstallFailed,
                    "Cannot install verified update",
                    e,
                )
            })
        })
        .await?;
        Ok(())
    }
}

fn check_error(error: tauri_plugin_updater::Error) -> NativeError {
    use tauri_plugin_updater::Error;
    let code = match &error {
        Error::ReleaseNotFound => ErrorCode::UpdateFeedUnavailable,
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            ErrorCode::UpdatePlatformUnavailable
        }
        Error::Reqwest(reason) if reason.is_timeout() => ErrorCode::UpdateCheckTimeout,
        _ => ErrorCode::UpdateCheckFailed,
    };
    NativeError::operation(code, "Cannot check for updates", error)
}

fn validate_policy(policy: &UpdatePolicy) -> NativeResult<Url> {
    bounded_text(&policy.endpoint, 4096, "Update endpoint")?;
    bounded_text(&policy.public_key, 8192, "Update public key")?;
    if policy.public_key.trim().is_empty() {
        return Err(NativeError::new(
            ErrorCode::UpdateNotConfigured,
            "Update signing public key is not configured",
        ));
    }
    let sample = policy
        .endpoint
        .replace("{{target}}", "windows")
        .replace("{{arch}}", "x86_64")
        .replace("{{current_version}}", "0.0.0");
    let url = Url::parse(&sample).map_err(|_| {
        NativeError::new(
            ErrorCode::InvalidArgument,
            "Update endpoint must be an absolute HTTPS URL",
        )
    })?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Update endpoint requires HTTPS without credentials or fragment",
        ));
    }
    Url::parse(&policy.endpoint)
        .map_err(|_| NativeError::new(ErrorCode::InvalidArgument, "Update endpoint is invalid"))
}

pub fn load_policy(paths: &DataPaths) -> NativeResult<Option<UpdatePolicy>> {
    #[derive(Deserialize)]
    struct Deployment {
        updates: UpdatePolicy,
    }
    let branded: Deployment =
        serde_json::from_str(include_str!("../../app.config.json")).map_err(|e| {
            NativeError::operation(
                ErrorCode::UpdateNotConfigured,
                "Application update configuration is invalid",
                e,
            )
        })?;
    let policy = match File::open(paths.config.join("deployment.json")) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(16 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| {
                    NativeError::operation(
                        ErrorCode::StorageIo,
                        "Cannot read update deployment configuration",
                        error,
                    )
                })?;
            if bytes.len() > 16 * 1024 {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Deployment configuration is too large",
                ));
            }
            serde_json::from_slice::<Deployment>(&bytes)
                .map_err(|e| {
                    NativeError::operation(
                        ErrorCode::UpdateNotConfigured,
                        "Deployment configuration is invalid",
                        e,
                    )
                })?
                .updates
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => branded.updates,
        Err(error) => {
            return Err(NativeError::operation(
                ErrorCode::StorageIo,
                "Cannot read update deployment configuration",
                error,
            ));
        }
    };
    if policy.endpoint.trim().is_empty() || policy.public_key.trim().is_empty() {
        return Ok(None);
    }
    validate_policy(&policy)?;
    Ok(Some(policy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    fn policy(endpoint: &str) -> UpdatePolicy {
        UpdatePolicy {
            endpoint: endpoint.into(),
            public_key: "deployment-owned-public-key".into(),
        }
    }

    #[test]
    fn missing_release_and_platform_keep_distinct_recoverable_errors() {
        let missing = check_error(tauri_plugin_updater::Error::ReleaseNotFound);
        assert_eq!(missing.code, ErrorCode::UpdateFeedUnavailable);
        assert!(missing.retryable);
        let unsupported = check_error(tauri_plugin_updater::Error::TargetsNotFound(vec![
            "windows-aarch64".into(),
        ]));
        assert_eq!(unsupported.code, ErrorCode::UpdatePlatformUnavailable);
        assert!(unsupported.retryable);
        assert_eq!(
            check_error(tauri_plugin_updater::Error::EmptyEndpoints).code,
            ErrorCode::UpdateCheckFailed
        );
    }

    #[test]
    fn update_attempts_are_monotonic_and_busy_guards_release() {
        let manager = UpdateManager::default();
        assert_eq!(manager.next_operation().unwrap(), 1);
        let guard = manager.enter().unwrap();
        assert!(matches!(
            manager.enter(),
            Err(NativeError {
                code: ErrorCode::UpdateBusy,
                ..
            })
        ));
        drop(guard);
        assert!(manager.enter().is_ok());
        assert_eq!(manager.next_operation().unwrap(), 2);
        assert!(manager.snapshot().unwrap().is_none());
    }

    #[test]
    fn installed_update_stays_terminal_until_restart() {
        let manager = UpdateManager::default();
        *manager.latest.lock().unwrap() = Some(UpdateProgress {
            operation_id: 1,
            stage: UpdateStage::Installed,
            downloaded: 0.0,
            total: None,
            status: None,
            error: None,
        });
        assert!(matches!(
            manager.enter(),
            Err(NativeError {
                code: ErrorCode::UpdateBusy,
                ..
            })
        ));
        assert!(!manager.busy.load(Ordering::Acquire));
        assert!(matches!(
            manager.snapshot().unwrap().unwrap().stage,
            UpdateStage::Installed
        ));
    }

    #[test]
    fn update_endpoints_require_https_and_reject_embedded_credentials() {
        assert!(
            validate_policy(&policy(
                "https://example.com/{{target}}/{{arch}}/{{current_version}}"
            ))
            .is_ok()
        );
        for endpoint in [
            "http://example.com/update",
            "file:///tmp/update",
            "https://user:secret@example.com/update",
            "https://example.com/update#fragment",
            "relative/path",
        ] {
            assert!(
                validate_policy(&policy(endpoint)).is_err(),
                "accepted {endpoint}"
            );
        }
    }

    #[test]
    fn missing_key_stays_unconfigured_and_invalid_overrides_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let paths = DataPaths {
            config: temp.path().into(),
            data: temp.path().into(),
            logs: temp.path().into(),
        };
        fs::write(
            paths.config.join("deployment.json"),
            r#"{"updates":{"endpoint":"https://example.com/update","publicKey":""}}"#,
        )
        .unwrap();
        assert!(load_policy(&paths).unwrap().is_none());
        fs::write(
            paths.config.join("deployment.json"),
            r#"{"updates":{"endpoint":"http://example.com/update","publicKey":"key"}}"#,
        )
        .unwrap();
        assert!(load_policy(&paths).is_err());
        fs::write(
            paths.config.join("deployment.json"),
            vec![b' '; 16 * 1024 + 1],
        )
        .unwrap();
        assert_eq!(
            load_policy(&paths).unwrap_err().code,
            ErrorCode::InputTooLong
        );
    }
}
