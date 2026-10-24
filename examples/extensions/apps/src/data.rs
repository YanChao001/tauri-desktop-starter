use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::view::{View, artifact, button, markdown, permission, tr, truncate, valid_text};

const MAX_SOURCE: usize = 65_536;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DataStudio {
    source: String,
    format: String,
    analyzed: bool,
    files: Vec<Vec<String>>,
    network: Vec<Vec<String>>,
    status: String,
}

struct Dataset {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
}

impl DataStudio {
    pub fn new() -> Self {
        Self {
            format: "auto".into(),
            ..Self::default()
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !valid_text(&self.source, MAX_SOURCE)
            || !["auto", "json", "csv"].contains(&self.format.as_str())
            || !valid_text(&self.status, 1000)
            || self.files.len() > 16
            || self.network.len() > 12
            || self
                .files
                .iter()
                .any(|row| row.len() != 4 || row.iter().any(|cell| !valid_text(cell, 480)))
            || self
                .network
                .iter()
                .any(|row| row.len() != 2 || row.iter().any(|cell| !valid_text(cell, 480)))
        {
            return Err("Invalid data studio session".into());
        }
        Ok(())
    }

    pub fn fields(&mut self, fields: &Value) -> Result<(), String> {
        if let Some(source) = fields["data-source"].as_str() {
            if !valid_text(source, MAX_SOURCE) {
                return Err("Dataset exceeds the 64 KiB input limit".into());
            }
            self.source = source.into();
        }
        if let Some(format) = fields["data-format"].as_str() {
            if !["auto", "json", "csv"].contains(&format) {
                return Err("Unknown dataset format".into());
            }
            self.format = format.into();
        }
        Ok(())
    }

    pub fn import(&mut self, data: &Value, zh: bool) -> String {
        let mut text = data["inputText"].as_str().unwrap_or("").to_owned();
        self.files.clear();
        let mut first_text_file = None;
        for file in data["files"].as_array().into_iter().flatten().take(16) {
            let content = file["content"].as_str().unwrap_or("");
            let utf8 = file["encoding"] == "utf8";
            let size = if utf8 {
                content.len()
            } else {
                (content.len() / 4 * 3)
                    .saturating_sub(content.bytes().rev().take_while(|ch| *ch == b'=').count())
            };
            self.files.push(vec![
                truncate(file["name"].as_str().unwrap_or(""), 180),
                truncate(
                    file["mediaType"]
                        .as_str()
                        .unwrap_or("application/octet-stream"),
                    120,
                ),
                size.to_string(),
                if utf8 {
                    content.lines().count().to_string()
                } else {
                    "—".into()
                },
            ]);
            if utf8 {
                first_text_file.get_or_insert(content);
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(content);
            }
        }
        let source = if !data["inputText"].as_str().unwrap_or("").trim().is_empty() {
            data["inputText"].as_str().unwrap_or("")
        } else {
            first_text_file.unwrap_or("")
        };
        self.source = truncate(source, MAX_SOURCE);
        self.analyzed = false;
        self.status = if source.len() > MAX_SOURCE {
            tr(
                zh,
                "数据输入仅载入前 64 KiB；文件元数据仍显示完整文件大小。",
                "Only the first 64 KiB were loaded into the dataset editor; file metadata still shows the full size.",
            )
        } else {
            tr(
                zh,
                "已接收你发送的数据；可预览首个文本文件或继续查看文本工坊。",
                "Received the data you sent. Preview the first text file here or inspect all text in Text studio.",
            )
        };
        text
    }

    pub fn receipt(&mut self, result: &Value, zh: bool) {
        if result["id"] != "fetch-todo" {
            return;
        }
        if !result["error"].is_null() {
            let code = result["error"]["code"].as_str().unwrap_or("UNKNOWN");
            self.status = format!(
                "{} ({})",
                tr(
                    zh,
                    "请求未取得可用响应；请检查授权与连接后手动重试",
                    "No usable response. Check permissions and connection, then retry manually"
                ),
                truncate(code, 80)
            );
            self.network.clear();
            return;
        }
        let value = &result["value"];
        let status = value["status"].as_u64().unwrap_or(0);
        self.status = format!(
            "HTTP {status} · {}",
            truncate(value["url"].as_str().unwrap_or(""), 700)
        );
        let body = value["body"].as_str().unwrap_or("");
        self.network = match serde_json::from_str::<Value>(body) {
            Ok(Value::Object(object)) => object
                .into_iter()
                .take(12)
                .map(|(key, value)| vec![truncate(&key, 120), truncate(&value.to_string(), 480)])
                .collect(),
            _ => vec![vec!["body".into(), truncate(body, 480)]],
        };
        if (200..300).contains(&status) && body.len() <= MAX_SOURCE {
            self.source = body.into();
            self.format = "json".into();
            self.analyzed = false;
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
        match action {
            "fetch-todo" => {
                if permission(request, "network:https") {
                    self.status = tr(zh, "请求已提交", "Request submitted");
                    effects.push(json!({"kind":"http","id":"fetch-todo","request":{"url":"https://jsonplaceholder.typicode.com/todos/1","method":"GET","headers":{},"body":null,"credential":null}}));
                } else {
                    self.status = tr(
                        zh,
                        "请在扩展权限中允许 HTTPS 后重试；本地 CSV / JSON 不需要网络授权。",
                        "Allow HTTPS in extension permissions and retry. Local CSV / JSON needs no network grant.",
                    );
                }
            }
            "data-sample-csv" => {
                self.source = "项目,得分,备注\n星舰,84,\"可离线游玩, 支持撤销\"\n灯塔,96,\"你好\n第二行\"\n纸飞机,72,轻装出发".into();
                self.format = "csv".into();
                self.analyzed = true;
                self.status.clear();
            }
            "data-sample-json" => {
                self.source = "[{\"project\":\"Orbit\",\"score\":84},{\"project\":\"Beacon\",\"score\":96},{\"project\":\"Paper plane\",\"score\":72}]".into();
                self.format = "json".into();
                self.analyzed = true;
                self.status.clear();
            }
            "data-preview" | "data-export-json" | "data-export-csv" => {
                self.analyzed = true;
                match self.dataset(zh) {
                    Ok(dataset) => {
                        if action == "data-export-json" {
                            artifacts.push(artifact(
                                "dataset.json",
                                "application/json",
                                &json!({"columns":dataset.columns,"rows":dataset.rows}).to_string(),
                            ));
                        } else if action == "data-export-csv" {
                            let csv = std::iter::once(&dataset.columns)
                                .chain(dataset.rows.iter())
                                .map(|row| {
                                    row.iter()
                                        .map(|cell| csv_cell(cell))
                                        .collect::<Vec<_>>()
                                        .join(",")
                                })
                                .collect::<Vec<_>>()
                                .join("\r\n");
                            artifacts.push(artifact("dataset.csv", "text/csv", &csv));
                        }
                    }
                    Err(message) => {
                        errors.insert("data-source".into(), message);
                    }
                }
            }
            _ => {}
        }
    }

    fn dataset(&self, zh: bool) -> Result<Dataset, String> {
        let result = if self.format == "json"
            || (self.format == "auto" && self.source.trim_start().starts_with(['{', '[']))
        {
            json_dataset(&self.source)
        } else {
            csv_dataset(&self.source)
        };
        result.map_err(|message| {
            format!(
                "{}: {message}",
                tr(
                    zh,
                    "数据无法预览（最多 16 列、200 行，每格 8 KiB）",
                    "Cannot preview data (up to 16 columns, 200 rows, 8 KiB per cell)"
                )
            )
        })
    }

    pub fn render(&self, zh: bool) -> View {
        let mut view = View {
            display: tr(zh, "文件与 HTTPS", "Files & HTTPS"),
            description: tr(
                zh,
                "本地 CSV / JSON 预览、数值图表和可保存的转换结果。网络只在点击请求时发起。",
                "Local CSV / JSON previews, numeric charts and savable results. Network requests start only when you click Fetch.",
            ),
            ..View::default()
        };
        view.fields = vec![
            json!({"id":"data-source","label":tr(zh,"数据内容（或发送所选文本文件）","Dataset (or send a selected text file)"),"kind":"textarea","value":self.source,"maxBytes":MAX_SOURCE}),
            json!({"id":"data-format","label":tr(zh,"解析格式","Parse as"),"kind":"select","value":self.format,"options":[{"value":"auto","label":tr(zh,"自动识别 JSON / CSV","Detect JSON / CSV")},{"value":"json","label":"JSON"},{"value":"csv","label":"CSV"}]}),
        ];
        view.groups = vec![
            json!({"columns":3,"actions":[button("data-preview",&tr(zh,"预览与绘图","Preview & chart"),true),button("data-sample-csv",&tr(zh,"CSV 样例","CSV sample"),false),button("data-sample-json",&tr(zh,"JSON 样例","JSON sample"),false)]}),
            json!({"columns":3,"actions":[button("data-export-json",&tr(zh,"生成 JSON 表格","Generate JSON table"),false),button("data-export-csv",&tr(zh,"生成 CSV","Generate CSV"),false),button("fetch-todo",&tr(zh,"请求真实 HTTPS 数据","Fetch live HTTPS data"),false)]}),
        ];
        if !self.status.is_empty() {
            view.blocks.push(markdown(&self.status));
        }
        if self.analyzed {
            match self.dataset(zh) {
                Ok(dataset) => {
                    view.blocks.push(json!({"kind":"metrics","items":[{"label":tr(zh,"数据行","Rows"),"value":dataset.rows.len().to_string()},{"label":tr(zh,"列","Columns"),"value":dataset.columns.len().to_string()}]}));
                    for index in 0..dataset.columns.len() {
                        let values: Option<Vec<f64>> = dataset
                            .rows
                            .iter()
                            .take(30)
                            .map(|row| {
                                row[index]
                                    .parse::<f64>()
                                    .ok()
                                    .filter(|value| value.is_finite())
                            })
                            .collect();
                        if let Some(values) = values.filter(|values| !values.is_empty()) {
                            let labels: Vec<_> = dataset
                                .rows
                                .iter()
                                .take(30)
                                .enumerate()
                                .map(|(row, values)| {
                                    if index != 0 {
                                        truncate(&values[0], 120)
                                    } else {
                                        (row + 1).to_string()
                                    }
                                })
                                .collect();
                            view.blocks.push(json!({"kind":"chart","chartType":"bar","label":format!("{} · {}",dataset.columns[index],tr(zh,"前 30 行","first 30 rows")),"labels":labels,"series":[{"label":dataset.columns[index],"values":values}]}));
                            break;
                        }
                    }
                    view.blocks.push(
                        json!({"kind":"table","columns":dataset.columns,"rows":dataset.rows}),
                    );
                }
                Err(message) => view.blocks.push(markdown(message)),
            }
        }
        if !self.files.is_empty() {
            view.blocks.push(json!({"kind":"table","columns":[tr(zh,"已发送文件","Sent file"),"MIME","Bytes",tr(zh,"文本行数","Text lines")],"rows":self.files}));
        }
        if !self.network.is_empty() {
            view.blocks.push(json!({"kind":"table","columns":[tr(zh,"JSON 字段","JSON field"),tr(zh,"值","Value")],"rows":self.network}));
        }
        view.blocks.push(markdown(tr(zh,"CSV 支持引号、逗号与多行单元格。JSON 支持对象、对象数组或标量数组；JSON 表格导出使用 `columns` / `rows`，单元格均为文本。CSV 导出会为可能触发表格公式的单元格添加单引号。\n\nHTTPS 样例仅访问清单声明的 `jsonplaceholder.typicode.com/todos/1`；拒绝网络权限仍可使用全部本地工具。二进制文件只展示名称、类型提示和大小。","CSV supports quoted commas and multiline cells. JSON accepts objects, arrays of objects or scalar arrays. JSON table exports use `columns` / `rows` with text cells. CSV exports prefix cells that could trigger spreadsheet formulas with an apostrophe.\n\nThe HTTPS sample only calls the declared `jsonplaceholder.typicode.com/todos/1`. All local tools work without network permission. Binary files show only their names, type hints and sizes.")));
        view
    }
}

fn json_dataset(source: &str) -> Result<Dataset, String> {
    let value: Value = serde_json::from_str(source)
        .map_err(|error| format!("JSON {}:{}", error.line(), error.column()))?;
    let dataset = match value {
        Value::Object(object) => Dataset {
            columns: vec!["key".into(), "value".into()],
            rows: object
                .into_iter()
                .map(|(key, value)| vec![key, cell(&value)])
                .collect(),
        },
        Value::Array(items) if items.iter().all(Value::is_object) => {
            let keys: BTreeSet<_> = items
                .iter()
                .filter_map(Value::as_object)
                .flat_map(|item| item.keys().cloned())
                .collect();
            let columns: Vec<_> = keys.into_iter().collect();
            let rows = items
                .iter()
                .map(|item| {
                    columns
                        .iter()
                        .map(|key| item.get(key).map(cell).unwrap_or_default())
                        .collect()
                })
                .collect();
            Dataset { columns, rows }
        }
        Value::Array(items)
            if items
                .iter()
                .all(|value| !value.is_object() && !value.is_array()) =>
        {
            Dataset {
                columns: vec!["value".into()],
                rows: items.iter().map(|value| vec![cell(value)]).collect(),
            }
        }
        _ => return Err("Use an object or an array of objects / scalar values".into()),
    };
    validate_dataset(dataset)
}

fn cell(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_string())
}

fn validate_dataset(dataset: Dataset) -> Result<Dataset, String> {
    let unique: BTreeSet<_> = dataset.columns.iter().collect();
    if dataset.columns.is_empty()
        || dataset.columns.len() > 16
        || unique.len() != dataset.columns.len()
        || dataset
            .columns
            .iter()
            .any(|column| column.trim().is_empty() || !valid_text(column, 120))
        || dataset.rows.len() > 200
        || dataset.rows.iter().any(|row| {
            row.len() != dataset.columns.len() || row.iter().any(|cell| !valid_text(cell, 8192))
        })
    {
        return Err("Check column names, row widths and dataset limits".into());
    }
    Ok(dataset)
}

fn csv_dataset(source: &str) -> Result<Dataset, String> {
    let mut chars = source.trim_start_matches('\u{feff}').chars().peekable();
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut closed = false;
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                field.push(ch);
            }
        } else {
            match ch {
                '"' if field.is_empty() && !closed => quoted = true,
                ',' => {
                    row.push(std::mem::take(&mut field));
                    closed = false;
                }
                '\n' | '\r' => {
                    if ch == '\r' && chars.peek() == Some(&'\n') {
                        chars.next();
                    }
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                    closed = false;
                }
                _ if closed || ch == '"' => {
                    return Err("Unexpected text after a quote / unescaped quote".into());
                }
                _ => field.push(ch),
            }
        }
        if field.len() > 8192 || row.len() > 16 || rows.len() > 201 {
            return Err("CSV exceeds dataset limits".into());
        }
    }
    if quoted {
        return Err("Unclosed CSV quote".into());
    }
    if !field.is_empty() || !row.is_empty() || closed {
        row.push(field);
        rows.push(row);
    }
    if rows.is_empty() {
        return Err("CSV needs a header row".into());
    }
    let columns = rows.remove(0);
    validate_dataset(Dataset { columns, rows })
}

