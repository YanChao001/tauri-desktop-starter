use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    data::DataStudio,
    puzzle::Puzzle,
    tasks::Tasks,
    text::TextStudio,
    view::{View, markdown, permission, tr},
};

const TABS: [&str; 6] = ["overview", "text", "data", "todo", "game", "about"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lab {
    schema: u32,
    tab: String,
    text: TextStudio,
    data: DataStudio,
    tasks: Tasks,
    puzzle: Puzzle,
}

impl Lab {
    fn new(request: &Value, zh: bool) -> Self {
        Self {
            schema: 2,
            tab: "overview".into(),
            text: TextStudio::new(zh),
            data: DataStudio::new(),
            tasks: Tasks::new(request),
            puzzle: Puzzle::default(),
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema != 2 || !TABS.contains(&self.tab.as_str()) {
            return Err("Unsupported or invalid lab session. Start a new session; the original import is unchanged.".into());
        }
        self.text.validate()?;
        self.data.validate()?;
        self.tasks.validate()?;
        self.puzzle.validate()?;
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
    if let Some(tab) = action.strip_prefix("tab-").filter(|tab| TABS.contains(tab)) {
        state.tab = tab.into();
    }
    if ["analyze", "sample", "clear", "export-text"].contains(&action) {
        state.tab = "text".into();
    }
    if action.starts_with("data-") || action == "fetch-todo" {
        state.tab = "data".into();
    }
    if action.starts_with("todo-") || action == "preference-save" {
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
            let text = state.data.import(&request["data"], zh);
            if !text.is_empty() {
                state.text.import(&text, zh);
            }
            state.tab = "data".into();
        }
        _ => match state.tab.as_str() {
            "text" => state.text.act(action, zh, &mut errors, &mut artifacts),
            "data" => state.data.act(
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
            "game" => {
                state.puzzle.act(action);
            }
            _ => {}
        },
    }
    state.validate()?;
    let view = match state.tab.as_str() {
        "text" => state.text.render(zh),
        "data" => state.data.render(zh),
        "todo" => state.tasks.render(&request, zh),
        "game" => {
            let (display, description, groups, blocks) = state.puzzle.render(zh);
            View {
                display,
                description,
                groups,
                blocks,
                ..View::default()
            }
        }
        "about" => about(zh),
        _ => overview(&request, zh),
    };
    let tabs=[("overview","总览","Overview"),("text","文本工坊","Text studio"),("data","数据连接","Data explorer"),("todo","待办与偏好","Tasks & preferences"),("game","点灯解谜","Lights out"),("about","开发协议","Developer")].into_iter().map(|(id,cn,en)|json!({"id":format!("tab-{id}"),"label":tr(zh,cn,en),"active":state.tab==id})).collect::<Vec<_>>();
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

fn overview(request: &Value, zh: bool) -> View {
    let granted = ["text:read", "files:read", "network:https", "storage"]
        .into_iter()
        .filter(|name| permission(request, name))
        .count();
    View {
        display: tr(zh, "扩展实验室", "Extension Lab"),
        description: tr(
            zh,
            "从离线小工具到有记忆的应用；每项计算和玩法都在独立 Wasm 中完成。",
            "From offline tools to apps with memory: every calculation and game rule lives in independent Wasm.",
        ),
        blocks: vec![
            json!({"kind":"metrics","items":[{"label":tr(zh,"实验室版本","Lab version"),"value":env!("CARGO_PKG_VERSION")},{"label":tr(zh,"协议","Protocols"),"value":"Manifest 3 / API 2 / View 2"},{"label":tr(zh,"已授权可选能力","Optional permissions granted"),"value":format!("{granted} / 4")},{"label":tr(zh,"可解谜题","Solvable puzzles"),"value":"6"}]}),
            markdown(tr(
                zh,
                "### 先玩起来\n\n**文本工坊** — 大小写、行去重、排序、行号和 JSON 格式化，搭配 Unicode 统计、词频图表与结果文件。\n\n**数据连接** — 粘贴 CSV / JSON，试试带逗号和多行内容的样例，查看表格和自动数值图；可发送指定文件，或手动请求真实 HTTPS 数据。\n\n**待办与偏好** — 用日期安排任务，完成或删除、导出备份，重启后仍能读取；并发写入有 revision 冲突保护。\n\n**点灯解谜** — 六个逐渐进阶的 5 × 5 关卡，配合撤销和可执行提示找回节奏。\n\n**权限由你决定** — 所有能力均可选，拒绝网络或存储不影响其他离线功能。文件选择后还需主动发送，结果文件需你点击保存。",
                "### Try it first\n\n**Text studio** — case changes, unique / sorted / numbered lines and JSON formatting, plus Unicode statistics, word charts and result files.\n\n**Data explorer** — paste CSV / JSON or load samples with quoted commas and multiline cells; preview tables and numeric charts. Send specific files or manually fetch real HTTPS data.\n\n**Tasks & preferences** — plan with due dates, complete / remove tasks and export a backup. Private storage survives restarts; revision checks protect concurrent writes.\n\n**Lights out** — six progressively varied 5 × 5 puzzles with Undo and executable hints.\n\n**Your permissions** — every capability is optional. Declining network or storage leaves other offline tools available. Files are sent only after you submit them, and result files require you to click Save.",
            )),
        ],
        ..View::default()
    }
}

fn about(zh: bool) -> View {
    View {
        display: tr(zh, "从这里开发你的扩展", "Build your extension"),
        description: tr(
            zh,
            "这一页也是插件返回的数据；宿主没有实验室专用渲染分支。",
            "This page is plugin data too; the host has no lab-specific rendering branch.",
        ),
        blocks: vec![markdown(tr(
            zh,
            "### 小模块，明确边界\n\n使用 Extism PDK，将 Rust / JavaScript / TypeScript 编译成同一种 Wasm。本实验室使用清单 3、API 2 和视图 2，界面由本地隔离 HTML 自定义。\n\n源码 `examples/extensions/apps/src/` 按文本、数据、任务、谜题与通用视图拆分。状态只保存可验证的业务输入，表格、图表和统计每次由插件重新计算；worker 会为每次调用创建新实例，不依赖进程内全局状态。\n\n- **应用入口**：侧栏、命令面板和独立窗口共用一条视图协议。\n- **宿主效果**：插件返回 effects；宿主检查授权并执行，以 `host-result` 回传结果。处理失败或冲突时保留草稿，不自动重试写入。\n- **长期数据**：待办进入带 revision 的插件私有存储；会话仅保存当前界面和草稿，不能代替业务备份。\n- **文件**：发送的输入不含路径，输出只是候选文件内容，用户选择位置后宿主保存。\n- **安全边界**：本地网页与宿主界面隔离，没有系统 shell、任意网络或凭据读取。网络来源和方法由清单声明，权限可后续调整。\n\n以本项目为起点修改清单，运行扩展打包、校验与测试工具。详细说明见扩展开发指南。",
            "### Small modules, clear boundaries\n\nCompile Rust / JavaScript / TypeScript to the same Wasm format using an Extism PDK. This lab uses manifest 3, API 2 and view 2, with its own isolated local HTML interface.\n\nSource in `examples/extensions/apps/src/` separates text, data, tasks, puzzles and common view helpers. State contains validated business inputs; tables, charts and statistics are recomputed by the plugin. Each call uses a new Wasm instance, so no process-global state is required.\n\n- **Surfaces**: sidebar, command palette and native windows share one view protocol.\n- **Host effects**: the plugin returns effects; the host checks grants and returns `host-result`. Failures and conflicts retain drafts without automatically retrying writes.\n- **Long-lived data**: tasks live in revision-checked private storage. Sessions keep the UI and drafts and do not replace business backups.\n- **Files**: input carries no paths. Output is candidate file content that the host saves after the user chooses a location.\n- **Boundaries**: local HTML stays isolated from the host, without system shell, arbitrary network or secret-reading API. The manifest declares network origins / methods; permissions can be changed later.\n\nUse this project as a starting point, edit its manifest, and run the extension pack / validate / test tools. See the extension developer guide for the complete workflow.",
        ))],
        ..View::default()
    }
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
        state["puzzle"]["board"] = json!(0);
        assert!(
            handle(
                &json!({"version":2,"state":state.to_string(),"fields":{},"locale":"en"})
                    .to_string()
            )
            .is_err()
        );
    }
}
