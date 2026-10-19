//! 前端可调用的命令。
//!
//! 命令实现放在这里，`lib.rs` 只负责组装（注册插件、挂上 handler）。
//! 加命令时：在本文件写 `#[tauri::command]`，然后去 `lib.rs` 的
//! `generate_handler!` 里登记——忘了登记就会报 "command not found"。
//!
//! 命令变多以后，把本文件拆成 `commands/` 目录，按领域分文件
//! （如 `commands/file.rs`、`commands/db.rs`），`commands/mod.rs` 统一导出。

/// 示例命令：把名字拼进一句问候语。
///
/// 返回 `Result` 是刻意的：Tauri 会把 `Err` 原样 reject 到前端。
/// 模板想示范的约定是「校验在边界完成，错误由调用方展示」，
/// 而不是把校验散落在页面里。
/// 错误需要分叉处理时，升级为 `serde::Serialize` 的 enum，见 architecture.md。
#[tauri::command]
pub fn greet(name: &str, language: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    let english = language == Some("en");
    if name.is_empty() {
        return Err(if english {
            "Name cannot be empty"
        } else {
            "名称不能为空"
        }
        .into());
    }
    Ok(if english {
        format!("Hello, {name}! This message comes from Rust.")
    } else {
        format!("你好，{name}！这条消息来自 Rust。")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_returns_greeting() {
        assert_eq!(
            greet("世界", None).unwrap(),
            "你好，世界！这条消息来自 Rust。"
        );
    }

    #[test]
    fn greet_trims_surrounding_spaces() {
        assert_eq!(
            greet("  世界  ", Some("zh")).unwrap(),
            "你好，世界！这条消息来自 Rust。"
        );
    }

    #[test]
    fn greet_rejects_blank_name() {
        // 空串和纯空白都要拦住，这是「校验在边界」的具体体现
        assert_eq!(greet("", None).unwrap_err(), "名称不能为空");
        assert!(greet("   ", Some("zh")).is_err());
    }

    #[test]
    fn greet_uses_english_for_message_and_validation() {
        assert_eq!(
            greet(" Ada ", Some("en")).unwrap(),
            "Hello, Ada! This message comes from Rust."
        );
        assert_eq!(
            greet("   ", Some("en")).unwrap_err(),
            "Name cannot be empty"
        );
    }

    #[test]
    fn greet_unknown_language_falls_back_to_chinese() {
        assert_eq!(
            greet("世界", Some("fr")).unwrap(),
            greet("世界", None).unwrap()
        );
    }
}