fn csv_cell(value: &str) -> String {
    let safe = if value
        .trim_start()
        .starts_with(['=', '+', '-', '@', '\t', '\r'])
    {
        format!("'{value}")
    } else {
        value.into()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_handles_quoted_commas_newlines_and_escaped_quotes() {
        let parsed = csv_dataset("name,note\r\nAda,\"a,b\n\"\"quoted\"\"\"\r\n").unwrap();
        assert_eq!(parsed.rows, vec![vec!["Ada", "a,b\n\"quoted\""]]);
        assert!(csv_dataset("a,b\n1").is_err());
        assert!(csv_dataset("a,b\n\"unclosed,2").is_err());
    }

    #[test]
    fn json_unions_columns_and_retains_missing_cells() {
        let parsed = json_dataset("[{\"a\":1},{\"b\":false}]").unwrap();
        assert_eq!(parsed.columns, vec!["a", "b"]);
        assert_eq!(parsed.rows, vec![vec!["1", ""], vec!["", "false"]]);
        assert!(json_dataset("[]").is_err());
    }

    #[test]
    fn csv_exports_neutralize_formulas() {
        assert_eq!(csv_cell("=SUM(A1)"), "\"'=SUM(A1)\"");
        assert_eq!(csv_cell("a,b"), "\"a,b\"");
    }
}
