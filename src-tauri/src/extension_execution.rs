//! 有界扩展调用与效果往返；租约保持到实际工作和取消结束。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extension_host::{
        ExtensionEffect, ExtensionEffectResult, ExtensionHostStore, ExtensionHttpRequest,
        ExtensionHttpResponse,
    },
    extension_runtime,
    extension_view::{ExtensionView, ExtensionViewInput, MAX_VIEW_BYTES},
    extensions::{
        ExtensionCommand, ExtensionExecutionBudget, ExtensionFile, ExtensionFileEncoding,
        ExtensionInputFormat, ExtensionNetworkResponse, ExtensionPermission, ExtensionRequest,
        ExtensionResultFormat, ExtensionRunInput, ExtensionStore, PreparedRun, TEXT_LIMIT,
    },
    workbench::WorkbenchState,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    collections::{BTreeMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::Manager;
const FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_EFFECTS: usize = 16;
const MAX_ROUNDS: usize = 8;
// 存档本身不超过 1 MiB；另留 context 的权限与 JSON 包装开销。
const HOST_CONTEXT_RESERVE: usize = 1024 * 1024 + 4096;
const EFFECT_RECEIPT_RESERVE: usize = 512;
fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn cancelled(prepared: &PreparedRun) -> NativeResult<()> {
    if prepared.stop.load(Ordering::Acquire) {
        Err(NativeError::new(
            ErrorCode::UserCancelled,
            "Extension stopped",
        ))
    } else {
        Ok(())
    }
}
struct Deadline {
    task: tokio::task::JoinHandle<()>,
    expired: Arc<AtomicBool>,
}
impl Deadline {
    fn new(stop: Arc<AtomicBool>) -> Self {
        let expired = Arc::new(AtomicBool::new(false));
        let flag = expired.clone();
        let task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            flag.store(true, Ordering::Release);
            stop.store(true, Ordering::Release);
        });
        Self { task, expired }
    }
    fn finish<T>(&self, result: NativeResult<T>) -> NativeResult<T> {
        if self.expired.load(Ordering::Acquire) {
            Err(NativeError::new(
                ErrorCode::ExtensionTimeout,
                "Extension invocation exceeded its total time budget",
            ))
        } else {
            result
        }
    }
}
impl Drop for Deadline {
    fn drop(&mut self) {
        self.task.abort();
    }
}
fn command(prepared: &PreparedRun, id: &str) -> NativeResult<ExtensionCommand> {
    let command = prepared
        .package
        .manifest
        .commands
        .iter()
        .find(|command| command.id == id)
        .cloned()
        .ok_or_else(|| invalid("Unknown extension command"))?;
    if command
        .permissions
        .iter()
        .any(|permission| !prepared.grants.contains(permission))
    {
        return Err(invalid(
            "Grant this command's required capabilities before running it",
        ));
    }
    Ok(command)
}
fn encode(value: &impl serde::Serialize) -> NativeResult<Vec<u8>> {
    let bytes =
        serde_json::to_vec(value).map_err(|_| invalid("Cannot encode extension request"))?;
    if bytes.len() > MAX_VIEW_BYTES {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Encoded extension request exceeds 4 MiB",
        ));
    }
    Ok(bytes)
}
fn media_type(name: &str) -> &'static str {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "json" => "application/json",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "md" => "text/markdown",
        _ => "application/octet-stream",
    }
}
async fn collect_data(
    app: &tauri::AppHandle,
    input: ExtensionRunInput,
    prepared: &PreparedRun,
) -> NativeResult<ExtensionRequest> {
    bounded_text(&input.input_text, TEXT_LIMIT, "Extension input")?;
    if !input.input_text.is_empty() && !prepared.grants.contains(&ExtensionPermission::TextRead) {
        return Err(invalid("Text access was not granted"));
    }
    if input.file_ids.len() > 16
        || input.file_ids.iter().collect::<HashSet<_>>().len() != input.file_ids.len()
    {
        return Err(invalid("Select at most 16 distinct authorized files"));
    }
    if !input.file_ids.is_empty() && !prepared.grants.contains(&ExtensionPermission::FilesRead) {
        return Err(invalid("File access was not granted"));
    }
    cancelled(prepared)?;
    let handle = app.clone();
    let stop = prepared.stop.clone();
    let files = blocking::run(move || {
        let mut files = Vec::new();
        let mut total = 0_usize;
        for id in input.file_ids {
            bounded_text(&id, 160, "Resource ID")?;
            if stop.load(Ordering::Acquire) {
                return Err(NativeError::new(
                    ErrorCode::UserCancelled,
                    "Extension stopped",
                ));
            }
            let (name, bytes) = handle
                .state::<WorkbenchState>()
                .read_extension_resource(&id)?;
            total = total
                .checked_add(bytes.len())
                .ok_or_else(|| invalid("Selected files exceed 2 MiB"))?;
            if total > FILE_BYTES {
                return Err(invalid("Selected files exceed 2 MiB in total"));
            }
            if stop.load(Ordering::Acquire) {
                return Err(NativeError::new(
                    ErrorCode::UserCancelled,
                    "Extension stopped",
                ));
            }
            let mime = media_type(&name).to_owned();
            let (content, encoding) = match String::from_utf8(bytes) {
                Ok(text) if !text.contains('\0') => (text, ExtensionFileEncoding::Utf8),
                Ok(text) => (
                    STANDARD.encode(text.as_bytes()),
                    ExtensionFileEncoding::Base64,
                ),
                Err(error) => (
                    STANDARD.encode(error.into_bytes()),
                    ExtensionFileEncoding::Base64,
                ),
            };
            files.push(ExtensionFile {
                name,
                content,
                encoding,
                media_type: mime,
            });
        }
        Ok(files)
    })
    .await?;
    cancelled(prepared)?;
    let network = if let Some(url) = input.url {
        let result = app
            .state::<ExtensionHostStore>()
            .execute_effect(
                &app.state::<crate::storage::SettingsStore>(),
                &prepared.package.manifest,
                &prepared.grants,
                ExtensionEffect::Http {
                    id: "input-data".into(),
                    request: ExtensionHttpRequest {
                        url,
                        method: "GET".into(),
                        headers: BTreeMap::new(),
                        body: None,
                        credential: None,
                        network_mode: None,
                    },
                },
                prepared.stop.clone(),
            )
            .await;
        if let Some(error) = result.error {
            return Err(error);
        }
        let response: ExtensionHttpResponse =
            serde_json::from_value(result.value.ok_or_else(|| invalid("Missing HTTP result"))?)
                .map_err(|_| invalid("Invalid HTTP result"))?;
        vec![ExtensionNetworkResponse {
            url: response.url,
            status: response.status,
            body: response.body,
        }]
    } else {
        Vec::new()
    };
    cancelled(prepared)?;
    let request = ExtensionRequest {
        api_version: 2,
        input_text: input.input_text,
        files,
        network,
    };
    encode(&request)?;
    Ok(request)
}
pub async fn execute(
    app: &tauri::AppHandle,
    input: ExtensionRunInput,
    owner: String,
) -> NativeResult<String> {
    let store = app.state::<ExtensionStore>().inner().clone();
    let token = store.window_run_token(owner)?;
    let id = input.id.clone();
    let expected = input.expected_sha256.clone();
    let generation = input.expected_generation;
    let prepared =
        blocking::run(move || store.prepare_for_window(&id, &expected, generation, token)).await?;
    let deadline = Deadline::new(prepared.stop.clone());
    let result = async {
        let command = command(&prepared, &input.command_id)?;
        if command.result_format == ExtensionResultFormat::View {
            return Err(invalid("Use the view entry for this command"));
        }
        let request = collect_data(app, input, &prepared).await?;
        let payload = match command.input_format {
            ExtensionInputFormat::Text => request.input_text.into_bytes(),
            ExtensionInputFormat::Json => encode(&request)?,
        };
        let module = prepared.module.clone();
        let stop = prepared.stop.clone();
        let function = command.function.clone();
        let budget = command.execution_budget;
        let output = blocking::run(move || {
            extension_runtime::run_with_budget(&module, &function, &payload, stop, budget)
        })
        .await?;
        if command.result_format == ExtensionResultFormat::Json {
            serde_json::from_str::<serde_json::Value>(&output).map_err(|_| {
                NativeError::new(
                    ErrorCode::ExtensionRunFailed,
                    "Command output is not valid JSON",
                )
            })?;
        }
        Ok(output)
    }
    .await;
    deadline.finish(result)
}
pub async fn execute_view(
    app: &tauri::AppHandle,
    input: ExtensionViewInput,
    owner: String,
) -> NativeResult<ExtensionView> {
    input.request.validate()?;
    if input.request.host.is_some()
        || !input.request.results.is_empty()
        || input.request.action.as_deref() == Some("host-result")
    {
        return Err(invalid(
            "Host context and effect results are assigned by the native host",
        ));
    }
    let store = app.state::<ExtensionStore>().inner().clone();
    let token = store.window_run_token(owner)?;
    let id = input.id.clone();
    let expected = input.expected_sha256.clone();
    let generation = input.expected_generation;
    let prepared =
        blocking::run(move || store.prepare_for_window(&id, &expected, generation, token)).await?;
    let deadline = Deadline::new(prepared.stop.clone());
    let result = async {
        let command = command(&prepared, &input.command_id)?;
        if command.result_format != ExtensionResultFormat::View {
            return Err(invalid("Command does not declare a view"));
        }
        let data = if let Some(data) = input.data {
            Some(
                collect_data(
                    app,
                    ExtensionRunInput {
                        id: input.id,
                        command_id: input.command_id,
                        expected_sha256: input.expected_sha256,
                        expected_generation: input.expected_generation,
                        input_text: data.input_text,
                        file_ids: data.file_ids,
                        url: data.url,
                    },
                    &prepared,
                )
                .await?,
            )
        } else {
            None
        };
        let host = app.state::<ExtensionHostStore>().inner().clone();
        let mut request = serde_json::to_value(&input.request)
            .map_err(|_| invalid("Cannot encode view request"))?;
        if let Some(data) = data {
            request["data"] =
                serde_json::to_value(data).map_err(|_| invalid("Cannot encode supplied data"))?;
        }
        drive_view(
            &host,
            &app.state::<crate::storage::SettingsStore>(),
            &prepared,
            &command.function,
            command.execution_budget,
            request,
            &input.request.locale,
        )
        .await
    }
    .await;
    deadline.finish(result)
}

