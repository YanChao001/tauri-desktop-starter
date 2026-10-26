use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::view::{View, artifact, button, markdown, permission, tr, truncate, valid_text};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Tasks {
    input: String,
    due: String,
    status: String,
    clear_confirm: bool,
    pending: Option<String>,
    view_revision: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Task {
    text: String,
    due: String,
    completed: bool,
}

impl Tasks {
    pub fn new(_request: &Value) -> Self {
        Self::default()
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.view_revision.is_some_and(|revision| revision < 0)
            || !valid_text(&self.input, 1000)
            || !valid_text(&self.status, 1000)
            || !valid_date(&self.due)
            || self
                .pending
                .as_deref()
                .is_some_and(|id| !["add-task", "save-todos"].contains(&id))
        {
            return Err("Invalid tasks session".into());
        }
        Ok(())
    }

    pub fn fields(&mut self, fields: &Value) -> Result<(), String> {
        for (id, limit, target) in [("todo", 1000, &mut self.input), ("due", 10, &mut self.due)] {
            if let Some(value) = fields[id].as_str() {
                if !valid_text(value, limit) {
                    return Err("Task field exceeds its limit".into());
                }
                *target = value.into();
            }
        }
        if !valid_date(&self.due) {
            return Err("Task due date must be a real YYYY-MM-DD date".into());
        }
        Ok(())
    }

    pub fn receipt(&mut self, result: &Value, zh: bool) {
        let id = result["id"].as_str().unwrap_or("");
        if self.pending.as_deref() != Some(id) {
            return;
        }
        self.pending = None;
        if !result["error"].is_null() {
            self.status = match result["error"]["code"].as_str().unwrap_or("") {
                "CONFLICT" => tr(
                    zh,
                    "另一个窗口已修改数据，本次没有覆盖。列表已刷新，草稿保留；检查后可手动重试。",
                    "Another window changed the data; this write did not overwrite it. The list refreshed and your draft is retained. Review it before retrying.",
                ),
                "INPUT_TOO_LONG" => tr(
                    zh,
                    "未取得完整回执，操作可能已完成。请先检查当前列表，勿直接重复提交。草稿已保留。",
                    "No complete receipt was returned and the operation may have completed. Check the current list before submitting again. Your draft is retained.",
                ),
                _ => tr(
                    zh,
                    "保存失败，草稿已保留；检查权限与存储状态后手动重试。",
                    "Save failed and your draft is retained. Check permissions and storage, then retry manually.",
                ),
            };
        } else {
            self.status = tr(
                zh,
                "已保存到此扩展的私有存储",
                "Saved to this extension's private storage",
            );
            if id == "add-task" {
                self.input.clear();
                self.due.clear();
            }
            self.clear_confirm = false;
        }
    }

    pub fn act(
        &mut self,
        action: &str,
        request: &Value,
        zh: bool,
        errors: &mut BTreeMap<String, String>,
        effects: &mut Vec<Value>,
        artifacts: &mut Vec<Value>,
    ) {
        if action == "todo-clear-cancel" {
            self.clear_confirm = false;
            return;
        }
        if !action.starts_with("todo-") {
            return;
        }
        if !permission(request, "storage") {
            self.status = tr(
                zh,
                "请允许扩展私有存储后重试；其他离线页签仍可使用。",
                "Allow private extension storage and retry. Other offline tabs remain available.",
            );
            return;
        }
        let todos = match snapshot(request) {
            Ok(items) => items,
            Err(_) => {
                self.status = tr(
                    zh,
                    "私有待办格式无效，已保留原数据且停止写入。请先导出或在扩展详情中检查存储。",
                    "Stored tasks have an invalid format. The original data is preserved and writes are stopped. Inspect storage in extension details first.",
                );
                return;
            }
        };
        if action == "todo-export" {
            artifacts.push(artifact(
                "tasks.json",
                "application/json",
                &serde_json::to_string_pretty(&todos).unwrap_or_default(),
            ));
            return;
        }
        if action == "todo-clear" {
            self.clear_confirm = true;
            return;
        }
        let Some(revision) = request["host"]["storage"]["revision"]
            .as_i64()
            .filter(|revision| (0..=i32::MAX as i64).contains(revision))
        else {
            self.status = tr(
                zh,
                "私有存储快照不可用，请重新打开页面后重试。",
                "Private storage snapshot is unavailable. Reopen the page and retry.",
            );
            return;
        };
        if (action.starts_with("todo-toggle-")
            || action.starts_with("todo-remove-")
            || action == "todo-clear-confirm")
            && self.view_revision != Some(revision as i32)
        {
            self.clear_confirm = false;
            self.status = tr(
                zh,
                "列表在另一个窗口发生变化，本次未执行。请检查刷新后的任务再选择操作。",
                "Another window changed the list. Nothing was changed by this action. Review the refreshed tasks before choosing an operation.",
            );
            return;
        }
        let mut updated = todos;
        let (id, changes) = match action {
            "todo-add" => {
                if self.input.trim().is_empty() {
                    errors.insert("todo".into(), tr(zh, "请输入待办内容", "Enter a task"));
                    return;
                }
                if updated.len() >= 50 {
                    errors.insert(
                        "todo".into(),
                        tr(
                            zh,
                            "最多保存 50 项待办；请先移除已完成任务。",
                            "Up to 50 tasks can be saved. Remove completed tasks first.",
                        ),
                    );
                    return;
                }
                updated.push(Task {
                    text: self.input.trim().into(),
                    due: self.due.clone(),
                    completed: false,
                });
                ("add-task", json!({"todos":updated}))
            }
            "todo-clear-confirm" if self.clear_confirm => ("save-todos", json!({"todos":[]})),
            "todo-clear-completed" => {
                updated.retain(|task| !task.completed);
                ("save-todos", json!({"todos":updated}))
            }
            _ => {
                let (toggle, index) = if let Some(index) = action.strip_prefix("todo-toggle-") {
                    (true, index)
                } else if let Some(index) = action.strip_prefix("todo-remove-") {
                    (false, index)
                } else {
                    return;
                };
                let Some(index) = index
                    .parse::<usize>()
                    .ok()
                    .filter(|index| *index < updated.len())
                else {
                    return;
                };
                if toggle {
                    updated[index].completed = !updated[index].completed;
                } else {
                    updated.remove(index);
                }
                ("save-todos", json!({"todos":updated}))
            }
        };
        self.pending = Some(id.into());
        self.status.clear();
        effects
            .push(json!({"kind":"storage","id":id,"expectedRevision":revision,"changes":changes}));
    }

    pub fn render(&mut self, request: &Value, zh: bool) -> View {
        self.view_revision = request["host"]["storage"]["revision"]
            .as_i64()
            .filter(|revision| (0..=i32::MAX as i64).contains(revision))
            .map(|revision| revision as i32);
        let mut view = View {
            display: tr(zh, "轻量待办", "Tasks"),
            description: tr(
                zh,
                "记下要做的事，可选截止日期。允许存储后可跨会话保存。",
                "Keep a short list with optional due dates. Grant storage to retain it across sessions.",
            ),
            ..View::default()
        };
        view.fields = vec![
            json!({"id":"todo","label":tr(zh,"待办内容","Task"),"value":self.input,"kind":"text","maxBytes":1000}),
            json!({"id":"due","label":tr(zh,"截止日期（可选）","Due date (optional)"),"value":self.due,"kind":"date","maxBytes":10}),
        ];
        view.groups = vec![
            json!({"columns":1,"actions":[button("todo-add",&tr(zh,"添加并保存","Add & save"),true)]}),
        ];
        if snapshot(request).is_ok_and(|tasks| !tasks.is_empty()) {
            view.groups.push(json!({"columns":3,"actions":[button("todo-export",&tr(zh,"导出备份","Export backup"),false),button("todo-clear-completed",&tr(zh,"移除已完成","Remove completed"),false),button("todo-clear",&tr(zh,"清空待办…","Clear tasks…"),false)]}));
        }
        if self.clear_confirm {
            view.blocks.push(markdown(tr(zh,"**确认清空全部待办？** 此操作会保存空列表，无法通过会话撤销；可先生成待办备份。","**Clear every task?** This saves an empty list and cannot be undone through the session. Generate a tasks backup first if needed.")));
            view.groups.push(json!({"columns":2,"actions":[button("todo-clear-confirm",&tr(zh,"确认清空","Confirm clear"),false),button("todo-clear-cancel",&tr(zh,"保留待办","Keep tasks"),true)]}));
        }
        if !self.status.is_empty() {
            view.blocks.push(markdown(&self.status));
        }
        match snapshot(request) {
            Ok(todos)=> {
                if !todos.is_empty() {
                    view.blocks.push(json!({"kind":"table","columns":[tr(zh,"任务","Task"),tr(zh,"截止日期","Due"),tr(zh,"状态","Status")],"rows":todos.iter().map(|task|vec![task.text.clone(),task.due.clone(),tr(zh,if task.completed {"已完成"} else {"待办"},if task.completed {"Done"} else {"Pending"})]).collect::<Vec<_>>()}));
                    let mut actions=Vec::new();
                    for (index,task) in todos.iter().enumerate() {
                        let title=truncate(&task.text,60);
                        actions.push(button(&format!("todo-toggle-{index}"),&format!("{}: {title}",tr(zh,if task.completed {"恢复"} else {"完成"},if task.completed {"Reopen"} else {"Complete"})),false));
                        actions.push(button(&format!("todo-remove-{index}"),&format!("{}: {title}",tr(zh,"删除","Remove")),false));
                    }
                    view.groups.push(json!({"columns":2,"actions":actions}));
                }
                if !todos.is_empty() {
                    view.blocks.push(json!({"kind":"progress","label":tr(zh,"完成进度","Tasks completed"),"value":todos.iter().filter(|task|task.completed).count(),"max":todos.len()}));
                } else if permission(request,"storage") {
                    view.blocks.push(markdown(tr(zh,"暂无待办。添加一项开始。","No tasks yet. Add one to begin.")));
                }
            }
            Err(_)=>view.blocks.push(markdown(tr(zh,"私有待办格式无效，原数据已保留。请到扩展详情检查存储，写入已停止。","Stored tasks have an invalid format. The original data is preserved. Inspect storage in extension details; writes are stopped."))),
        }
        if !permission(request, "storage") {
            view.blocks.push(markdown(tr(zh,"保存待办需要私有存储权限，可在扩展权限中单独允许。未授权时草稿仍留在当前会话。","Saving tasks needs private storage permission. Grant it in extension permissions; ungranted drafts remain in this session.")));
        }
        if !permission(request, "storage") || snapshot(request).is_err() {
            for group in &mut view.groups {
                for action in group["actions"].as_array_mut().into_iter().flatten() {
                    if action["id"] != "todo-clear-cancel" {
                        action["disabled"] = json!(true);
                    }
                }
            }
        }
        view
    }
}

fn snapshot(request: &Value) -> Result<Vec<Task>, String> {
    let value = &request["host"]["storage"]["values"]["todos"];
    if value.is_null() {
        return Ok(vec![]);
    }
    let tasks: Vec<Task> =
        serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    if tasks.len() > 50
        || tasks.iter().any(|task| {
            task.text.trim().is_empty() || !valid_text(&task.text, 1000) || !valid_date(&task.due)
        })
    {
        return Err("Invalid stored tasks".into());
    }
    Ok(tasks)
}

fn valid_date(value: &str) -> bool {
    if value.is_empty() {
        return true;
    }
    if value.len() != 10
        || value.as_bytes()[4] != b'-'
        || value.as_bytes()[7] != b'-'
        || !value
            .bytes()
            .enumerate()
            .all(|(index, ch)| index == 4 || index == 7 || ch.is_ascii_digit())
    {
        return false;
    }
    let year = value[..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..].parse::<u32>().unwrap_or(0);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let max = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    year > 0 && day > 0 && day <= max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_validate_leap_years_and_real_months() {
        for date in ["", "2024-02-29", "2026-10-25"] {
            assert!(valid_date(date), "{date}");
        }
        for date in [
            "2026-02-29",
            "2026-04-31",
            "0000-01-01",
            "2026-13-01",
            "2026-1-01",
        ] {
            assert!(!valid_date(date), "{date}");
        }
    }

    #[test]
    fn malformed_stored_tasks_never_get_silently_overwritten() {
        let request = json!({"host":{"permissions":["storage"],"storage":{"revision":4,"values":{"todos":[{"text":"old","due":"invalid","completed":false}]}}}});
        let mut state = Tasks::new(&request);
        state.input = "new".into();
        let mut effects = vec![];
        state.act(
            "todo-add",
            &request,
            false,
            &mut BTreeMap::new(),
            &mut effects,
            &mut vec![],
        );
        assert!(effects.is_empty());
        assert_eq!(state.input, "new");
    }

    #[test]
    fn conflicts_preserve_draft_and_never_reissue_effects() {
        let mut state = Tasks {
            input: "keep me".into(),
            pending: Some("add-task".into()),
            ..Tasks::default()
        };
        state.receipt(
            &json!({"id":"add-task","value":null,"error":{"code":"CONFLICT"}}),
            false,
        );
        assert_eq!(state.input, "keep me");
        assert!(state.pending.is_none());
        assert!(state.status.contains("did not overwrite"));
    }

    #[test]
    fn stale_row_buttons_do_not_modify_a_different_task() {
        let original = json!({"host":{"permissions":["storage"],"storage":{"revision":4,"values":{"todos":[{"text":"first","due":"","completed":false}]}}}});
        let changed = json!({"host":{"permissions":["storage"],"storage":{"revision":5,"values":{"todos":[{"text":"different","due":"","completed":false}]}}}});
        let mut state = Tasks::new(&original);
        state.render(&original, false);
        let mut effects = vec![];
        state.act(
            "todo-toggle-0",
            &changed,
            false,
            &mut BTreeMap::new(),
            &mut effects,
            &mut vec![],
        );
        assert!(effects.is_empty());
        assert!(state.status.contains("Nothing was changed"));
    }
}
