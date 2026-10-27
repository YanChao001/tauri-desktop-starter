//! 宿主原生 HTTP 的连接偏好；每次请求读取已提交设置，不修改进程代理环境。
use tauri_plugin_http::reqwest::ClientBuilder;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum NetworkMode {
    #[default]
    System,
    Direct,
}

pub fn configure_client(builder: ClientBuilder, mode: NetworkMode) -> ClientBuilder {
    match mode {
        NetworkMode::System => builder,
        NetworkMode::Direct => builder.no_proxy(),
    }
}

/// 调用方先将名称规范为小写；凭据与传输控制头不由用户请求提供。
pub(crate) fn permitted_header(name: &str) -> bool {
    !matches!(
        name,
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "cookie2"
            | "set-cookie"
            | "host"
            | "connection"
            | "content-length"
            | "transfer-encoding"
            | "upgrade"
            | "te"
            | "trailer"
            | "keep-alive"
            | "expect"
            | "origin"
            | "referer"
            | "forwarded"
            | "via"
    ) && !name.starts_with("proxy-")
        && !name.starts_with("sec-")
        && !name.starts_with("x-forwarded-")
}
