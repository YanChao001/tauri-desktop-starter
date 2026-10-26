use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{data::DataStudio, tasks::Tasks, text::TextStudio, view::tr};

const TABS: [&str; 4] = ["text", "data", "todo", "connections"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lab {
    schema: u32,
    tab: String,
    text: TextStudio,
    data: DataStudio,
    tasks: Tasks,
}

impl Lab {
    fn new(request: &Value, zh: bool) -> Self {
        Self {
            schema: 3,
            tab: "text".into(),
            text: TextStudio::new(zh),
            data: DataStudio::new(),
            tasks: Tasks::new(request),
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema != 3 || !TABS.contains(&self.tab.as_str()) {
            return Err("Unsupported or invalid lab session. Start a new session; the original import is unchanged.".into());
        }
        self.text.validate()?;
        self.data.validate()?;
        self.tasks.validate()?;
        Ok(())
    }
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
    let mut state = if raw.is_empty() {
        Lab::new(&request, zh)
    } else {
        serde_json::from_str::<Lab>(raw).map_err(|_|tr(zh,"实验室会话格式无效或过旧，请新建会话；原导入文件未修改。","Lab session is invalid or outdated. Start a new session; the original import file is unchanged."))?
    };
    state.validate()?;
    let fields = &request["fields"];
    if !fields.is_object()
        || fields.as_object().is_some_and(|fields| {
            fields.len() > 24 || fields.values().any(|value| !value.is_string())
        })
    {
        return Err("Lab fields must be a bounded string map".into());
    }
    state.text.fields(fields)?;
    state.data.fields(fields)?;
    state.tasks.fields(fields)?;
    let action = request["action"].as_str().unwrap_or("");
    if action.starts_with("tab-") && !TABS.contains(&action.trim_start_matches("tab-")) {
        return Err("Unknown workspace tab".into());
    }
    if let Some(tab) = action.strip_prefix("tab-").filter(|tab| TABS.contains(tab)) {
        state.tab = tab.into();
    }
    if ["analyze", "sample", "clear", "export-text"].contains(&action) {
        state.tab = "text".into();
    }
    if action.starts_with("data-") {
        state.tab = "data".into();
    }
    if action == "fetch-todo" {
        state.tab = "connections".into();
    }
    if action.starts_with("todo-") {
        state.tab = "todo".into();
    }
    let mut errors = BTreeMap::<String, String>::new();
    let mut effects = Vec::<Value>::new();
    let mut artifacts = Vec::<Value>::new();
    match action {
        "host-result" => {
            for result in request["results"].as_array().into_iter().flatten() {
                state.tasks.receipt(result, zh);
                state.data.receipt(result, zh);
            }
        }
        "host-data" => {
            let text = state.data.receive(&request["data"], zh);
            if state.tab == "text" && !text.is_empty() {
                state.text.import(&text, zh);
            } else if state.tab == "data" && !text.is_empty() {
                state.data.use_received(zh);
            } else {
                state.tab = "connections".into();
            }
        }
        "text-use-received" => {
            state.text.import(state.data.received_text(), zh);
            if state.data.received_was_truncated() {
                state.text.notice = tr(
                    zh,
                    "仅载入前 64 KiB 文本；统计和导出使用已载入内容。原文件未修改。",
                    "Only the first 64 KiB were loaded. Statistics and export use the loaded content; the original file is unchanged.",
                );
            }
            state.tab = "text".into();
        }
        _ => match state.tab.as_str() {
            "text" => state.text.act(action, zh, &mut errors, &mut artifacts),
            "data" | "connections" => state.data.act(
                action,
                &request,
                zh,
                &mut errors,
                &mut effects,
                &mut artifacts,
            ),
            "todo" => state.tasks.act(
                action,
                &request,
                zh,
                &mut errors,
                &mut effects,
                &mut artifacts,
            ),
            _ => {}
        },
    }
    state.validate()?;
    let view = match state.tab.as_str() {
        "text" => state.text.render(zh),
        "data" => state.data.render(zh),
        "todo" => state.tasks.render(&request, zh),
        "connections" => state.data.render_connections(&request, zh),
        _ => unreachable!("validated workspace tab"),
    };
    let tabs=[("text","文本","Text"),("data","CSV / JSON","CSV / JSON"),("todo","待办","Tasks"),("connections","文件与网络","Files & network")].into_iter().map(|(id,cn,en)|json!({"id":format!("tab-{id}"),"label":tr(zh,cn,en),"active":state.tab==id})).collect::<Vec<_>>();
    let serialized = serde_json::to_string(&state).map_err(|error| error.to_string())?;
    if serialized.len() > 256 * 1024 {
        return Err(tr(
            zh,
            "会话编码后超过 256 KiB，请缩短文本或数据输入后重试。尚未执行宿主操作。",
            "Encoded session exceeds 256 KiB. Shorten text or dataset input and retry. No host operation has been requested.",
        ));
    }
    Ok(json!({"version":2,"state":serialized,"display":view.display,"description":view.description,"tabs":tabs,"fields":view.fields,"groups":view.groups,"blocks":view.blocks,"errors":errors,"effects":effects,"artifacts":artifacts}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(
        state: &str,
        action: Option<&str>,
        fields: Value,
        host: Value,
        results: Value,
    ) -> Value {
        serde_json::from_str(&handle(&json!({"version":2,"state":state,"action":action,"fields":fields,"locale":"en","host":host,"results":results}).to_string()).unwrap()).unwrap()
    }

    #[test]
    fn every_tab_renders_in_both_languages_without_permissions() {
        for locale in ["en", "zh-CN"] {
            let mut state = String::new();
            for tab in TABS {
                let output=handle(&json!({"version":2,"state":state,"action":format!("tab-{tab}"),"fields":{},"locale":locale}).to_string()).unwrap();
                let view: Value = serde_json::from_str(&output).unwrap();
                assert_eq!(
                    view["tabs"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|tab| tab["active"] == true)
                        .count(),
                    1
                );
                assert!(view["effects"].as_array().unwrap().is_empty());
                state = view["state"].as_str().unwrap().into();
            }
        }
    }

    #[test]
    fn write_receipt_clears_only_a_successful_task_draft() {
        let host =
            json!({"permissions":["storage"],"storage":{"revision":3,"values":{"todos":[]}}});
        let started = call(
            "",
            Some("todo-add"),
            json!({"todo":"Keep this"}),
            host.clone(),
            json!([]),
        );
        assert_eq!(started["effects"][0]["expectedRevision"], 3);
        let failed = call(
            started["state"].as_str().unwrap(),
            Some("host-result"),
            json!({}),
            host,
            json!([{"id":"add-task","value":null,"error":{"code":"CONFLICT"}}]),
        );
        assert!(failed["effects"].as_array().unwrap().is_empty());
        assert_eq!(failed["fields"][0]["value"], "Keep this");
    }

    #[test]
    fn corrupted_or_forged_session_is_rejected() {
        let view = call("", None, json!({}), Value::Null, json!([]));
        let mut state: Value = serde_json::from_str(view["state"].as_str().unwrap()).unwrap();
        state["schema"] = json!(99);
        assert!(
            handle(
                &json!({"version":2,"state":state.to_string(),"fields":{},"locale":"en"})
                    .to_string()
            )
            .is_err()
        );
    }

    #[test]
    fn workspace_starts_in_an_empty_text_tool_with_only_four_tabs() {
        let view = call("", None, json!({}), Value::Null, json!([]));
        assert_eq!(view["display"], "Text tools");
        assert_eq!(view["tabs"].as_array().unwrap().len(), 4);
        assert_eq!(view["fields"][0]["value"], "");
        assert!(view["effects"].as_array().unwrap().is_empty());
        assert!(
            handle(
                &json!({"version":2,"state":"","fields":{},"action":"tab-game","locale":"en"})
                    .to_string()
            )
            .is_err()
        );
    }

    #[test]
    fn switching_tools_preserves_each_editors_draft() {
        let data = call(
            "",
            Some("tab-data"),
            json!({"text":"Keep text"}),
            Value::Null,
            json!([]),
        );
        let text = call(
            data["state"].as_str().unwrap(),
            Some("tab-text"),
            json!({"data-source":"name,score\nAda,9","data-format":"csv"}),
            Value::Null,
            json!([]),
        );
        assert_eq!(text["fields"][0]["value"], "Keep text");
        let restored = call(
            text["state"].as_str().unwrap(),
            Some("tab-data"),
            json!({}),
            Value::Null,
            json!([]),
        );
        assert_eq!(restored["fields"][0]["value"], "name,score\nAda,9");
        assert!(restored["effects"].as_array().unwrap().is_empty());
    }

    #[test]
    fn receiving_data_in_connections_preserves_other_drafts_until_explicitly_loaded() {
        let before = call(
            "",
            Some("tab-connections"),
            json!({"text":"Keep text","data-source":"Keep dataset"}),
            Value::Null,
            json!([]),
        );
        let received: Value = serde_json::from_str(&handle(&json!({"version":2,"state":before["state"],"action":"host-data","fields":{},"locale":"en","data":{"inputText":"new content","files":[]}}).to_string()).unwrap()).unwrap();
        let state: Value = serde_json::from_str(received["state"].as_str().unwrap()).unwrap();
        assert_eq!(state["text"]["input"], "Keep text");
        assert_eq!(state["data"]["source"], "Keep dataset");
        assert_eq!(state["data"]["received"], "new content");
        let loaded = call(
            received["state"].as_str().unwrap(),
            Some("text-use-received"),
            json!({}),
            Value::Null,
            json!([]),
        );
        assert_eq!(loaded["fields"][0]["value"], "new content");
        let state: Value = serde_json::from_str(loaded["state"].as_str().unwrap()).unwrap();
        assert_eq!(state["data"]["source"], "Keep dataset");
    }

    #[test]
    fn binary_file_delivery_does_not_clear_the_dataset_draft() {
        let before = call(
            "",
            Some("tab-data"),
            json!({"data-source":"Keep dataset"}),
            Value::Null,
            json!([]),
        );
        let received: Value = serde_json::from_str(&handle(&json!({"version":2,"state":before["state"],"action":"host-data","fields":{},"locale":"en","data":{"inputText":"","files":[{"name":"image.bin","content":"AAE=","encoding":"base64","mediaType":"application/octet-stream"}]}}).to_string()).unwrap()).unwrap();
        let state: Value = serde_json::from_str(received["state"].as_str().unwrap()).unwrap();
        assert_eq!(state["data"]["source"], "Keep dataset");
        assert_eq!(state["tab"], "connections");
    }
}
