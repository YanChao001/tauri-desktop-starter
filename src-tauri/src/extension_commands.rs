//! 扩展 IPC 组装身份、状态和服务；执行协议由能力宿主管理。
use crate::{
    blocking,
    error::{NativeResult, bounded_text},
    extension_execution,
    extension_host::{ExtensionCredentialSlot, ExtensionHostStore, ExtensionStorageInfo},
    extension_market::{ExtensionMarket, MarketSource},
    extension_view::{ExtensionArtifact, ExtensionView, ExtensionViewInput, validate_artifact},
    extensions::{
        self, ExtensionArchivePreview, ExtensionArchiveResult, ExtensionConsent,
        ExtensionFileChoice, ExtensionOrigin, ExtensionPermission, ExtensionPreview,
        ExtensionRunInput, ExtensionSnapshot, ExtensionStore, InstallCondition,
    },
    workbench,
};
use tauri::{Emitter, Manager};

const SESSION_EXPORT_BYTES: usize = 32 * 1024 * 1024;

fn validate_session_export(name: &str, content: &str) -> NativeResult<()> {
    crate::file_commands::validate_export_name(name)?;
    bounded_text(content, SESSION_EXPORT_BYTES, "Extension session")
}

#[tauri::command]
#[specta::specta]
pub async fn save_extension_session(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> NativeResult<Option<String>> {
    // 会话包含输入和结果的 JSON 转义；专用额度不扩大普通文本导出范围。
    validate_session_export(&name, &content)?;
    blocking::run(move || workbench::save_text_content(&app, &name, &content, SESSION_EXPORT_BYTES))
        .await
}

fn emit(app: &tauri::AppHandle) {
    let _ = app.emit(extensions::EXTENSIONS_EVENT, ());
}
#[tauri::command]
#[specta::specta]
pub async fn extension_snapshot(app: tauri::AppHandle) -> NativeResult<ExtensionSnapshot> {
    let store = app.state::<ExtensionStore>().inner().clone();
    blocking::run(move || {
        store.initialize_bundled()?;
        store.snapshot()
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn preview_extension_archive(
    app: tauri::AppHandle,
) -> NativeResult<ExtensionArchivePreview> {
    let store = app.state::<ExtensionStore>().inner().clone();
    blocking::run(move || store.preview_archive()).await
}
#[tauri::command]
#[specta::specta]
pub async fn archive_legacy_extensions(
    app: tauri::AppHandle,
    expected_sha256: String,
) -> NativeResult<ExtensionArchiveResult> {
    let services = app.state::<crate::extension_services::ExtensionServices>();
    let _service_gate = services.gate.write().await;
    let store = app.state::<ExtensionStore>().inner().clone();
    let result = blocking::run(move || store.archive_legacy(&expected_sha256)).await;
    if result.is_ok() {
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub async fn preview_extension(content: String) -> NativeResult<ExtensionPreview> {
    blocking::run(move || extensions::preview_package(&content)).await
}
#[tauri::command]
#[specta::specta]
pub async fn extension_demo(id: Option<String>) -> NativeResult<String> {
    extensions::bundled_package(id.as_deref().unwrap_or("starter.text-tools"))
}
#[tauri::command]
#[specta::specta]
pub async fn install_extension(
    app: tauri::AppHandle,
    content: String,
    expected_revision: i32,
    replace_existing: bool,
    expected_sha256: String,
    consent: ExtensionConsent,
) -> NativeResult<ExtensionSnapshot> {
    let services = app.state::<crate::extension_services::ExtensionServices>();
    let _service_gate = services.gate.write().await;
    let store = app.state::<ExtensionStore>().inner().clone();
    let host = app.state::<ExtensionHostStore>().inner().clone();
    let result = blocking::run(move || {
        store.install_reviewed(
            &content,
            InstallCondition {
                revision: expected_revision,
                replace: replace_existing,
                sha256: &expected_sha256,
            },
            ExtensionOrigin::Local,
            consent,
            |old, _| host.clear_credentials(&old.package.manifest),
        )
    })
    .await;
    if let Ok(snapshot) = &result {
        crate::extension_services::reconcile(&app, snapshot).await?;
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub async fn install_market_extension(
    app: tauri::AppHandle,
    content: String,
    expected_revision: i32,
    replace_existing: bool,
    expected_sha256: String,
    source: MarketSource,
    consent: ExtensionConsent,
) -> NativeResult<ExtensionSnapshot> {
    let verified = app
        .state::<ExtensionMarket>()
        .verify_install_source(&content, &expected_sha256, &source)
        .await?;
    let services = app.state::<crate::extension_services::ExtensionServices>();
    let _service_gate = services.gate.write().await;
    let store = app.state::<ExtensionStore>().inner().clone();
    let host = app.state::<ExtensionHostStore>().inner().clone();
    let result = blocking::run(move || {
        store.install_reviewed(
            &content,
            InstallCondition {
                revision: expected_revision,
                replace: replace_existing,
                sha256: &expected_sha256,
            },
            ExtensionOrigin::Market { source: verified },
            consent,
            |old, next| {
                if !old.origin.same_trusted_source(next) {
                    host.clear_credentials(&old.package.manifest)?;
                }
                Ok(())
            },
        )
    })
    .await;
    if let Ok(snapshot) = &result {
        crate::extension_services::reconcile(&app, snapshot).await?;
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub async fn set_extension_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
    granted_permissions: Vec<ExtensionPermission>,
    expected_revision: i32,
    trusted: bool,
) -> NativeResult<ExtensionSnapshot> {
    let services = app.state::<crate::extension_services::ExtensionServices>();
    let _service_gate = services.gate.write().await;
    let store = app.state::<ExtensionStore>().inner().clone();
    let result = blocking::run(move || {
        store.set_enabled(
            &id,
            enabled,
            granted_permissions,
            expected_revision,
            trusted,
        )
    })
    .await;
    if let Ok(snapshot) = &result {
        crate::extension_services::reconcile(&app, snapshot).await?;
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub async fn rollback_extension(
    app: tauri::AppHandle,
    id: String,
    expected_revision: i32,
) -> NativeResult<ExtensionSnapshot> {
    let services = app.state::<crate::extension_services::ExtensionServices>();
    let _service_gate = services.gate.write().await;
    let store = app.state::<ExtensionStore>().inner().clone();
    let host = app.state::<ExtensionHostStore>().inner().clone();
    let result = blocking::run(move || {
        store.rollback_with_cleanup(&id, expected_revision, |old| {
            host.clear_credentials(&old.package.manifest)
        })
    })
    .await;
    if let Ok(snapshot) = &result {
        crate::extension_services::reconcile(&app, snapshot).await?;
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub async fn uninstall_extension(
    app: tauri::AppHandle,
    id: String,
    expected_revision: i32,
) -> NativeResult<ExtensionSnapshot> {
    let services = app.state::<crate::extension_services::ExtensionServices>();
    let _service_gate = services.gate.write().await;
    let store = app.state::<ExtensionStore>().inner().clone();
    let host = app.state::<ExtensionHostStore>().inner().clone();
    let result = blocking::run(move || {
        store.uninstall_with_cleanup(&id, expected_revision, |old| {
            host.clear_credentials(&old.package.manifest)
        })
    })
    .await;
    if let Ok(snapshot) = &result {
        crate::extension_services::reconcile(&app, snapshot).await?;
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub async fn cancel_extension(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    expected_generation: i32,
) -> NativeResult<()> {
    bounded_text(&id, 80, "Extension ID")?;
    let store = app.state::<ExtensionStore>().inner().clone();
    let owner = window.label().to_owned();
    blocking::run(move || store.cancel_for_generation(&id, expected_generation, &owner)).await
}
#[tauri::command]
#[specta::specta]
pub async fn run_extension(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: ExtensionRunInput,
) -> NativeResult<String> {
    emit(&app);
    let result = extension_execution::execute(&app, input, window.label().into()).await;
    emit(&app);
    result
}
#[tauri::command]
#[specta::specta]
pub async fn view_extension(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: ExtensionViewInput,
) -> NativeResult<ExtensionView> {
    emit(&app);
    let result = extension_execution::execute_view(&app, input, window.label().into()).await;
    emit(&app);
    result
}
#[tauri::command]
#[specta::specta]
pub async fn validate_extension_view(content: String) -> NativeResult<ExtensionView> {
    blocking::run(move || ExtensionView::parse(&content)).await
}
#[tauri::command]
#[specta::specta]
pub async fn pick_extension_files(app: tauri::AppHandle) -> NativeResult<Vec<ExtensionFileChoice>> {
    blocking::run(move || workbench::pick_extension_resources(&app)).await
}
#[tauri::command]
#[specta::specta]
pub async fn save_extension_artifact(
    app: tauri::AppHandle,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
    artifact: ExtensionArtifact,
) -> NativeResult<Option<String>> {
    blocking::run(move || {
        app.state::<ExtensionStore>()
            .current_entry(&id, &expected_sha256, expected_generation)?;
        let bytes = validate_artifact(&artifact)?;
        workbench::save_binary_content(&app, &artifact.name, &bytes)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn extension_storage_info(
    app: tauri::AppHandle,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
) -> NativeResult<ExtensionStorageInfo> {
    blocking::run(move || {
        app.state::<ExtensionStore>()
            .current_entry(&id, &expected_sha256, expected_generation)?;
        app.state::<ExtensionHostStore>().storage_info(&id)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn clear_extension_storage(
    app: tauri::AppHandle,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
    expected_revision: i32,
) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<ExtensionStore>().with_current_entry(
            &id,
            &expected_sha256,
            expected_generation,
            |_| {
                app.state::<ExtensionHostStore>()
                    .clear_storage(&id, expected_revision)?;
                Ok(())
            },
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn extension_credential_slots(
    app: tauri::AppHandle,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
) -> NativeResult<Vec<ExtensionCredentialSlot>> {
    blocking::run(move || {
        let entry = app.state::<ExtensionStore>().current_entry(
            &id,
            &expected_sha256,
            expected_generation,
        )?;
        app.state::<ExtensionHostStore>()
            .credential_slots(&entry.package.manifest)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn set_extension_credential(
    app: tauri::AppHandle,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
    origin: String,
    alias: String,
    secret: String,
) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<ExtensionStore>().with_current_entry(
            &id,
            &expected_sha256,
            expected_generation,
            |entry| {
                app.state::<ExtensionHostStore>().set_credential(
                    &entry.package.manifest,
                    &origin,
                    &alias,
                    &secret,
                )
            },
        )
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn delete_extension_credential(
    app: tauri::AppHandle,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
    origin: String,
    alias: String,
) -> NativeResult<()> {
    blocking::run(move || {
        app.state::<ExtensionStore>().with_current_entry(
            &id,
            &expected_sha256,
            expected_generation,
            |entry| {
                app.state::<ExtensionHostStore>().delete_credential(
                    &entry.package.manifest,
                    &origin,
                    &alias,
                )
            },
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaped_maximum_session_data_fits_without_widening_text_exports() {
        let content = serde_json::json!({
            "inputText": "\u{1}".repeat(1024 * 1024),
            "result": {"format": "text", "text": "\u{1}".repeat(4 * 1024 * 1024)}
        })
        .to_string();
        assert!(content.len() > 16 * 1024 * 1024);
        assert!(validate_session_export("extension-session.json", &content).is_ok());
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("extension-session.json");
        let saved =
            workbench::save_text_content_with_picker(&content, SESSION_EXPORT_BYTES, || {
                Ok(Some(path.clone()))
            })
            .unwrap();
        assert_eq!(saved, Some(path.to_string_lossy().into_owned()));
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            content.len() as u64
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        assert!(
            workbench::save_text_content_with_picker(&content, 8 * 1024 * 1024, || {
                panic!("Oversized ordinary exports must fail before opening the save dialog")
            })
            .is_err()
        );
    }

    #[test]
    fn session_exports_keep_name_and_content_boundaries() {
        assert!(validate_session_export("../session.json", "{}").is_err());
        assert!(validate_session_export("session.exe", "{}").is_err());
        assert!(validate_session_export("session.json", "\0").is_err());
        let oversized = "x".repeat(SESSION_EXPORT_BYTES + 1);
        assert!(validate_session_export("session.json", &oversized).is_err());
        assert!(
            workbench::save_text_content_with_picker(&oversized, SESSION_EXPORT_BYTES, || {
                panic!("Oversized sessions must fail before opening the save dialog")
            })
            .is_err()
        );
    }
}