fn admit_effects(seen: &mut HashSet<String>, pending: &[ExtensionEffect]) -> NativeResult<()> {
    // 在第一项副作用前检查整个批次，不能在写入之后才发现后面的重复 ID。
    let mut next = seen.clone();
    if pending
        .iter()
        .any(|effect| !next.insert(effect.id().to_owned()))
        || next.len() > MAX_EFFECTS
    {
        return Err(NativeError::new(
            ErrorCode::ExtensionRunFailed,
            "Extension repeated an effect or exceeded 16 effects",
        ));
    }
    *seen = next;
    Ok(())
}

fn effect_reply(view: &ExtensionView, locale: &str) -> NativeResult<(serde_json::Value, usize)> {
    let request = serde_json::json!({
        "version": 2, "action": "host-result", "state": view.state,
        "fields": view.fields.iter().map(|field| (field.id.clone(), field.value.clone())).collect::<BTreeMap<_, _>>(),
        "locale": locale, "host": null, "results": []
    });
    let base = encode(&request)?.len();
    let budget = MAX_VIEW_BYTES
        .checked_sub(base + HOST_CONTEXT_RESERVE)
        .filter(|remaining| *remaining >= view.effects.len() * EFFECT_RECEIPT_RESERVE)
        .ok_or_else(|| {
            NativeError::new(
                ErrorCode::InputTooLong,
                "View state and fields leave insufficient room for host-effect results",
            )
        })?;
    Ok((request, budget))
}

