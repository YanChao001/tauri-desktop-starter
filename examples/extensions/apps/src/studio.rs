use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::view::{View, artifact, button, markdown, tr, valid_text};

pub(crate) const MAX_WORKSPACE: usize = 65_536;

fn csv_cell(value: &str) -> String {
    let safe = if value.starts_with(['\t', '\r', '\n'])
        || value.trim_start().starts_with(['=', '+', '-', '@'])
    {
        format!("'{value}")
    } else {
        value.into()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Workspace {
    schema: u32,
    name: String,
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

impl Workspace {
    fn parse(source: &str) -> Result<Self, &'static str> {
        if !valid_text(source, MAX_WORKSPACE) {
            return Err("Workspace exceeds the 64 KiB input limit");
        }
        let workspace: Self =
            serde_json::from_str(source).map_err(|_| "Invalid workspace JSON structure")?;
        let columns: BTreeSet<_> = workspace.columns.iter().collect();
        if workspace.schema != 1
            || workspace.name.trim().is_empty()
            || !valid_text(&workspace.name, 80)
            || workspace.columns.is_empty()
            || workspace.columns.len() > 16
            || columns.len() != workspace.columns.len()
            || workspace
                .columns
                .iter()
                .any(|column| column.trim().is_empty() || !valid_text(column, 120))
            || workspace.rows.len() > 200
            || workspace.rows.iter().any(|row| {
                row.len() != workspace.columns.len()
                    || row.iter().any(|cell| !valid_text(cell, 8192))
            })
        {
            return Err("Check workspace schema, name, columns, row widths and limits");
        }
        Ok(workspace)
    }
}

pub(crate) fn validate_fields(fields: &Value) -> Result<(), String> {
    if let Some(source) = fields["workspace"].as_str()
        && !valid_text(source, MAX_WORKSPACE)
    {
        return Err("Workspace exceeds the 64 KiB input limit".into());
    }
    if let Some(format) = fields["workspace-format"].as_str()
        && !["json", "csv"].contains(&format)
    {
        return Err("Unknown workspace export format".into());
    }
    Ok(())
}

pub(crate) fn act(
    action: &str,
    fields: &Value,
    zh: bool,
    errors: &mut BTreeMap<String, String>,
    artifacts: &mut Vec<Value>,
) {
    if action != "workspace-export" {
        return;
    }
    let source = fields["workspace"].as_str().unwrap_or("");
    match Workspace::parse(source) {
        Ok(workspace) => {
            if fields["workspace-format"].as_str().unwrap_or("json") == "csv" {
                let csv = std::iter::once(&workspace.columns)
                    .chain(workspace.rows.iter())
                    .map(|row| {
                        row.iter()
                            .map(|cell| csv_cell(cell))
                            .collect::<Vec<_>>()
                            .join(",")
                    })
                    .collect::<Vec<_>>()
                    .join("\r\n");
                artifacts.push(artifact("workspace.csv", "text/csv", &csv));
            } else {
                // 保留文本单元格，导出的结构不参与脚本执行或数值推断。
                match serde_json::to_string(&workspace) {
                    Ok(content) => {
                        artifacts.push(artifact("workspace.json", "application/json", &content))
                    }
                    Err(_) => {
                        errors.insert(
                            "workspace".into(),
                            tr(
                                zh,
                                "工作台导出失败，输入已保留。",
                                "Workspace export failed. Input retained.",
                            ),
                        );
                    }
                }
            }
        }
        Err(_) => {
            errors.insert(
                "workspace".into(),
                tr(
                    zh,
                    "工作台数据无效：使用 schema 1、80 字节内的名称、1–16 个唯一列名和最多 200 行文本。每行列数须一致，每格最多 8 KiB；输入已保留。",
                    "Invalid workspace: use schema 1, a name within 80 bytes, 1–16 unique columns and up to 200 text rows. Row widths must match and each cell must stay within 8 KiB. Input retained.",
                ),
            );
        }
    }
}

pub(crate) fn render(fields: &Value, zh: bool) -> View {
    View {
        display: tr(zh, "交互工作台", "Interactive studio"),
        description: tr(
            zh,
            "使用画布、图表与流程模拟，导出工作成果。",
            "Work with canvases, charts and simulated pipelines, then export your results.",
        ),
        fields: vec![
            json!({"id":"workspace","label":tr(zh,"导出数据（JSON）","Export data (JSON)"),"kind":"textarea","value":fields["workspace"].as_str().unwrap_or(""),"maxBytes":MAX_WORKSPACE}),
            json!({"id":"workspace-format","label":tr(zh,"导出格式","Export format"),"kind":"select","value":fields["workspace-format"].as_str().unwrap_or("json"),"options":[{"value":"json","label":"JSON"},{"value":"csv","label":"CSV"}]}),
        ],
        groups: vec![
            json!({"columns":1,"actions":[button("workspace-export",&tr(zh,"生成导出文件","Generate export"),true)]}),
        ],
        blocks: vec![markdown(tr(
            zh,
            "此视图用于导出工作台数据。生成后点击文件保存；画布、图表与流程在自定义界面中使用。",
            "Generate and save workspace exports here. Use the custom interface for canvases, charts and pipelines.",
        ))],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload() -> Value {
        json!({"schema":1,"name":"Canvas","columns":["id","title"],"rows":[["node-1","Orbit"]]})
    }

    #[test]
    fn workspace_limits_cover_schema_text_and_table_shape() {
        assert!(Workspace::parse(&payload().to_string()).is_ok());
        for invalid in [
            json!({"schema":2,"name":"Canvas","columns":["a"],"rows":[]}),
            json!({"schema":1,"name":" ","columns":["a"],"rows":[]}),
            json!({"schema":1,"name":"界".repeat(27),"columns":["a"],"rows":[]}),
            json!({"schema":1,"name":"Canvas","columns":[],"rows":[]}),
            json!({"schema":1,"name":"Canvas","columns":["a","a"],"rows":[]}),
            json!({"schema":1,"name":"Canvas","columns":[" "],"rows":[]}),
            json!({"schema":1,"name":"Canvas","columns":["a".repeat(121)],"rows":[]}),
            json!({"schema":1,"name":"Canvas","columns":["a"],"rows":[["a","b"]]}),
            json!({"schema":1,"name":"Canvas","columns":["a"],"rows":[[9]]}),
            json!({"schema":1,"name":"Canvas","columns":["a"],"rows":[["a\0b"]]}),
            json!({"schema":1,"name":"Canvas","columns":["a"],"rows":[["a".repeat(8193)]]}),
            json!({"schema":1,"name":"Canvas","columns":["a"],"rows":vec![vec!["a"];201]}),
            json!({"schema":1,"name":"Canvas","columns":["a"],"rows":[],"extra":true}),
        ] {
            assert!(Workspace::parse(&invalid.to_string()).is_err(), "{invalid}");
        }
        let mut maximum = payload();
        maximum["name"] = json!("a".repeat(80));
        maximum["columns"] = json!((0..16).map(|i| format!("column-{i}")).collect::<Vec<_>>());
        maximum["rows"] = json!(vec![vec![""; 16]; 200]);
        assert!(Workspace::parse(&maximum.to_string()).is_ok());
        maximum["columns"][0] = json!("a".repeat(120));
        maximum["rows"] = json!([vec![""; 16]]);
        maximum["rows"][0][0] = json!("a".repeat(8192));
        assert!(Workspace::parse(&maximum.to_string()).is_ok());
        maximum["columns"] = json!((0..17).map(|i| format!("column-{i}")).collect::<Vec<_>>());
        maximum["rows"] = json!([]);
        assert!(Workspace::parse(&maximum.to_string()).is_err());
        assert!(Workspace::parse(&" ".repeat(MAX_WORKSPACE + 1)).is_err());
    }

    #[test]
    fn json_preserves_text_and_csv_escapes_every_cell_including_headers() {
        let source = json!({"schema":1,"name":"Chart","columns":["=header","value"],"rows":[["=SUM(A1)","a,\"b\"\nc"],["\tplain","  @formula"],["-1","+2"]]}).to_string();
        let mut artifacts = vec![];
        let mut errors = BTreeMap::new();
        act(
            "workspace-export",
            &json!({"workspace":source}),
            false,
            &mut errors,
            &mut artifacts,
        );
        assert!(errors.is_empty());
        assert_eq!(artifacts[0]["name"], "workspace.json");
        let output: Value =
            serde_json::from_str(artifacts[0]["content"].as_str().unwrap()).unwrap();
        assert_eq!(output["rows"][0][0], "=SUM(A1)");
        artifacts.clear();
        act(
            "workspace-export",
            &json!({"workspace":source,"workspace-format":"csv"}),
            false,
            &mut errors,
            &mut artifacts,
        );
        assert_eq!(artifacts[0]["name"], "workspace.csv");
        assert_eq!(
            artifacts[0]["content"],
            "\"'=header\",\"value\"\r\n\"'=SUM(A1)\",\"a,\"\"b\"\"\nc\"\r\n\"'\tplain\",\"'  @formula\"\r\n\"'-1\",\"'+2\""
        );
    }

    #[test]
    fn export_fields_retain_invalid_json_for_manual_repair() {
        let fields = json!({"workspace":"  { incomplete","workspace-format":"csv"});
        let mut errors = BTreeMap::new();
        let mut artifacts = vec![];
        act(
            "workspace-export",
            &fields,
            false,
            &mut errors,
            &mut artifacts,
        );
        assert!(errors.contains_key("workspace"));
        assert!(artifacts.is_empty());
        let view = render(&fields, false);
        assert_eq!(view.fields[0]["value"], fields["workspace"]);
        assert_eq!(view.fields[1]["value"], "csv");
        assert!(validate_fields(&json!({"workspace":"x".repeat(MAX_WORKSPACE+1)})).is_err());
        assert!(validate_fields(&json!({"workspace-format":"exe"})).is_err());
    }
}
