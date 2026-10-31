//! 宿主测试的最小回显模块；仅在测试构建中提供，不属于内置插件目录。
use base64::{Engine as _, engine::general_purpose::STANDARD};

pub(crate) fn module() -> Vec<u8> {
    wat::parse_str(include_str!("../test-fixtures/extension-runtime/echo.wat")).unwrap()
}

pub(crate) fn package() -> String {
    serde_json::json!({
        "manifest": serde_json::from_str::<serde_json::Value>(include_str!(
            "../test-fixtures/extension-runtime/extension.json"
        )).unwrap(),
        "wasm": STANDARD.encode(module()),
    })
    .to_string()
}
