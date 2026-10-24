//! Extism 扩展 IPC、显式数据授权与有界 HTTPS broker。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extension_runtime,
    extension_view::{ExtensionView, ExtensionViewInput},
    extensions::{
        self, ExtensionFile, ExtensionInputFormat, ExtensionNetworkResponse, ExtensionPermission,
        ExtensionPreview, ExtensionRequest, ExtensionResultFormat, ExtensionRunInput,
        ExtensionSnapshot, ExtensionStore, PreparedRun, TEXT_LIMIT,
    },
    workbench::WorkbenchState,
};
use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{Emitter, Manager};

fn emit(app: &tauri::AppHandle) {
    let _ = app.emit(extensions::EXTENSIONS_EVENT, ());
}
fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn cancelled(prepared: &PreparedRun) -> NativeResult<()> {
    check_cancelled(&prepared.stop)
}
fn check_cancelled(stop: &AtomicBool) -> NativeResult<()> {
    if stop.load(Ordering::Relaxed) {
        Err(NativeError::new(
            ErrorCode::UserCancelled,
            "Extension stopped",
        ))
    } else {
        Ok(())
    }
}
fn permits(prepared: &PreparedRun, permission: ExtensionPermission) -> bool {
    prepared.grants.contains(&permission)
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
) -> NativeResult<ExtensionSnapshot> {
    let store = app.state::<ExtensionStore>().inner().clone();
    let result = blocking::run(move || {
        store.install(
            &content,
            expected_revision,
            replace_existing,
            &expected_sha256,
        )
    })
    .await;
    if result.is_ok() {
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
    if result.is_ok() {
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
    let store = app.state::<ExtensionStore>().inner().clone();
    let result = blocking::run(move || store.uninstall(&id, expected_revision)).await;
    if result.is_ok() {
        emit(&app);
    }
    result
}
#[tauri::command]
#[specta::specta]
pub fn cancel_extension(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> NativeResult<()> {
    bounded_text(&id, 80, "Extension ID")?;
    app.state::<ExtensionStore>().cancel(&id, window.label());
    // 请求取消后仍保留运行租约，直到 broker 和 Wasm 执行实际结束。
    Ok(())
}

fn validate_input(input: &ExtensionRunInput, prepared: &PreparedRun) -> NativeResult<()> {
    bounded_text(&input.command_id, 80, "Extension command")?;
    bounded_text(&input.input_text, TEXT_LIMIT, "Extension text")?;
    if !input.input_text.is_empty() && !permits(prepared, ExtensionPermission::TextRead) {
        return Err(invalid("Text access was not granted"));
    }
    if input.file_ids.len() > 3
        || input.file_ids.iter().collect::<HashSet<_>>().len() != input.file_ids.len()
    {
        return Err(invalid("Select at most three distinct authorized files"));
    }
    for id in &input.file_ids {
        bounded_text(id, 80, "File resource ID")?;
    }
    if !input.file_ids.is_empty() && !permits(prepared, ExtensionPermission::FilesRead) {
        return Err(invalid("File access was not granted"));
    }
    if input.url.is_some() && !permits(prepared, ExtensionPermission::NetworkHttps) {
        return Err(invalid("HTTPS access was not granted"));
    }
    Ok(())
}
fn broker_url(value: &str, allowed: &[String]) -> NativeResult<url::Url> {
    bounded_text(value, 2048, "HTTPS URL")?;
    let url = url::Url::parse(value).map_err(|_| invalid("Invalid HTTPS URL"))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.fragment().is_some()
        || !url.host_str().is_some_and(|host| {
            ["httpbin.org", "jsonplaceholder.typicode.com"].contains(&host)
                && allowed.iter().any(|item| item == host)
        })
    {
        return Err(invalid(
            "HTTPS broker only accepts declared public demo hosts, without credentials or redirects",
        ));
    }
    Ok(url)
}
async fn fetch_broker(value: &str, allowed: &[String]) -> NativeResult<ExtensionNetworkResponse> {
    use tauri_plugin_http::reqwest;
    let url = broker_url(value, allowed)?;
    let failed = || {
        NativeError::new(
            ErrorCode::ExtensionRunFailed,
            "Extension HTTPS broker failed",
        )
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| failed())?;
    let mut response = client.get(url.clone()).send().await.map_err(|_| failed())?;
    if response.status().is_redirection()
        || response
            .content_length()
            .is_some_and(|length| length > TEXT_LIMIT as u64)
    {
        return Err(failed());
    }
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failed())? {
        if bytes.len() + chunk.len() > TEXT_LIMIT {
            return Err(failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| failed())?;
    bounded_text(&body, TEXT_LIMIT, "HTTPS response")?;
    Ok(ExtensionNetworkResponse {
        url: url.into(),
        status,
        body,
    })
}
async fn collect_data(
    app: &tauri::AppHandle,
    input: ExtensionRunInput,
    prepared: &PreparedRun,
) -> NativeResult<ExtensionRequest> {
    validate_input(&input, prepared)?;
    cancelled(prepared)?;
    let handle = app.clone();
    let ids = input.file_ids;
    let stop = prepared.stop.clone();
    let files = blocking::run(move || {
        let mut files = Vec::new();
        let mut total = 0;
        for id in ids {
            check_cancelled(&stop)?;
            let document = handle.state::<WorkbenchState>().load(&id)?;
            check_cancelled(&stop)?;
            let content = document
                .content
                .ok_or_else(|| invalid("Only authorized text files can be sent to extensions"))?;
            bounded_text(&content, TEXT_LIMIT, "Extension file content")?;
            total += content.len();
            if total > TEXT_LIMIT {
                return Err(invalid("Selected file content exceeds 64 KiB in total"));
            }
            files.push(ExtensionFile {
                name: document.name,
                content,
            });
        }
        Ok(files)
    })
    .await?;
    cancelled(prepared)?;
    let network = match input.url {
        Some(url) => vec![fetch_broker(&url, &prepared.package.manifest.allowed_hosts).await?],
        None => vec![],
    };
    cancelled(prepared)?;
    Ok(ExtensionRequest {
        api_version: 1,
        input_text: input.input_text,
        files,
        network,
    })
}
async fn execute(
    app: &tauri::AppHandle,
    input: ExtensionRunInput,
    owner: String,
) -> NativeResult<String> {
    bounded_text(&input.id, 80, "Extension ID")?;
    bounded_text(&input.expected_sha256, 64, "Expected module hash")?;
    let store = app.state::<ExtensionStore>().inner().clone();
    let token = store.window_run_token(owner)?;
    let id = input.id.clone();
    let expected = input.expected_sha256.clone();
    let prepared = blocking::run(move || store.prepare_for_window(&id, &expected, token)).await?;
    emit(app);
    if prepared.package.manifest.result_format == ExtensionResultFormat::View {
        return Err(invalid(
            "Use the extension view entry point for applications",
        ));
    }
    let function = prepared
        .package
        .manifest
        .commands
        .iter()
        .find(|command| command.id == input.command_id)
        .ok_or_else(|| invalid("Unknown extension command"))?
        .function
        .clone();
    let request = collect_data(app, input, &prepared).await?;
    blocking::run(move || {
        let payload = match prepared.package.manifest.input_format {
            ExtensionInputFormat::Text => request.input_text.as_bytes().to_vec(),
            ExtensionInputFormat::Json => serde_json::to_vec(&request)
                .map_err(|_| invalid("Cannot encode extension input"))?,
        };
        let result =
            extension_runtime::run(&prepared.module, &function, &payload, prepared.stop.clone())
                .and_then(|output| {
                    if prepared.package.manifest.result_format == ExtensionResultFormat::Json {
                        serde_json::from_str::<serde_json::Value>(&output).map_err(|_| {
                            NativeError::new(
                                ErrorCode::ExtensionRunFailed,
                                "Extension returned invalid JSON",
                            )
                        })?;
                    }
                    Ok(output)
                });
        drop(prepared);
        result
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn run_extension(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: ExtensionRunInput,
) -> NativeResult<String> {
    let result = execute(&app, input, window.label().into()).await;
    emit(&app);
    result
}

async fn execute_view(
    app: &tauri::AppHandle,
    input: ExtensionViewInput,
    owner: String,
) -> NativeResult<ExtensionView> {
    bounded_text(&input.id, 80, "Extension ID")?;
    bounded_text(&input.command_id, 80, "Extension command")?;
    bounded_text(&input.expected_sha256, 64, "Expected module hash")?;
    input.request.validate()?;
    let store = app.state::<ExtensionStore>().inner().clone();
    let token = store.window_run_token(owner)?;
    let id = input.id.clone();
    let expected = input.expected_sha256.clone();
    let prepared = blocking::run(move || store.prepare_for_window(&id, &expected, token)).await?;
    emit(app);
    if prepared.package.manifest.result_format != ExtensionResultFormat::View {
        return Err(invalid("Extension does not declare an application view"));
    }
    let function = prepared
        .package
        .manifest
        .commands
        .iter()
        .find(|command| command.id == input.command_id)
        .ok_or_else(|| invalid("Unknown extension command"))?
        .function
        .clone();
    let mut request =
        serde_json::to_value(input.request).map_err(|_| invalid("Cannot encode view request"))?;
    if let Some(data) = input.data {
        let data = collect_data(
            app,
            ExtensionRunInput {
                id: input.id,
                command_id: input.command_id,
                expected_sha256: input.expected_sha256,
                input_text: data.input_text,
                file_ids: data.file_ids,
                url: data.url,
            },
            &prepared,
        )
        .await?;
        request["data"] =
            serde_json::to_value(data).map_err(|_| invalid("Cannot encode view data"))?;
    }
    blocking::run(move || {
        cancelled(&prepared)?;
        let payload =
            serde_json::to_vec(&request).map_err(|_| invalid("Cannot encode view request"))?;
        let output =
            extension_runtime::run(&prepared.module, &function, &payload, prepared.stop.clone())?;
        ExtensionView::parse(&output)
    })
    .await
}
#[tauri::command]
#[specta::specta]
pub async fn view_extension(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: ExtensionViewInput,
) -> NativeResult<ExtensionView> {
    let result = execute_view(&app, input, window.label().into()).await;
    emit(&app);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn broker_refuses_other_hosts_credentials_ports_and_fragments() {
        let hosts = vec!["httpbin.org".to_string()];
        assert!(broker_url("https://httpbin.org/get", &hosts).is_ok());
        for url in [
            "http://httpbin.org/get",
            "https://httpbin.org.evil.test/",
            "https://user:secret@httpbin.org/",
            "https://httpbin.org:8443/",
            "https://httpbin.org/#fragment",
            "https://127.0.0.1/",
            "https://jsonplaceholder.typicode.com/todos/1",
        ] {
            assert!(broker_url(url, &hosts).is_err(), "{url}");
        }
    }
}
