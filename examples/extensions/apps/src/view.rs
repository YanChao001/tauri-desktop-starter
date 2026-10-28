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

pub(crate) fn button(id: &str, label: &str, primary: bool) -> Value {
    json!({"id":id,"label":label,"disabled":false,"primary":primary})
}

pub(crate) fn markdown(text: impl Into<String>) -> Value {
    json!({"kind":"markdown","text":text.into()})
}

pub(crate) fn artifact(name: &str, media_type: &str, content: &str) -> Value {
    json!({"name":name,"mediaType":media_type,"encoding":"utf8","content":content})
}

pub(crate) fn valid_text(value: &str, maximum: usize) -> bool {
    value.len() <= maximum && !value.contains('\0')
}
