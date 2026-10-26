use serde_json::{Value, json};

#[derive(Default)]
pub(crate) struct View {
    pub display: String,
    pub description: String,
    pub fields: Vec<Value>,
    pub groups: Vec<Value>,
    pub blocks: Vec<Value>,
}

pub(crate) fn tr(zh: bool, cn: &str, en: &str) -> String {
    if zh { cn.into() } else { en.into() }
}

pub(crate) fn truncate(value: &str, bytes: usize) -> String {
    let mut end = value.len().min(bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].into()
}

pub(crate) fn button(id: &str, label: &str, primary: bool) -> Value {
    json!({"id":id,"label":label,"disabled":false,"primary":primary})
}

pub(crate) fn markdown(text: impl Into<String>) -> Value {
    json!({"kind":"markdown","text":text.into()})
}

pub(crate) fn literal(text: &str) -> String {
    text.lines()
        .map(|line| format!("    {line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn artifact(name: &str, media_type: &str, content: &str) -> Value {
    json!({"name":name,"mediaType":media_type,"encoding":"utf8","content":content})
}

pub(crate) fn permission(request: &Value, name: &str) -> bool {
    request["host"]["permissions"]
        .as_array()
        .is_some_and(|items| items.iter().any(|item| item == name))
}

pub(crate) fn valid_text(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && !value.contains('\0')
}