fn bounded_receipt(mut result: ExtensionEffectResult, budget: usize) -> ExtensionEffectResult {
    if serde_json::to_vec(&result).is_ok_and(|bytes| bytes.len() <= budget) {
        return result;
    }
    // 操作已经完成。保留对应 ID 的明确回执，不能丢掉整批结果导致插件重试写入。
    let completed = result.error.is_none();
    result.value = None;
    result.error = Some(NativeError::new(
        ErrorCode::InputTooLong,
        if completed {
            "Effect completed; response omitted because the host-result budget was exceeded. Do not retry the operation automatically."
        } else {
            "Effect failed; error details exceeded the host-result budget"
        },
    ));
    result
}

async fn drive_view(
    host: &ExtensionHostStore,
    settings: &crate::storage::SettingsStore,
    prepared: &PreparedRun,
    function: &str,
    budget: ExtensionExecutionBudget,
    mut request: serde_json::Value,
    locale: &str,
) -> NativeResult<ExtensionView> {
    let mut effects = HashSet::new();
    for round in 0..MAX_ROUNDS {
        cancelled(prepared)?;
        let service = host.clone();
        let manifest = prepared.package.manifest.clone();
        let grants = prepared.grants.clone();
        request["host"] =
            serde_json::to_value(blocking::run(move || service.context(&manifest, &grants)).await?)
                .map_err(|_| invalid("Cannot encode host context"))?;
        let payload = encode(&request)?;
        let module = prepared.module.clone();
        let function = function.to_owned();
        let stop = prepared.stop.clone();
        let output = blocking::run(move || {
            extension_runtime::run_with_budget(&module, &function, &payload, stop, budget)
        })
        .await?;
        let view = ExtensionView::parse(&output)?;
        if view.effects.is_empty() {
            return Ok(view);
        }
        if round + 1 == MAX_ROUNDS {
            return Err(NativeError::new(
                ErrorCode::ExtensionRunFailed,
                "Extension exceeded 8 host-effect rounds",
            ));
        }
        admit_effects(&mut effects, &view.effects)?;
        let (mut next, budget) = effect_reply(&view, locale)?;
        let mut results = Vec::new();
        let mut used = 0;
        let count = view.effects.len();
        for (index, effect) in view.effects.into_iter().enumerate() {
            cancelled(prepared)?;
            let result = host
                .execute_effect(
                    settings,
                    &prepared.package.manifest,
                    &prepared.grants,
                    effect,
                    prepared.stop.clone(),
                )
                .await;
            cancelled(prepared)?;
            let available = budget - used - (count - index - 1) * EFFECT_RECEIPT_RESERVE - 1;
            let result = bounded_receipt(result, available);
            used += serde_json::to_vec(&result)
                .map_err(|_| invalid("Cannot encode effect result"))?
                .len()
                + 1;
            results.push(result);
        }
        next["results"] =
            serde_json::to_value(results).map_err(|_| invalid("Cannot encode effect results"))?;
        request = next;
    }
    Err(NativeError::new(
        ErrorCode::ExtensionRunFailed,
        "Extension effect budget exceeded",
    ))
}

#[cfg(test)]
#[path = "extension_execution_tests.rs"]
mod tests;
