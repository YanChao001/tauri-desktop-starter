//! 有界声明式视图。数据和控件由宿主绘制，状态语义属于插件。
use crate::error::{ErrorCode, NativeError, NativeResult, bounded_text};
use crate::extension_host::{
    ExtensionEffect, ExtensionEffectResult, ExtensionHostContext, validate_effect_id,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{BTreeMap, HashSet};
pub const MAX_VIEW_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_VIEW_STATE_BYTES: usize = 256 * 1024;
pub const DEFAULT_FIELD_BYTES: usize = 64 * 1024;
pub const MAX_FIELD_BYTES: usize = 256 * 1024;
pub const MAX_FORM_BYTES: usize = 1024 * 1024;
const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionIcon {
    Puzzle,
    Calculator,
    Gamepad,
    Notebook,
    Terminal,
    Image,
    MessageCircle,
}
#[derive(Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionViewInput {
    pub id: String,
    pub command_id: String,
    pub expected_sha256: String,
    pub expected_generation: i32,
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
    #[serde(default)]
    pub host: Option<ExtensionHostContext>,
    #[serde(default)]
    pub results: Vec<ExtensionEffectResult>,
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
    #[serde(default)]
    pub errors: BTreeMap<String, String>,
    #[serde(default)]
    pub effects: Vec<ExtensionEffect>,
    #[serde(default)]
    pub artifacts: Vec<ExtensionArtifact>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionArtifact {
    pub name: String,
    pub media_type: String,
    pub content: String,
    pub encoding: ExtensionArtifactEncoding,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionArtifactEncoding {
    Utf8,
    Base64,
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
    #[serde(rename_all = "camelCase")]
    Chart {
        chart_type: ExtensionChartType,
        label: String,
        labels: Vec<String>,
        series: Vec<ExtensionChartSeries>,
    },
    Progress {
        label: String,
        value: f64,
        max: f64,
    },
    Image {
        src: String,
        alt: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionChartType {
    Bar,
    Line,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionChartSeries {
    pub label: String,
    pub values: Vec<f64>,
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
    #[serde(default)]
    pub max_bytes: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum ExtensionFieldKind {
    Text,
    Textarea,
    Number,
    Select,
    Checkbox,
    Date,
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
fn label(value: &str, maximum: usize) -> NativeResult<()> {
    bounded_text(value, maximum, "View label")?;
    if value.trim().is_empty() {
        return Err(invalid());
    }
    Ok(())
}
// 与原生 input 的显示语义一致，避免浏览器把插件值清空但提交时仍发送旧值。
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
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
    {
        return false;
    }
    let year = value[..4].parse::<u32>().unwrap_or(0);
    let month = value[5..7].parse::<u32>().unwrap_or(0);
    let day = value[8..].parse::<u32>().unwrap_or(0);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    year > 0 && day > 0 && day <= maximum
}
fn valid_number(value: &str) -> bool {
    static NUMBER: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")
            .expect("number pattern is valid")
    });
    value.is_empty() || (NUMBER.is_match(value) && value.parse::<f64>().is_ok_and(f64::is_finite))
}
impl ExtensionViewRequest {
    pub fn validate(&self) -> NativeResult<()> {
        if self.version != 2
            || self.fields.len() > 24
            || self.results.len() > 16
            || !["zh-CN", "en"].contains(&self.locale.as_str())
        {
            return Err(invalid());
        }
        bounded_text(&self.state, MAX_VIEW_STATE_BYTES, "View state")?;
        if let Some(action) = &self.action {
            identifier(action)?;
        }
        let mut total = 0;
        for (id, value) in &self.fields {
            identifier(id)?;
            bounded_text(value, MAX_FIELD_BYTES, "View field")?;
            total += value.len();
        }
        if total > MAX_FORM_BYTES
            || serde_json::to_vec(self).map_err(|_| invalid())?.len() > MAX_VIEW_BYTES
        {
            return Err(invalid());
        }
        Ok(())
    }
}
/// 插件只能提供文件名和数据，目标路径始终由用户通过宿主对话框选择。
pub fn validate_artifact(artifact: &ExtensionArtifact) -> NativeResult<Vec<u8>> {
    let name = &artifact.name;
    bounded_text(name, 160, "Artifact name")?;
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || r#"/\:<>"|?*"#.contains(c))
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&stem.as_str())
    {
        return Err(invalid());
    }
    let suffix = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let allowed: &[&str] = match artifact.media_type.as_str() {
        "text/plain" => &["txt", "log"],
        "text/csv" => &["csv"],
        "text/tab-separated-values" => &["tsv"],
        "text/markdown" => &["md"],
        "application/json" => &["json"],
        "application/pdf" => &["pdf"],
        "application/zip" => &["zip"],
        "image/png" => &["png"],
        "image/jpeg" => &["jpg", "jpeg"],
        "image/webp" => &["webp"],
        _ => return Err(invalid()),
    };
    if !allowed.contains(&suffix.as_str()) {
        return Err(invalid());
    }
    let text =
        artifact.media_type.starts_with("text/") || artifact.media_type == "application/json";
    let bytes = match artifact.encoding {
        ExtensionArtifactEncoding::Utf8 if text => {
            bounded_text(&artifact.content, MAX_ARTIFACT_BYTES, "Artifact content")?;
            artifact.content.as_bytes().to_vec()
        }
        ExtensionArtifactEncoding::Base64 if !text => {
            if artifact.content.len() > MAX_ARTIFACT_BYTES.div_ceil(3) * 4 {
                return Err(invalid());
            }
            STANDARD.decode(&artifact.content).map_err(|_| invalid())?
        }
        _ => return Err(invalid()),
    };
    if bytes.len() > MAX_ARTIFACT_BYTES {
        return Err(invalid());
    }
    match artifact.media_type.as_str() {
        "application/pdf" if !bytes.starts_with(b"%PDF-") => return Err(invalid()),
        "application/zip"
            if ![b"PK\x03\x04".as_slice(), b"PK\x05\x06".as_slice()]
                .iter()
                .any(|magic| bytes.starts_with(magic)) =>
        {
            return Err(invalid());
        }
        kind if kind.starts_with("image/") => {
            validate_image(kind, &bytes)?;
        }
        _ => (),
    }
    Ok(bytes)
}
fn validate_image(kind: &str, bytes: &[u8]) -> NativeResult<u64> {
    let dimensions = match kind {
        "image/png"
            if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(12..16) == Some(b"IHDR") =>
        {
            bytes.get(16..24).map(|v| {
                (
                    u32::from_be_bytes(v[..4].try_into().unwrap()),
                    u32::from_be_bytes(v[4..].try_into().unwrap()),
                )
            })
        }
        "image/jpeg" if bytes.starts_with(b"\xff\xd8") => {
            let mut offset = 2;
            let mut size = None;
            while offset + 4 <= bytes.len() && offset < 64 * 1024 {
                if bytes[offset] != 0xff {
                    break;
                }
                let marker = bytes[offset + 1];
                if marker == 0xff {
                    offset += 1;
                    continue;
                }
                if marker == 0xd9 || marker == 0xda {
                    break;
                }
                if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
                    offset += 2;
                    continue;
                }
                let length = u16::from_be_bytes([bytes[offset + 2], bytes[offset + 3]]) as usize;
                if length < 2 || offset + 2 + length > bytes.len() {
                    break;
                }
                if [
                    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
                ]
                .contains(&marker)
                    && length >= 7
                {
                    size = Some((
                        u16::from_be_bytes([bytes[offset + 7], bytes[offset + 8]]) as u32,
                        u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32,
                    ));
                    break;
                }
                offset += 2 + length;
            }
            size
        }
        "image/webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
            match bytes.get(12..16) {
                Some(b"VP8X") if bytes.len() >= 30 => Some((
                    1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]),
                    1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]),
                )),
                Some(b"VP8L") if bytes.len() >= 25 && bytes[20] == 0x2f => {
                    let bits = u32::from_le_bytes(bytes[21..25].try_into().unwrap());
                    Some((1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)))
                }
                Some(b"VP8 ")
                    if bytes.len() >= 30 && bytes.get(23..26) == Some(b"\x9d\x01\x2a") =>
                {
                    Some((
                        (u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff) as u32,
                        (u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3fff) as u32,
                    ))
                }
                _ => None,
            }
        }
        _ => None,
    };
    if dimensions.is_none_or(|(w, h)| {
        w == 0 || h == 0 || w > 8192 || h > 8192 || u64::from(w) * u64::from(h) > 16_000_000
    }) {
        return Err(invalid());
    }
    let (width, height) = dimensions.ok_or_else(invalid)?;
    Ok(u64::from(width) * u64::from(height))
}
impl ExtensionView {
    pub fn parse(output: &str) -> NativeResult<Self> {
        let validate = || -> NativeResult<Self> {
            bounded_text(output, MAX_VIEW_BYTES, "View response")?;
            let view: Self = serde_json::from_str(output).map_err(|_| invalid())?;
            if view.version != 2
                || view.fields.len() > 24
                || view.groups.len() > 16
                || view.tabs.len() > 12
                || view.blocks.len() > 24
                || view.effects.len() > 16
                || view.artifacts.len() > 8
                || view.errors.len() > 24
            {
                return Err(invalid());
            }
            bounded_text(&view.state, MAX_VIEW_STATE_BYTES, "View state")?;
            bounded_text(&view.display, 512, "View display")?;
            bounded_text(&view.description, 2000, "View description")?;
            let mut ids = HashSet::new();
            for tab in &view.tabs {
                identifier(&tab.id)?;
                label(&tab.label, 120)?;
                if tab.id == "host-result" || !ids.insert(&tab.id) {
                    return Err(invalid());
                }
            }
            if !view.tabs.is_empty() && view.tabs.iter().filter(|tab| tab.active).count() != 1 {
                return Err(invalid());
            }
            let mut image_pixels = 0;
            for block in &view.blocks {
                match block {
                    ExtensionViewBlock::Markdown { text } => {
                        bounded_text(text, 256 * 1024, "View Markdown")?
                    }
                    ExtensionViewBlock::Metrics { items } => {
                        if items.is_empty() || items.len() > 16 {
                            return Err(invalid());
                        }
                        for item in items {
                            label(&item.label, 120)?;
                            bounded_text(&item.value, 512, "Metric value")?;
                        }
                    }
                    ExtensionViewBlock::Table { columns, rows } => {
                        if columns.is_empty() || columns.len() > 32 || rows.len() > 2000 {
                            return Err(invalid());
                        }
                        for col in columns {
                            label(col, 120)?;
                        }
                        for row in rows {
                            if row.len() != columns.len() {
                                return Err(invalid());
                            }
                            for cell in row {
                                bounded_text(cell, 16 * 1024, "Table cell")?;
                            }
                        }
                    }
                    ExtensionViewBlock::Chart {
                        label: title,
                        labels,
                        series,
                        ..
                    } => {
                        label(title, 200)?;
                        if labels.is_empty()
                            || labels.len() > 1000
                            || series.is_empty()
                            || series.len() > 8
                        {
                            return Err(invalid());
                        }
                        for value in labels {
                            bounded_text(value, 120, "Chart label")?;
                        }
                        for item in series {
                            label(&item.label, 120)?;
                            if item.values.len() != labels.len()
                                || item.values.iter().any(|n| !n.is_finite())
                            {
                                return Err(invalid());
                            }
                        }
                    }
                    ExtensionViewBlock::Progress {
                        label: title,
                        value,
                        max,
                    } => {
                        label(title, 200)?;
                        if !value.is_finite()
                            || !max.is_finite()
                            || *max <= 0.0
                            || *value < 0.0
                            || value > max
                        {
                            return Err(invalid());
                        }
                    }
                    ExtensionViewBlock::Image { src, alt } => {
                        label(alt, 512)?;
                        let (prefix, content) = src.split_once(',').ok_or_else(invalid)?;
                        let kind = match prefix {
                            "data:image/png;base64" => "image/png",
                            "data:image/jpeg;base64" => "image/jpeg",
                            "data:image/webp;base64" => "image/webp",
                            _ => return Err(invalid()),
                        };
                        if content.len() > MAX_ARTIFACT_BYTES.div_ceil(3) * 4 {
                            return Err(invalid());
                        }
                        let bytes = STANDARD.decode(content).map_err(|_| invalid())?;
                        if bytes.len() > MAX_ARTIFACT_BYTES {
                            return Err(invalid());
                        }
                        image_pixels += validate_image(kind, &bytes)?;
                        if image_pixels > 16_000_000 {
                            return Err(invalid());
                        }
                    }
                }
            }
            let mut form_bytes = 0;
            for field in &view.fields {
                identifier(&field.id)?;
                if !ids.insert(&field.id) {
                    return Err(invalid());
                }
                label(&field.label, 120)?;
                let maximum = field.max_bytes.map_or(DEFAULT_FIELD_BYTES, |n| n as usize);
                if maximum == 0 || maximum > MAX_FIELD_BYTES {
                    return Err(invalid());
                }
                bounded_text(&field.value, maximum, "View field value")?;
                form_bytes += field.value.len();
                if field.options.len() > 100 {
                    return Err(invalid());
                }
                let mut options = HashSet::new();
                for option in &field.options {
                    bounded_text(&option.value, 1024, "Option value")?;
                    label(&option.label, 120)?;
                    if !options.insert(&option.value) {
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
                if matches!(field.kind, Some(ExtensionFieldKind::Number))
                    && !valid_number(&field.value)
                {
                    return Err(invalid());
                }
                if matches!(field.kind, Some(ExtensionFieldKind::Date)) && !valid_date(&field.value)
                {
                    return Err(invalid());
                }
                if !matches!(field.kind, Some(ExtensionFieldKind::Select))
                    && !field.options.is_empty()
                {
                    return Err(invalid());
                }
            }
            if form_bytes > MAX_FORM_BYTES {
                return Err(invalid());
            }
            for (id, error) in &view.errors {
                if !view.fields.iter().any(|field| field.id == *id) {
                    return Err(invalid());
                }
                label(error, 1000)?;
            }
            ids.clear();
            let mut count = 0;
            for group in &view.groups {
                count += group.actions.len();
                if !(1..=8).contains(&group.columns) || group.actions.is_empty() || count > 128 {
                    return Err(invalid());
                }
                for action in &group.actions {
                    identifier(&action.id)?;
                    if !ids.insert(&action.id)
                        || action.id == "host-result"
                        || view.tabs.iter().any(|tab| tab.id == action.id)
                    {
                        return Err(invalid());
                    }
                    if let Some(value) = &action.aria_label {
                        label(value, 120)?;
                    }
                    label(&action.label, 120)?;
                }
            }
            ids.clear();
            for effect in &view.effects {
                let id = match effect {
                    ExtensionEffect::Http { id, .. } | ExtensionEffect::Storage { id, .. } => id,
                };
                validate_effect_id(id)?;
                if !ids.insert(id) {
                    return Err(invalid());
                }
            }
            ids.clear();
            for artifact in &view.artifacts {
                if !ids.insert(&artifact.name) {
                    return Err(invalid());
                }
                validate_artifact(artifact)?;
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
        let base = serde_json::json!({"version":2,"state":"","display":"0","description":"","fields":[],"groups":[{"columns":1,"actions":[{"id":"run","label":"Run","disabled":false,"primary":true}]}]});
        assert!(ExtensionView::parse(&base.to_string()).is_ok());
        for (pointer, value) in [
            ("/version", serde_json::json!(3)),
            (
                "/state",
                serde_json::json!("x".repeat(MAX_VIEW_STATE_BYTES + 1)),
            ),
            ("/groups/0/columns", serde_json::json!(9)),
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
        let mut request = serde_json::json!({"version":2,"action":action,"state":state,"fields":fields,"locale":"zh-CN"});
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
        assert_eq!(view.tabs.len(), 4);
        assert_eq!(view.display, "文本工具");
        let view = step(&view.state, Some("tab-text"), serde_json::json!({}), None);
        assert_eq!(view.fields.len(), 2);
        let view = step(
            &view.state,
            Some("analyze"),
            serde_json::json!({"text":"Hello hello 中文","mode":"upper"}),
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
                serde_json::json!({"inputText":"explicit text", "files":[{"name":"note.txt","content":"saved content","encoding":"utf8","mediaType":"text/plain"}], "network":[]}),
            ),
        );
        assert_eq!(view.display, "文本工具");
        assert_eq!(view.fields[0].value, "explicit text");
        let connections = step(
            &view.state,
            Some("tab-connections"),
            serde_json::json!({}),
            None,
        );
        let blocks = serde_json::to_string(&connections.blocks).unwrap();
        assert!(blocks.contains("note.txt") && blocks.contains("text/plain"));
        // No data in a regular action: old response is retained, never fetched by the plugin.
        let next = step(
            &connections.state,
            Some("tab-text"),
            serde_json::json!({}),
            None,
        );
        assert_eq!(next.display, "文本工具");
        assert_eq!(next.fields[0].value, "explicit text");
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
                Some("tab-todo"),
                Some("tab-connections"),
            ] {
                let request = serde_json::json!({"version":2,"action":action,"state":state,"fields":{},"locale":locale});
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
            version: 2,
            action: None,
            state: String::new(),
            fields: BTreeMap::new(),
            locale: "en".into(),
            host: None,
            results: Vec::new(),
        };
        assert!(request.validate().is_ok());
        request.version = 3;
        assert!(request.validate().is_err());
        request.version = 2;
        request
            .fields
            .insert("input".into(), "x".repeat(MAX_FIELD_BYTES + 1));
        assert!(request.validate().is_err());
    }

    #[test]
    fn checkbox_values_preserve_the_rendered_boolean_value() {
        let base = serde_json::json!({
            "version": 2,
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
    fn wasm_request(request: serde_json::Value) -> ExtensionView {
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
    fn lab_private_tasks_survive_a_new_session_and_roundtrip_host_effects() {
        let host = serde_json::json!({"permissions":["storage"],"storage":{"revision":7,"values":{"todos":[]}}});
        let initial = wasm_request(
            serde_json::json!({"version":2,"state":"","fields":{},"locale":"en","action":"tab-todo","host":host}),
        );
        let invalid = wasm_request(
            serde_json::json!({"version":2,"state":initial.state,"fields":{"todo":"   "},"locale":"en","action":"todo-add","host":host}),
        );
        assert!(invalid.errors.contains_key("todo"));
        assert!(invalid.effects.is_empty());
        let added = wasm_request(
            serde_json::json!({"version":2,"state":invalid.state,"fields":{"todo":"Ship plugin","due":"2026-10-25"},"locale":"en","action":"todo-add","host":host}),
        );
        let effect = serde_json::to_value(&added.effects[0]).unwrap();
        assert_eq!(effect["expectedRevision"], 7);
        assert_eq!(effect["changes"]["todos"][0]["text"], "Ship plugin");
        let host = serde_json::json!({"permissions":["storage"],"storage":{"revision":8,"values":{"todos":effect["changes"]["todos"]}}});
        let saved = wasm_request(
            serde_json::json!({"version":2,"state":added.state,"fields":{},"locale":"en","action":"host-result","host":host,"results":[{"id":"add-task","value":host["storage"],"error":null}]}),
        );
        assert!(saved.effects.is_empty());
        assert!(
            saved
                .fields
                .iter()
                .find(|field| field.id == "todo")
                .unwrap()
                .value
                .is_empty()
        );
        let reopened = wasm_request(
            serde_json::json!({"version":2,"state":"","fields":{},"locale":"en","action":"tab-todo","host":host}),
        );
        assert!(
            serde_json::to_string(&reopened.blocks)
                .unwrap()
                .contains("Ship plugin")
        );
        let toggled = wasm_request(
            serde_json::json!({"version":2,"state":reopened.state,"fields":{},"locale":"en","action":"todo-toggle-0","host":host}),
        );
        assert_eq!(
            serde_json::to_value(&toggled.effects[0]).unwrap()["changes"]["todos"][0]["completed"],
            true
        );
    }
    #[test]
    fn lab_http_and_artifacts_use_real_wasm_without_contacting_external_services() {
        let denied = wasm_request(
            serde_json::json!({"version":2,"state":"","fields":{},"locale":"en","action":"fetch-todo","host":{"permissions":[],"storage":null}}),
        );
        assert!(denied.effects.is_empty());
        let requested = wasm_request(
            serde_json::json!({"version":2,"state":denied.state,"fields":{},"locale":"en","action":"fetch-todo","host":{"permissions":["network:https"],"storage":null}}),
        );
        let effect = serde_json::to_value(&requested.effects[0]).unwrap();
        assert_eq!(effect["request"]["method"], "GET");
        assert_eq!(
            effect["request"]["url"],
            "https://jsonplaceholder.typicode.com/todos/1"
        );
        let response = wasm_request(
            serde_json::json!({"version":2,"state":requested.state,"fields":{},"locale":"en","action":"host-result","results":[{"id":"fetch-todo","error":null,"value":{"status":200,"url":effect["request"]["url"],"headers":{},"body":"{\"title\":\"offline fixture\"}"}}]}),
        );
        assert!(response.effects.is_empty());
        assert!(
            serde_json::to_string(&response.blocks)
                .unwrap()
                .contains("offline fixture")
        );
        let analyzed = step("", Some("tab-text"), serde_json::json!({}), None);
        let analyzed = step(
            &analyzed.state,
            Some("analyze"),
            serde_json::json!({"text":"Hello 世界","mode":"upper"}),
            None,
        );
        assert!(
            analyzed
                .blocks
                .iter()
                .any(|block| matches!(block, ExtensionViewBlock::Chart { .. }))
        );
        let exported = step(
            &analyzed.state,
            Some("export-text"),
            serde_json::json!({}),
            None,
        );
        assert_eq!(
            validate_artifact(&exported.artifacts[0]).unwrap(),
            "HELLO 世界".as_bytes()
        );
    }
    #[test]
    fn artifacts_reject_paths_executables_mismatched_encodings_and_oversized_images() {
        let mut artifact = ExtensionArtifact {
            name: "report.txt".into(),
            media_type: "text/plain".into(),
            content: "Hello 世界".into(),
            encoding: ExtensionArtifactEncoding::Utf8,
        };
        assert!(validate_artifact(&artifact).is_ok());
        for name in [
            "../report.txt",
            "report.exe",
            "CON.txt",
            ".report.txt",
            "report.txt.",
            "report.txt ",
            "sub\\report.txt",
            "report:stream.txt",
        ] {
            artifact.name = name.into();
            assert!(validate_artifact(&artifact).is_err(), "{name}");
        }
        artifact.name = "report.txt".into();
        artifact.encoding = ExtensionArtifactEncoding::Base64;
        assert!(validate_artifact(&artifact).is_err());
        artifact.name = "image.png".into();
        artifact.media_type = "image/png".into();
        artifact.content="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2UAAAAASUVORK5CYII=".into();
        assert!(validate_artifact(&artifact).is_ok());
        let mut bytes = STANDARD.decode(&artifact.content).unwrap();
        bytes[16..20].copy_from_slice(&9000_u32.to_be_bytes());
        artifact.content = STANDARD.encode(bytes);
        assert!(validate_artifact(&artifact).is_err());
        artifact.name = "image.svg".into();
        artifact.media_type = "image/svg+xml".into();
        assert!(validate_artifact(&artifact).is_err());
    }
    #[test]
    fn rich_blocks_and_field_budgets_are_validated_before_rendering() {
        let base = serde_json::json!({"version":2,"state":"","display":"View","description":"","fields":[{"id":"text","label":"Text","value":"x"}],"groups":[],"blocks":[]});
        for block in [
            serde_json::json!({"kind":"chart","chartType":"line","label":"Metrics","labels":["a","b"],"series":[{"label":"Count","values":[1]}]}),
            serde_json::json!({"kind":"progress","label":"Progress","value":2,"max":1}),
            serde_json::json!({"kind":"image","alt":"Untrusted","src":"https://example.com/a.png"}),
            serde_json::json!({"kind":"image","alt":"Untrusted","src":"data:image/svg+xml;base64,PHN2Zy8+"}),
        ] {
            let mut value = base.clone();
            value["blocks"] = serde_json::json!([block]);
            assert!(ExtensionView::parse(&value.to_string()).is_err());
        }
        let mut large = base.clone();
        large["fields"][0]["value"] = serde_json::json!("a".repeat(DEFAULT_FIELD_BYTES + 1));
        assert!(ExtensionView::parse(&large.to_string()).is_err());
        large["fields"][0]["maxBytes"] = serde_json::json!(MAX_FIELD_BYTES);
        assert!(ExtensionView::parse(&large.to_string()).is_ok());
        large["fields"][0]["maxBytes"] = serde_json::json!(MAX_FIELD_BYTES + 1);
        assert!(ExtensionView::parse(&large.to_string()).is_err());
        let mut invalid = base;
        invalid["errors"] = serde_json::json!({"missing":"Required"});
        assert!(ExtensionView::parse(&invalid.to_string()).is_err());
    }
    #[test]
    fn date_and_number_fields_never_disagree_with_native_input_display() {
        let base = serde_json::json!({"version":2,"state":"","display":"Form","description":"","fields":[{"id":"date","label":"Date","kind":"date","value":""}],"groups":[]});
        for (value, valid) in [
            ("", true),
            ("2024-02-29", true),
            ("2026-02-29", false),
            ("2026-13-01", false),
            ("2026-01-00", false),
            ("0000-01-01", false),
            ("2026-10-25", true),
            ("中文-10-25", false),
        ] {
            let mut view = base.clone();
            view["fields"][0]["value"] = serde_json::json!(value);
            assert_eq!(
                ExtensionView::parse(&view.to_string()).is_ok(),
                valid,
                "{value}"
            );
        }
        for (value, valid) in [
            ("", true),
            ("-1.5", true),
            (".25", true),
            ("1e3", true),
            ("+1", false),
            ("1.", false),
            ("NaN", false),
            ("Infinity", false),
            ("1e999", false),
            (" 1", false),
        ] {
            let mut view = base.clone();
            view["fields"][0]["kind"] = serde_json::json!("number");
            view["fields"][0]["value"] = serde_json::json!(value);
            assert_eq!(
                ExtensionView::parse(&view.to_string()).is_ok(),
                valid,
                "{value}"
            );
        }
    }
}
