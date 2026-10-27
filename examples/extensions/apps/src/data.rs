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
    received: String,
    response: String,
    received_truncated: bool,
    source_notice: String,
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
            || !valid_text(&self.received, MAX_SOURCE)
            || !valid_text(&self.response, MAX_SOURCE)
            || !valid_text(&self.source_notice, 1000)
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
            if source != self.source {
                self.source_notice.clear();
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

    pub fn receive(&mut self, data: &Value, zh: bool) -> String {
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
            }
        }
        let source = if !data["inputText"].as_str().unwrap_or("").trim().is_empty() {
            data["inputText"].as_str().unwrap_or("")
        } else {
            first_text_file.unwrap_or("")
        };
        self.received = truncate(source, MAX_SOURCE);
        self.received_truncated = source.len() > MAX_SOURCE;
        self.status = if source.len() > MAX_SOURCE {
            tr(
                zh,
                "仅接收前 64 KiB 文本；文件大小仍显示原始值。",
                "Only the first 64 KiB of text were received; file sizes show the original values.",
            )
        } else {
            tr(
                zh,
                "已接收所选内容。可将文本载入工具；其他草稿保持不变。",
                "Selected content received. Load its text into a tool when needed; other drafts stay unchanged.",
            )
        };
        source.to_owned()
    }

    pub fn received_text(&self) -> &str {
        &self.received
    }

    pub fn received_was_truncated(&self) -> bool {
        self.received_truncated
    }

    pub fn use_received(&mut self, zh: bool) {
        self.source = self.received.clone();
        self.format = "auto".into();
        self.analyzed = false;
        self.source_notice = if self.received_truncated {
            tr(
                zh,
                "仅载入前 64 KiB 文本；预览和导出均针对已载入内容。原文件未修改。",
                "Only the first 64 KiB were loaded. Preview and export use this loaded content; the original file is unchanged.",
            )
        } else {
            String::new()
        };
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
            self.response.clear();
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
            self.response = body.into();
        } else {
            self.response.clear();
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
            "data-use-received" => self.use_received(zh),
            "data-use-response" => {
                self.source = self.response.clone();
                self.format = "json".into();
                self.analyzed = false;
                self.source_notice.clear();
            }
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
                self.source_notice.clear();
                self.source = "项目,得分,备注\n星舰,84,\"可离线游玩, 支持撤销\"\n灯塔,96,\"你好\n第二行\"\n纸飞机,72,轻装出发".into();
                self.format = "csv".into();
                self.analyzed = true;
                self.status.clear();
            }
            "data-sample-json" => {
                self.source_notice.clear();
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
            display: tr(zh, "CSV / JSON", "CSV / JSON"),
            description: tr(
                zh,
                "粘贴数据，预览表格，再按需要导出。全部在本地完成。",
                "Paste data, preview a table, then export what you need. Everything runs locally.",
            ),
            ..View::default()
        };
        view.fields = vec![
            json!({"id":"data-source","label":tr(zh,"数据内容（或发送所选文本文件）","Dataset (or send a selected text file)"),"kind":"textarea","value":self.source,"maxBytes":MAX_SOURCE}),
            json!({"id":"data-format","label":tr(zh,"解析格式","Parse as"),"kind":"select","value":self.format,"options":[{"value":"auto","label":tr(zh,"自动识别 JSON / CSV","Detect JSON / CSV")},{"value":"json","label":"JSON"},{"value":"csv","label":"CSV"}]}),
        ];
        view.groups = vec![
            json!({"columns":3,"actions":[button("data-preview",&tr(zh,"预览与绘图","Preview & chart"),true),button("data-sample-csv",&tr(zh,"CSV 样例","CSV sample"),false),button("data-sample-json",&tr(zh,"JSON 样例","JSON sample"),false)]}),
            json!({"columns":2,"actions":[button("data-export-json",&tr(zh,"导出 JSON","Export JSON"),false),button("data-export-csv",&tr(zh,"导出 CSV","Export CSV"),false)]}),
        ];
        if !self.source_notice.is_empty() {
            view.blocks.push(markdown(&self.source_notice));
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
        if !self.analyzed {
            view.blocks.push(markdown(tr(
                zh,
                "粘贴 CSV / JSON，或载入一个样例开始。",
                "Paste CSV / JSON, or load a sample to begin.",
            )));
        }
        view
    }

    pub fn render_connections(&self, request: &Value, zh: bool) -> View {
        let mut view = View {
            display: tr(zh, "文件与网络", "Files & network"),
            description: tr(
                zh,
                "按需接收文件或请求公开样例，不会自动联网。",
                "Receive selected files or fetch a public sample on demand. No automatic network access.",
            ),
            ..View::default()
        };
        view.blocks.push(markdown(tr(zh,"通过宿主的“扩展工具”选择并发送文本或文件。这里只能读取你主动发送的内容。","Select and send text or files through the host's Extension tools. Only explicitly sent content is available here.")));
        if !self.status.is_empty() {
            view.blocks.push(markdown(&self.status));
        }
        if !self.files.is_empty() {
            view.blocks.push(json!({"kind":"table","columns":[tr(zh,"已发送文件","Sent file"),tr(zh,"类型提示","Type hint"),tr(zh,"字节","Bytes"),tr(zh,"文本行数","Text lines")],"rows":self.files}));
        }
        if !self.received.is_empty() {
            view.groups.push(json!({"columns":2,"actions":[button("text-use-received",&tr(zh,"载入文本工具","Load in Text"),false),button("data-use-received",&tr(zh,"载入 CSV / JSON","Load in CSV / JSON"),false)]}));
        }
        view.groups.push(json!({"columns":1,"actions":[button("fetch-todo",&tr(zh,"请求 HTTPS 样例","Fetch HTTPS sample"),true)]}));
        if !permission(request, "network:https") {
            view.blocks.push(markdown(tr(zh,"HTTPS 尚未授权。可在扩展权限中单独允许；本地工具不受影响。","HTTPS is not granted. Allow it in extension permissions when needed; local tools remain available.")));
        }
        if !self.network.is_empty() {
            view.blocks.push(json!({"kind":"table","columns":[tr(zh,"响应字段","Response field"),tr(zh,"值","Value")],"rows":self.network}));
        }
        if !self.response.is_empty() {
            view.groups.push(json!({"columns":1,"actions":[button("data-use-response",&tr(zh,"将响应载入 CSV / JSON","Load response in CSV / JSON"),false)]}));
        }
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

pub(crate) fn csv_cell(value: &str) -> String {
    let safe = if value.starts_with(['\t', '\r', '\n'])
        || value.trim_start().starts_with(['=', '+', '-', '@'])
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
        assert_eq!(csv_cell(" \t@SUM(A1)"), "\"' \t@SUM(A1)\"");
        assert_eq!(csv_cell("\tplain text"), "\"'\tplain text\"");
        assert_eq!(csv_cell("\rplain text"), "\"'\rplain text\"");
        assert_eq!(csv_cell("\nplain text"), "\"'\nplain text\"");
        assert_eq!(csv_cell("a,b"), "\"a,b\"");
    }

    #[test]
    fn https_receipt_does_not_replace_a_local_dataset_until_requested() {
        let mut studio = DataStudio::new();
        studio.source = "name,score\nAda,9".into();
        studio.receipt(&json!({"id":"fetch-todo","error":null,"value":{"status":200,"url":"https://jsonplaceholder.typicode.com/todos/1","body":"{\"id\":1}"}}),false);
        assert_eq!(studio.source, "name,score\nAda,9");
        assert_eq!(studio.response, "{\"id\":1}");
        studio.act(
            "data-use-response",
            &json!({}),
            false,
            &mut BTreeMap::new(),
            &mut vec![],
            &mut vec![],
        );
        assert_eq!(studio.source, "{\"id\":1}");
        assert_eq!(studio.format, "json");
    }

    #[test]
    fn received_text_truncation_remains_visible_when_loaded_later() {
        let mut studio = DataStudio::new();
        studio.receive(
            &json!({"inputText":"界".repeat(MAX_SOURCE),"files":[]}),
            true,
        );
        assert!(studio.received.len() <= MAX_SOURCE);
        assert!(studio.received_was_truncated());
        studio.use_received(true);
        assert!(!studio.source_notice.is_empty());
        assert_eq!(studio.source, studio.received);
    }
}
