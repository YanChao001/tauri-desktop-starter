use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::view::{View, artifact, button, literal, markdown, tr, truncate, valid_text};

pub(crate) const MAX_TEXT: usize = 65_536;
const MODES: [&str; 9] = [
    "upper",
    "lower",
    "trim",
    "original",
    "dedupe",
    "sort",
    "number",
    "json-pretty",
    "json-minify",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TextStudio {
    pub input: String,
    mode: String,
    analyzed: bool,
    pub notice: String,
}

impl TextStudio {
    pub fn new(_zh: bool) -> Self {
        Self {
            input: String::new(),
            mode: "original".into(),
            analyzed: false,
            notice: String::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !valid_text(&self.input, MAX_TEXT)
            || !MODES.contains(&self.mode.as_str())
            || !valid_text(&self.notice, 1000)
        {
            return Err("Invalid text studio session".into());
        }
        Ok(())
    }

    pub fn fields(&mut self, fields: &Value) -> Result<(), String> {
        if let Some(value) = fields["text"].as_str() {
            if !valid_text(value, MAX_TEXT) {
                return Err("Text exceeds the 64 KiB editing limit".into());
            }
            if value != self.input {
                self.input = value.into();
                self.notice.clear();
            }
        }
        if let Some(mode) = fields["mode"].as_str() {
            if !MODES.contains(&mode) {
                return Err("Unknown text transformation".into());
            }
            self.mode = mode.into();
        }
        Ok(())
    }

    pub fn import(&mut self, source: &str, zh: bool) {
        self.input = truncate(source, MAX_TEXT);
        self.analyzed = true;
        self.notice = if source.len() > MAX_TEXT {
            tr(
                zh,
                "输入超过 64 KiB：工坊仅载入前 64 KiB；统计和导出均针对已载入文本。原文件未修改。",
                "Input exceeds 64 KiB: only the first 64 KiB were loaded. Statistics and exports use this loaded text; the source file is unchanged.",
            )
        } else {
            String::new()
        };
    }

    pub fn act(
        &mut self,
        action: &str,
        zh: bool,
        errors: &mut BTreeMap<String, String>,
        artifacts: &mut Vec<Value>,
    ) {
        match action {
            "analyze" => self.analyzed = true,
            "sample" => {
                self.input = tr(
                    zh,
                    "Rust is fast. Wasm is portable.\nRust 与 Wasm 让插件复用。\nOne runtime, many languages.\nRust is fast. Wasm is portable.",
                    "Rust is fast. Wasm is portable.\nRust and Wasm make plugins reusable.\nOne runtime, many languages.\nRust is fast. Wasm is portable.",
                );
                self.analyzed = true;
                self.notice.clear();
            }
            "clear" => {
                self.input.clear();
                self.analyzed = false;
                self.notice.clear();
            }
            "export-text" => match self.transform(zh) {
                Ok(result) => artifacts.push(artifact("transformed.txt", "text/plain", &result)),
                Err(message) => {
                    errors.insert("text".into(), message);
                }
            },
            _ => {}
        }
        if self.analyzed
            && let Err(message) = self.transform(zh)
        {
            errors.insert("text".into(), message);
        }
    }

    fn transform(&self, zh: bool) -> Result<String, String> {
        let transformed = match self.mode.as_str() {
            "upper" => self.input.to_uppercase(),
            "lower" => self.input.to_lowercase(),
            "trim" => self
                .input
                .lines()
                .map(str::trim)
                .collect::<Vec<_>>()
                .join("\n"),
            "dedupe" => {
                let mut seen = std::collections::BTreeSet::new();
                self.input
                    .lines()
                    .filter(|line| seen.insert(*line))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
            "sort" => {
                let mut lines: Vec<_> = self.input.lines().collect();
                lines.sort_unstable();
                lines.join("\n")
            }
            "number" => self
                .input
                .lines()
                .enumerate()
                .map(|(index, line)| format!("{}. {line}", index + 1))
                .collect::<Vec<_>>()
                .join("\n"),
            "json-pretty" | "json-minify" => {
                let parsed: Value = serde_json::from_str(&self.input).map_err(|error| {
                    format!(
                        "{} {}:{}",
                        tr(zh, "JSON 格式错误，行:列", "Invalid JSON at line:column"),
                        error.line(),
                        error.column()
                    )
                })?;
                if self.mode == "json-pretty" {
                    serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?
                } else {
                    parsed.to_string()
                }
            }
            _ => self.input.clone(),
        };
        if transformed.len() > 512 * 1024 {
            return Err(tr(
                zh,
                "转换结果超过 512 KiB，请缩短输入后重试。",
                "The transformed result exceeds 512 KiB. Shorten the input and retry.",
            ));
        }
        Ok(transformed)
    }

    pub fn render(&self, zh: bool) -> View {
        let mut view = View {
            display: tr(zh, "文本工具", "Text tools"),
            description: tr(
                zh,
                "粘贴文本，选择处理方式，查看或保存结果。",
                "Paste text, choose an operation, then inspect or save the result.",
            ),
            ..View::default()
        };
        let modes = [
            ("upper", "转大写", "UPPERCASE"),
            ("lower", "转小写", "lowercase"),
            ("trim", "修剪每行空白", "Trim each line"),
            ("original", "保留原文", "Original"),
            ("dedupe", "行去重（保留顺序）", "Unique lines (keep order)"),
            ("sort", "按 Unicode 排序行", "Sort lines by Unicode"),
            ("number", "添加行号", "Add line numbers"),
            ("json-pretty", "美化 JSON", "Format JSON"),
            ("json-minify", "压缩 JSON", "Minify JSON"),
        ];
        view.fields = vec![
            json!({"id":"text","label":tr(zh,"编辑文本（最多 64 KiB）","Edit text (up to 64 KiB)"),"value":self.input,"kind":"textarea","maxBytes":MAX_TEXT}),
            json!({"id":"mode","label":tr(zh,"转换方式","Transform"),"value":self.mode,"kind":"select","options":modes.into_iter().map(|(value,cn,en)|json!({"value":value,"label":tr(zh,cn,en)})).collect::<Vec<_>>()}),
        ];
        view.groups.push(json!({"columns":2,"actions":[button("analyze",&tr(zh,"处理文本","Apply"),true),button("export-text",&tr(zh,"导出 TXT","Export TXT"),false),button("sample",&tr(zh,"载入样例","Load sample"),false),button("clear",&tr(zh,"清空","Clear"),false)]}));
        if !self.notice.is_empty() {
            view.blocks.push(markdown(&self.notice));
        }
        if self.analyzed {
            let mut counts = BTreeMap::<String, u32>::new();
            for word in self.input.split_whitespace() {
                let word = word
                    .trim_matches(|ch: char| !ch.is_alphanumeric())
                    .to_lowercase();
                if !word.is_empty() && word.len() <= 120 {
                    *counts.entry(word).or_default() += 1;
                }
            }
            let mut top: Vec<_> = counts.into_iter().collect();
            top.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            top.truncate(8);
            view.blocks.push(json!({"kind":"metrics","items":[
                {"label":tr(zh,"Unicode 字符","Unicode characters"),"value":self.input.chars().count().to_string()},
                {"label":tr(zh,"词 / 空白分隔","Words / whitespace"),"value":self.input.split_whitespace().count().to_string()},
                {"label":tr(zh,"行","Lines"),"value":self.input.lines().count().to_string()},
                {"label":"UTF-8 bytes","value":self.input.len().to_string()}
            ]}));
            if !top.is_empty() {
                view.blocks.push(json!({"kind":"chart","chartType":"bar","label":tr(zh,"词频（空白分词）","Word frequency (whitespace tokens)"),"labels":top.iter().map(|(word,_)|word).collect::<Vec<_>>(),"series":[{"label":tr(zh,"次数","Count"),"values":top.iter().map(|(_,count)|count).collect::<Vec<_>>()}]}));
                view.blocks.push(json!({"kind":"table","columns":[tr(zh,"高频词","Top words"),tr(zh,"出现次数","Count")],"rows":top.iter().map(|(word,count)|vec![word.clone(),count.to_string()]).collect::<Vec<_>>()}));
            }
            {
                match self.transform(zh) {
                    Ok(result) => view.blocks.push(markdown(format!(
                        "### {}\n\n{}",
                        tr(
                            zh,
                            "转换预览（最多 32000 字节，导出保留完整结果）",
                            "Preview (up to 32000 bytes; exports keep the full result)"
                        ),
                        literal(&truncate(&result, 32_000))
                    ))),
                    Err(message) => view.blocks.push(markdown(message)),
                }
            }
        } else {
            view.blocks.push(markdown(tr(
                zh,
                "处理后的结果会显示在这里。",
                "Your processed result will appear here.",
            )));
        }
        view
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transformations_preserve_unicode_and_dedupe_order() {
        let mut state = TextStudio::new(false);
        state.input = "星河\nhello\n星河\nworld".into();
        state.mode = "dedupe".into();
        assert_eq!(state.transform(false).unwrap(), "星河\nhello\nworld");
        state.mode = "upper".into();
        assert!(state.transform(false).unwrap().contains("HELLO"));
    }

    #[test]
    fn invalid_json_has_no_export_and_keeps_the_input() {
        let mut state = TextStudio::new(false);
        state.input = "{broken".into();
        state.mode = "json-pretty".into();
        let mut errors = BTreeMap::new();
        let mut artifacts = vec![];
        state.act("export-text", false, &mut errors, &mut artifacts);
        assert!(errors.contains_key("text"));
        assert!(artifacts.is_empty());
        assert_eq!(state.input, "{broken");
    }

    #[test]
    fn imported_text_uses_one_explicit_truncation_boundary() {
        let mut state = TextStudio::new(true);
        state.import(&"界".repeat(MAX_TEXT), true);
        assert!(state.input.len() <= MAX_TEXT);
        assert!(!state.notice.is_empty());
        assert_eq!(state.transform(true).unwrap(), state.input);
    }
}
