//! 有界声明式视图。数据和控件由宿主绘制，状态语义属于插件。
use crate::error::{ErrorCode, NativeError, NativeResult, bounded_text};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionIcon {
    Puzzle,
    Calculator,
    Gamepad,
    Notebook,
    Terminal,
}

#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewInput {
    pub id: String,
    pub command_id: String,
    pub expected_sha256: String,
    pub request: ExtensionViewRequest,
    #[serde(default)]
    pub data: Option<ExtensionViewDataInput>,
}
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewDataInput {
    pub input_text: String,
    pub file_ids: Vec<String>,
    pub url: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewRequest {
    pub version: u32,
    pub action: Option<String>,
    pub state: String,
    pub fields: BTreeMap<String, String>,
    pub locale: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionView {
    pub version: u32,
    pub state: String,
    pub display: String,
    pub description: String,
    pub fields: Vec<ExtensionViewField>,
    pub groups: Vec<ExtensionViewGroup>,
    #[serde(default)]
    pub tabs: Vec<ExtensionViewTab>,
    #[serde(default)]
    pub blocks: Vec<ExtensionViewBlock>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewTab {
    pub id: String,
    pub label: String,
    pub active: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ExtensionViewBlock {
    Markdown {
        text: String,
    },
    Metrics {
        items: Vec<ExtensionViewMetric>,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewMetric {
    pub label: String,
    pub value: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewField {
    pub id: String,
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub kind: Option<ExtensionFieldKind>,
    #[serde(default)]
    pub options: Vec<ExtensionViewOption>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionFieldKind {
    Text,
    Textarea,
    Number,
    Select,
    Checkbox,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewOption {
    pub value: String,
    pub label: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewGroup {
    pub columns: u32,
    pub actions: Vec<ExtensionViewAction>,
    #[serde(default)]
    pub board: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewAction {
    pub id: String,
    pub label: String,
    pub disabled: bool,
    pub primary: bool,
    #[serde(default)]
    pub aria_label: Option<String>,
}
fn invalid() -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, "Invalid extension view data")
}
fn identifier(value: &str) -> NativeResult<()> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
    {
        return Err(invalid());
    }
    Ok(())
}
impl ExtensionViewRequest {
    pub fn validate(&self) -> NativeResult<()> {
        if self.version != 1
            || self.fields.len() > 8
            || !["zh-CN", "en"].contains(&self.locale.as_str())
        {
            return Err(invalid());
        }
        bounded_text(&self.state, 8192, "View state")?;
        if let Some(action) = &self.action {
            identifier(action)?;
        }
        for (id, value) in &self.fields {
            identifier(id)?;
            bounded_text(value, 2048, "View field")?;
        }
        Ok(())
    }
}
impl ExtensionView {
    pub fn parse(output: &str) -> NativeResult<Self> {
        let validate = || -> NativeResult<Self> {
            bounded_text(output, 64 * 1024, "View response")?;
            let view: Self = serde_json::from_str(output).map_err(|_| invalid())?;
            if view.version != 1
                || view.fields.len() > 8
                || view.groups.len() > 4
                || view.tabs.len() > 6
                || view.blocks.len() > 8
            {
                return Err(invalid());
            }
            bounded_text(&view.state, 8192, "View state")?;
            bounded_text(&view.display, 512, "View display")?;
            bounded_text(&view.description, 1000, "View description")?;
            let mut ids = HashSet::new();
            for tab in &view.tabs {
                identifier(&tab.id)?;
                bounded_text(&tab.label, 120, "Tab label")?;
                if !ids.insert(&tab.id) || tab.label.trim().is_empty() {
                    return Err(invalid());
                }
            }
            if !view.tabs.is_empty() && view.tabs.iter().filter(|tab| tab.active).count() != 1 {
                return Err(invalid());
            }
            for block in &view.blocks {
                match block {
                    ExtensionViewBlock::Markdown { text } => {
                        bounded_text(text, 8192, "View Markdown")?
                    }
                    ExtensionViewBlock::Metrics { items } => {
                        if items.is_empty() || items.len() > 8 {
                            return Err(invalid());
                        }
                        for item in items {
                            bounded_text(&item.label, 120, "Metric label")?;
                            bounded_text(&item.value, 120, "Metric value")?;
                        }
                    }
                    ExtensionViewBlock::Table { columns, rows } => {
                        if columns.is_empty() || columns.len() > 8 || rows.len() > 100 {
                            return Err(invalid());
                        }
                        for col in columns {
                            bounded_text(col, 120, "Table column")?;
                        }
                        for row in rows {
                            if row.len() != columns.len() {
                                return Err(invalid());
                            }
                            for cell in row {
                                bounded_text(cell, 512, "Table cell")?;
                            }
                        }
                    }
                }
            }
            for field in &view.fields {
                identifier(&field.id)?;
                if !ids.insert(&field.id) {
                    return Err(invalid());
                }
                bounded_text(&field.label, 120, "View field label")?;
                bounded_text(&field.value, 2048, "View field value")?;
                if field.label.trim().is_empty() {
                    return Err(invalid());
                }
                if field.options.len() > 20 {
                    return Err(invalid());
                }
                let mut options = HashSet::new();
                for option in &field.options {
                    bounded_text(&option.value, 120, "Option value")?;
                    bounded_text(&option.label, 120, "Option label")?;
                    if !options.insert(&option.value) || option.label.trim().is_empty() {
                        return Err(invalid());
                    }
                }
                if matches!(field.kind, Some(ExtensionFieldKind::Select))
                    && !options.contains(&field.value)
                {
                    return Err(invalid());
                }
                if matches!(field.kind, Some(ExtensionFieldKind::Checkbox))
                    && !["true", "false"].contains(&field.value.as_str())
                {
                    return Err(invalid());
                }
            }
            ids.clear();
            let mut count = 0;
            for group in &view.groups {
                count += group.actions.len();
                if !(1..=6).contains(&group.columns) || group.actions.is_empty() || count > 36 {
                    return Err(invalid());
                }
                for action in &group.actions {
                    identifier(&action.id)?;
                    if !ids.insert(&action.id) {
                        return Err(invalid());
                    }
                    if view.tabs.iter().any(|tab| tab.id == action.id) {
                        return Err(invalid());
                    }
                    if let Some(label) = &action.aria_label {
                        bounded_text(label, 120, "Action accessible label")?;
                        if label.trim().is_empty() {
                            return Err(invalid());
                        }
                    }
                    bounded_text(&action.label, 120, "View action label")?;
                    if action.label.trim().is_empty() {
                        return Err(invalid());
                    }
                }
            }
            Ok(view)
        };
        validate().map_err(|_| {
            NativeError::new(
                ErrorCode::ExtensionRunFailed,
                "Extension returned an invalid view",
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unbounded_or_ambiguous_controls_and_future_versions() {
        let base = serde_json::json!({"version":1,"state":"","display":"0","description":"","fields":[],"groups":[{"columns":1,"actions":[{"id":"run","label":"Run","disabled":false,"primary":true}]}]});
        assert!(ExtensionView::parse(&base.to_string()).is_ok());
        for (pointer, value) in [
            ("/version", serde_json::json!(2)),
            ("/state", serde_json::json!("x".repeat(8193))),
            ("/groups/0/columns", serde_json::json!(7)),
            ("/groups/0/actions/0/id", serde_json::json!("../run")),
            ("/groups/0/actions/0/label", serde_json::json!("")),
            (
                "/groups/0/actions",
                serde_json::json!(vec![base["groups"][0]["actions"][0].clone(); 2]),
            ),
        ] {
            let mut value_base = base.clone();
            *value_base.pointer_mut(pointer).unwrap() = value;
            assert!(
                ExtensionView::parse(&value_base.to_string()).is_err(),
                "{pointer}"
            );
        }
        let mut script = base;
        script["html"] = serde_json::json!("<script>alert(1)</script>");
        assert!(ExtensionView::parse(&script.to_string()).is_err());
    }

    fn step(
        state: &str,
        action: Option<&str>,
        fields: serde_json::Value,
        data: Option<serde_json::Value>,
    ) -> ExtensionView {
        let mut request = serde_json::json!({"version":1,"action":action,"state":state,"fields":fields,"locale":"zh-CN"});
        if let Some(data) = data {
            request["data"] = data;
        }
        let output = crate::extension_runtime::run(
            include_bytes!("../../resources/extensions/demo-apps.wasm"),
            "lab",
            &serde_json::to_vec(&request).unwrap(),
            std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        )
        .unwrap();
        ExtensionView::parse(&output).unwrap()
    }
    #[test]
    fn lab_analyzes_unicode_transforms_and_reports_host_data_in_real_wasm() {
        let view = step("", None, serde_json::json!({}), None);
        assert_eq!(view.tabs.len(), 5);
        assert_eq!(view.display, "扩展实验室");
        let view = step(&view.state, Some("tab-text"), serde_json::json!({}), None);
        assert_eq!(view.fields.len(), 3);
        let view = step(
            &view.state,
            Some("analyze"),
            serde_json::json!({"text":"Hello hello 中文","mode":"upper","compact":"false"}),
            None,
        );
        assert!(
            serde_json::to_string(&view.blocks)
                .unwrap()
                .contains("HELLO HELLO 中文")
        );
        assert!(
            serde_json::to_string(&view.blocks)
                .unwrap()
                .contains("hello")
        );
        let view = step(
            &view.state,
            Some("host-data"),
            serde_json::json!({}),
            Some(
                serde_json::json!({"inputText":"explicit text", "files":[{"name":"note.txt","content":"saved content"}], "network":[{"url":"https://jsonplaceholder.typicode.com/todos/1","status":200,"body":"{\"title\":\"真实响应\",\"completed\":false}"}]}),
            ),
        );
        assert_eq!(view.display, "文件与 HTTPS");
        let blocks = serde_json::to_string(&view.blocks).unwrap();
        assert!(blocks.contains("note.txt") && blocks.contains("真实响应"));
        // No data in a regular action: old response is retained, never fetched by the plugin.
        let next = step(
            &view.state,
            Some("tab-overview"),
            serde_json::json!({}),
            None,
        );
        assert_eq!(next.display, "扩展实验室");
    }
    #[test]
    fn lab_puzzles_have_real_undo_hints_win_detection_and_multiple_levels() {
        let mut view = step("", None, serde_json::json!({}), None);
        view = step(&view.state, Some("tab-game"), serde_json::json!({}), None);
        assert_eq!(view.groups[0].actions.len(), 25);
        assert!(view.groups[0].board);
        let initial: serde_json::Value = serde_json::from_str(&view.state).unwrap();
        view = step(&view.state, Some("cell-0"), serde_json::json!({}), None);
        let changed: serde_json::Value = serde_json::from_str(&view.state).unwrap();
        assert_ne!(initial["board"], changed["board"]);
        view = step(&view.state, Some("undo"), serde_json::json!({}), None);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&view.state).unwrap()["board"],
            initial["board"]
        );
        for level in 0..3 {
            for _ in 0..25 {
                if view.groups[0].actions.iter().all(|action| action.disabled) {
                    break;
                }
                view = step(&view.state, Some("hint"), serde_json::json!({}), None);
            }
            assert_eq!(view.display, "漂亮，全部熄灭！", "level {level}");
            view = step(&view.state, Some("next"), serde_json::json!({}), None);
            assert_eq!(view.display, "把每一盏灯熄灭");
        }
    }

    #[test]
    fn lab_hint_respects_the_full_history_and_undo_restores_its_last_move() {
        let view = step("", None, serde_json::json!({}), None);
        let mut view = step(&view.state, Some("tab-game"), serde_json::json!({}), None);
        // 成对切换同一格回到原棋盘，不会在途中解开当前关卡。
        for _ in 0..100 {
            view = step(&view.state, Some("cell-0"), serde_json::json!({}), None);
        }
        let hint_disabled = |view: &ExtensionView| {
            view.groups
                .iter()
                .flat_map(|group| &group.actions)
                .find(|action| action.id == "hint")
                .unwrap()
                .disabled
        };
        assert!(hint_disabled(&view));
        let full = view.state.clone();
        view = step(&view.state, Some("hint"), serde_json::json!({}), None);
        assert_eq!(view.state, full);

        view = step(&view.state, Some("undo"), serde_json::json!({}), None);
        assert!(!hint_disabled(&view));
        let before_hint: serde_json::Value = serde_json::from_str(&view.state).unwrap();
        view = step(&view.state, Some("hint"), serde_json::json!({}), None);
        assert!(hint_disabled(&view));
        let after_hint: serde_json::Value = serde_json::from_str(&view.state).unwrap();
        assert_ne!(before_hint["board"], after_hint["board"]);
        view = step(&view.state, Some("undo"), serde_json::json!({}), None);
        let after_undo: serde_json::Value = serde_json::from_str(&view.state).unwrap();
        assert_eq!(before_hint["board"], after_undo["board"]);
    }

    #[test]
    fn bundled_lab_renders_all_tabs_in_both_languages() {
        let mut fixtures = serde_json::Map::new();
        for locale in ["zh-CN", "en"] {
            let mut state = String::new();
            for action in [
                None,
                Some("tab-text"),
                Some("analyze"),
                Some("tab-data"),
                Some("tab-game"),
                Some("hint"),
                Some("tab-about"),
            ] {
                let request = serde_json::json!({"version":1,"action":action,"state":state,"fields":{},"locale":locale});
                let output = crate::extension_runtime::run(
                    include_bytes!("../../resources/extensions/demo-apps.wasm"),
                    "lab",
                    &serde_json::to_vec(&request).unwrap(),
                    std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                )
                .unwrap();
                let view = ExtensionView::parse(&output).unwrap();
                assert_eq!(view.tabs.iter().filter(|tab| tab.active).count(), 1);
                state = view.state.clone();
                fixtures.insert(
                    format!("{locale}:{}", action.unwrap_or("init")),
                    serde_json::to_value(view).unwrap(),
                );
            }
        }
        // Optional diagnostics consumed by the headless host preview, never by the app.
        if let Ok(path) = std::env::var("STARTER_TEST_EXTENSION_VIEWS") {
            std::fs::write(path, serde_json::to_vec_pretty(&fixtures).unwrap()).unwrap();
        }
    }
    #[test]
    fn rich_views_reject_invalid_tabs_tables_and_select_values() {
        let view = step("", None, serde_json::json!({}), None);
        let mut value = serde_json::to_value(view).unwrap();
        value["tabs"][1]["active"] = serde_json::json!(true);
        assert!(ExtensionView::parse(&value.to_string()).is_err());
        value["tabs"][1]["active"] = serde_json::json!(false);
        value["blocks"] =
            serde_json::json!([{"kind":"table","columns":["a"],"rows":[["a","extra"]]}]);
        assert!(ExtensionView::parse(&value.to_string()).is_err());
        let view = step("", Some("tab-text"), serde_json::json!({}), None);
        let mut value = serde_json::to_value(view).unwrap();
        value["fields"][1]["value"] = serde_json::json!("missing option");
        assert!(ExtensionView::parse(&value.to_string()).is_err());
    }
    #[test]
    fn view_requests_reject_future_versions_and_oversized_fields() {
        let mut request = ExtensionViewRequest {
            version: 1,
            action: None,
            state: String::new(),
            fields: BTreeMap::new(),
            locale: "en".into(),
        };
        assert!(request.validate().is_ok());
        request.version = 2;
        assert!(request.validate().is_err());
        request.version = 1;
        request.fields.insert("input".into(), "x".repeat(2049));
        assert!(request.validate().is_err());
    }

    #[test]
    fn checkbox_values_preserve_the_rendered_boolean_value() {
        let base = serde_json::json!({
            "version": 1,
            "state": "",
            "display": "Preferences",
            "description": "",
            "fields": [{"id": "enabled", "label": "Enabled", "kind": "checkbox", "value": "false"}],
            "groups": []
        });
        for value in ["true", "false", "", "TRUE", "1", "indeterminate"] {
            let mut view = base.clone();
            view["fields"][0]["value"] = serde_json::json!(value);
            assert_eq!(
                ExtensionView::parse(&view.to_string()).is_ok(),
                ["true", "false"].contains(&value),
                "{value}"
            );
        }
    }
}
