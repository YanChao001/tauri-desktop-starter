//! 扩展开发命令只运行校验与离线 Wasm worker，不初始化桌面应用。
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tauri_desktop_starter_lib::{
    extension_runtime,
    extension_view::{ExtensionView, ExtensionViewRequest},
    extensions::{ExtensionInputFormat, ExtensionManifest, ExtensionResultFormat, TEXT_LIMIT},
};

const MODULE_LIMIT: u64 = 16 * 1024 * 1024;
const MANIFEST_LIMIT: u64 = 64 * 1024;
const FIXTURE_LIMIT: u64 = 1024 * 1024;
type ToolResult<T> = Result<T, Box<dyn std::error::Error>>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    command: String,
    input: Value,
    expect_output: Option<String>,
    expect_json: Option<Value>,
    expect_error: Option<String>,
    cancel_after_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Fixtures {
    Single(Fixture),
    Sequence(Vec<Fixture>),
}

fn read_bounded(path: &Path, maximum: u64) -> ToolResult<Vec<u8>> {
    let file = File::open(path)?;
    if !file.metadata()?.is_file() {
        return Err("Expected a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(maximum + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > maximum {
        return Err(format!("File exceeds {maximum} bytes").into());
    }
    Ok(bytes)
}

fn arguments(
    args: impl IntoIterator<Item = String>,
) -> ToolResult<(String, HashMap<String, PathBuf>)> {
    let mut args = args.into_iter();
    let command = args.next().ok_or("Expected validate or test")?;
    if !["validate", "test"].contains(&command.as_str()) {
        return Err("Expected validate or test".into());
    }
    let mut options = HashMap::new();
    while let Some(key) = args.next() {
        if !["--manifest", "--wasm", "--fixture"].contains(&key.as_str())
            || (key == "--fixture" && command != "test")
        {
            return Err(format!("Unknown option: {key}").into());
        }
        let value = args.next().ok_or("Missing option value")?;
        if value.starts_with("--") || options.insert(key, PathBuf::from(value)).is_some() {
            return Err("Missing or duplicate option".into());
        }
    }
    if !options.contains_key("--manifest")
        || !options.contains_key("--wasm")
        || (command == "test" && !options.contains_key("--fixture"))
    {
        return Err("Required: --manifest <JSON> --wasm <module> [--fixture <JSON>]".into());
    }
    Ok((command, options))
}

fn check_fixture(
    manifest: &ExtensionManifest,
    module: &[u8],
    fixture: Fixture,
) -> ToolResult<Value> {
    let command = manifest
        .commands
        .iter()
        .find(|command| command.id == fixture.command)
        .ok_or("Fixture refers to an undeclared command")?;
    if [
        fixture.expect_output.is_some(),
        fixture.expect_json.is_some(),
        fixture.expect_error.is_some(),
    ]
    .into_iter()
    .filter(|set| *set)
    .count()
        != 1
    {
        return Err("Fixture needs exactly one of expectOutput, expectJson or expectError".into());
    }
    if fixture
        .cancel_after_ms
        .is_some_and(|delay| !(1..=5000).contains(&delay))
    {
        return Err("cancelAfterMs must be between 1 and 5000".into());
    }
    let input = match command.input_format {
        ExtensionInputFormat::Text => fixture
            .input
            .as_str()
            .ok_or("Text command fixture input must be a string")?
            .as_bytes()
            .to_vec(),
        ExtensionInputFormat::Json => {
            if matches!(command.result_format, ExtensionResultFormat::View) {
                let mut envelope = fixture.input.clone();
                // data 是宿主读取资源后注入的有效载荷，不属于前端的请求 DTO。
                if let Some(fields) = envelope.as_object_mut() {
                    fields.remove("data");
                }
                let request: ExtensionViewRequest = serde_json::from_value(envelope)?;
                request.validate()?;
            }
            serde_json::to_vec(&fixture.input)?
        }
    };
    if input.len() > TEXT_LIMIT || input.contains(&0) {
        return Err("Fixture input exceeds the text budget or contains NUL".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let result = std::thread::scope(|scope| {
        let (done, completed) = mpsc::channel();
        if let Some(delay) = fixture.cancel_after_ms {
            let stop = stop.clone();
            scope.spawn(move || {
                if matches!(
                    completed.recv_timeout(Duration::from_millis(delay)),
                    Err(mpsc::RecvTimeoutError::Timeout)
                ) {
                    stop.store(true, Ordering::SeqCst);
                }
            });
        }
        let result = extension_runtime::run(module, &command.function, &input, stop);
        let _ = done.send(());
        result
    });
    if let Some(expected) = fixture.expect_error {
        let error = result
            .err()
            .ok_or("Expected runtime error but command succeeded")?;
        let serialized = serde_json::to_value(&error)?;
        if serialized["code"].as_str() != Some(expected.as_str()) {
            return Err(format!("Expected {expected}, received {}", serialized["code"]).into());
        }
        return Ok(json!({"command": command.id, "passed": true, "error": serialized}));
    }
    let output = result?;
    let output_json = match command.result_format {
        ExtensionResultFormat::Json => Some(serde_json::from_str::<Value>(&output)?),
        ExtensionResultFormat::View => {
            ExtensionView::parse(&output)?;
            Some(serde_json::from_str::<Value>(&output)?)
        }
        ExtensionResultFormat::Text | ExtensionResultFormat::Markdown => None,
    };
    if let Some(expected) = fixture.expect_output
        && expected != output
    {
        return Err(format!("Output mismatch for command {}", command.id).into());
    }
    if let Some(expected) = fixture.expect_json
        && output_json.as_ref() != Some(&expected)
    {
        return Err(format!("JSON output mismatch for command {}", command.id).into());
    }
    Ok(
        json!({ "command": command.id, "passed": true, "output": output_json.unwrap_or(Value::String(output)) }),
    )
}

fn execute() -> ToolResult<Value> {
    let (action, options) = arguments(std::env::args().skip(1))?;
    let manifest: ExtensionManifest =
        serde_json::from_slice(&read_bounded(&options["--manifest"], MANIFEST_LIMIT)?)?;
    manifest.validate()?;
    let module = read_bounded(&options["--wasm"], MODULE_LIMIT)?;
    let exports: Vec<&str> = manifest
        .commands
        .iter()
        .map(|command| command.function.as_str())
        .collect();
    // 静态编译只检查结构、导入与导出；validate 绝不实例化模块或执行 start。
    extension_runtime::validate(&module, &exports)?;
    let smoke = if action == "test" {
        let fixtures: Fixtures =
            serde_json::from_slice(&read_bounded(&options["--fixture"], FIXTURE_LIMIT)?)?;
        Some(match fixtures {
            Fixtures::Single(fixture) => check_fixture(&manifest, &module, fixture)?,
            Fixtures::Sequence(fixtures) => {
                if fixtures.is_empty() || fixtures.len() > 32 {
                    return Err("Fixture sequence requires between 1 and 32 cases".into());
                }
                // 顺序复用同一进程中的 module 和 worker pool，覆盖取消后的重建。
                let mut reports = Vec::with_capacity(fixtures.len());
                for fixture in fixtures {
                    reports.push(check_fixture(&manifest, &module, fixture)?);
                }
                Value::Array(reports)
            }
        })
    } else {
        None
    };
    Ok(json!({
        "id": manifest.id,
        "version": manifest.version,
        "commands": manifest.commands.iter().map(|command| &command.id).collect::<Vec<_>>(),
        "validated": true,
        "smoke": smoke,
    }))
}

fn main() {
    // current_exe 的固定 worker 协议必须先于参数解析处理。
    if std::env::args().nth(1).as_deref() == Some("--extension-worker") {
        if std::env::args_os().len() != 2 {
            std::process::exit(2);
        }
        std::process::exit(extension_runtime::worker_main());
    }
    let result = execute();
    extension_runtime::shutdown_workers();
    match result {
        Ok(report) => println!("{report}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> ToolResult<(String, HashMap<String, PathBuf>)> {
        arguments(values.iter().map(|value| (*value).to_string()))
    }

    #[test]
    fn arguments_require_complete_unique_command_specific_options() {
        assert!(args(&["validate", "--manifest", "m", "--wasm", "w"]).is_ok());
        assert!(args(&["test", "--manifest", "m", "--wasm", "w", "--fixture", "f"]).is_ok());
        for invalid in [
            vec!["validate", "--manifest", "m"],
            vec![
                "validate",
                "--manifest",
                "m",
                "--wasm",
                "w",
                "--fixture",
                "f",
            ],
            vec!["test", "--manifest", "m", "--wasm", "w"],
            vec!["validate", "--manifest", "m", "--wasm", "w", "--wasm", "x"],
            vec!["validate", "--manifest", "--wasm", "w"],
        ] {
            assert!(args(&invalid).is_err());
        }
    }
}
