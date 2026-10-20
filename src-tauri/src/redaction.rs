//! 错误日志与诊断预览共用的纯文本脱敏，不依赖应用状态或服务模块。

use std::sync::OnceLock;

use regex::Regex;

pub fn redact(text: &str) -> String {
    static URL_PATTERN: OnceLock<Regex> = OnceLock::new();
    let urls = URL_PATTERN.get_or_init(|| {
        Regex::new(r#"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s<>\"']+"#).expect("valid URL redaction pattern")
    });
    let sanitized_urls = urls.replace_all(text, |captures: &regex::Captures<'_>| {
        if let Ok(mut parsed) = url::Url::parse(&captures[0]) {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string()
        } else {
            "[url omitted]".into()
        }
    });
    static SECRET_PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = SECRET_PATTERN.get_or_init(|| Regex::new(r#"(?i)(authorization[\s\"'=:]+(?:bearer\s+)?|bearer\s+|(?:token|password|secret|api[_-]?key)[\s\"'=:]+)[^\s&\"']+"#).expect("valid redaction pattern"));
    let mut redacted = pattern
        .replace_all(&sanitized_urls, "$1[redacted]")
        .into_owned();
    for variable in ["USERPROFILE", "HOME"] {
        if let Some(value) = std::env::var_os(variable) {
            let home = value.to_string_lossy();
            if home.len() > 3 {
                redacted = redacted
                    .replace(home.as_ref(), "[home]")
                    .replace(&home.replace('\\', "/"), "[home]");
            }
        }
    }
    redacted
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_remove_common_secrets_and_home_paths() {
        let text = redact("request token=abc&password=secret Authorization: Bearer xyz");
        assert!(!text.contains("abc"));
        assert!(!text.contains("xyz"));
        if let Ok(home) = std::env::var("USERPROFILE") {
            assert!(!redact(&format!("{home}/file")).contains(&home));
        }
        assert!(text.contains("[redacted]"));
        let url =
            redact("fetch https://user:pass@example.com/path?code=oauth&session=private#secret");
        assert_eq!(url, "fetch https://example.com/path");
        assert!(!url.contains("user"));
        assert!(!url.contains("oauth"));
    }
}
