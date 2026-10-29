use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{studio, view::tr};

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lab {
    schema: u32,
}

pub(crate) fn handle(input: &str) -> Result<String, String> {
    if input.len() > 4 * 1024 * 1024 {
        return Err("Lab request exceeds 4 MiB".into());
    }
    let request: Value = serde_json::from_str(input).map_err(|error| error.to_string())?;
    if request["version"] != 2 {
        return Err("This lab requires view protocol 2".into());
    }
    let zh = request["locale"] == "zh-CN";
    let raw = request["state"]
        .as_str()
        .ok_or("Lab state must be a string")?;
    if raw.len() > 256 * 1024 {
        return Err("Lab session exceeds its budget".into());
    }
    let invalid_session = || {
        tr(
            zh,
            "工作台会话格式无效或版本不支持，请新建会话；原导入文件未修改。",
            "Workspace session is invalid or unsupported. Start a new session; the original import file is unchanged.",
        )
    };
    let state = if raw.is_empty() {
        Lab { schema: 4 }
    } else {
        serde_json::from_str::<Lab>(raw).map_err(|_| invalid_session())?
    };
    if state.schema != 4 {
        return Err(invalid_session());
    }
    let fields = request["fields"]
        .as_object()
        .ok_or("Lab fields must be a string map")?;
    if fields.iter().any(|(key, value)| {
        !["workspace", "workspace-format"].contains(&key.as_str()) || !value.is_string()
    }) {
        return Err("Unknown workspace field".into());
    }
    studio::validate_fields(&request["fields"])?;
    let action = match &request["action"] {
        Value::Null => "",
        Value::String(action) => action.as_str(),
        _ => return Err("Invalid workspace action".into()),
    };
    if !["", "workspace-export"].contains(&action) {
        return Err("Unknown workspace action".into());
    }
    let mut errors = BTreeMap::<String, String>::new();
    let mut artifacts = Vec::<Value>::new();
    studio::act(action, &request["fields"], zh, &mut errors, &mut artifacts);
    let view = studio::render(&request["fields"], zh);
    let serialized = serde_json::to_string(&state).map_err(|error| error.to_string())?;
    Ok(json!({"version":2,"state":serialized,"display":view.display,"description":view.description,"tabs":[],"fields":view.fields,"groups":view.groups,"blocks":view.blocks,"errors":errors,"effects":[],"artifacts":artifacts}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Value {
        json!({"version":2,"state":"","action":null,"fields":{},"locale":"en"})
    }

    #[test]
    fn studio_renders_and_restores_in_both_languages_without_host_effects() {
        for locale in ["en", "zh-CN"] {
            let mut input = request();
            input["locale"] = json!(locale);
            let output: Value = serde_json::from_str(&handle(&input.to_string()).unwrap()).unwrap();
            assert_eq!(
                output["display"],
                if locale == "en" {
                    "Interactive studio"
                } else {
                    "交互工作台"
                }
            );
            assert!(output["tabs"].as_array().unwrap().is_empty());
            assert!(output["effects"].as_array().unwrap().is_empty());
            input["state"] = output["state"].clone();
            assert!(handle(&input.to_string()).is_ok());
        }
    }

    #[test]
    fn removed_tools_cannot_be_invoked_or_submitted() {
        for action in [
            "tab-text",
            "tab-data",
            "tab-todo",
            "tab-connections",
            "analyze",
            "todo-add",
            "fetch-todo",
            "host-data",
        ] {
            let mut input = request();
            input["action"] = json!(action);
            assert!(handle(&input.to_string()).is_err(), "{action}");
        }
        for field in ["text", "data-source", "todo"] {
            let mut input = request();
            input["fields"] = json!({field:"retained input"});
            assert!(handle(&input.to_string()).is_err(), "{field}");
        }
    }

    #[test]
    fn unsupported_or_malformed_sessions_are_rejected_without_replacing_the_input() {
        for state in [
            json!({"schema":3,"tab":"todo","tasks":{"draft":"Keep this"}}),
            json!({"schema":99}),
            json!({"schema":4,"unexpected":true}),
        ] {
            let mut input = request();
            let original = state.to_string();
            input["state"] = json!(original);
            assert!(handle(&input.to_string()).is_err());
            assert_eq!(input["state"], original);
        }
    }
}
