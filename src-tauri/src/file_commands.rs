//! 用户主动导出文本；保存路径只由原生对话框授权。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    workbench,
};

#[tauri::command]
#[specta::specta]
pub async fn save_text_export(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> NativeResult<Option<String>> {
    validate_export_name(&name)?;
    blocking::run(move || workbench::save_text_content(&app, &name, &content, 8 * 1024 * 1024))
        .await
}

pub(crate) fn validate_export_name(name: &str) -> NativeResult<()> {
    if name.len() > 100
        || name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        || ![".csv", ".tsv", ".json", ".txt", ".md"]
            .iter()
            .any(|extension| name.ends_with(extension))
    {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Use a plain CSV, JSON or text export name",
        ));
    }
    Ok(())
}
