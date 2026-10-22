//! 安装注册与原生运行时共用品牌集成标识，派生项目不再修改 Rust 字面量。

use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Integration {
    pub deep_link_scheme: String,
    pub file_extension: String,
}

impl Integration {
    fn validate(&self) -> Result<(), &'static str> {
        let identifier = |value: &str| {
            !value.is_empty()
                && value.len() <= 64
                && value.as_bytes()[0].is_ascii_lowercase()
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        };
        if !identifier(&self.deep_link_scheme) || !identifier(&self.file_extension) {
            return Err(
                "Integration identifiers require 1–64 lowercase letters, digits or hyphens, starting with a letter",
            );
        }
        if matches!(
            self.deep_link_scheme.as_str(),
            "http"
                | "https"
                | "file"
                | "ftp"
                | "mailto"
                | "tel"
                | "data"
                | "javascript"
                | "tauri"
                | "asset"
                | "ipc"
                | "ws"
                | "wss"
                | "about"
                | "blob"
        ) {
            return Err("Deep links must use an application-specific scheme");
        }
        if matches!(
            self.file_extension.as_str(),
            "exe"
                | "com"
                | "bat"
                | "cmd"
                | "msi"
                | "ps1"
                | "lnk"
                | "url"
                | "txt"
                | "json"
                | "md"
                | "markdown"
                | "log"
                | "csv"
                | "tsv"
                | "rs"
                | "ts"
                | "js"
                | "css"
                | "toml"
                | "yaml"
                | "yml"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "svg"
                | "pdf"
                | "html"
        ) {
            return Err("File associations must use an application-specific extension");
        }
        Ok(())
    }
}

pub static INTEGRATION: LazyLock<Integration> = LazyLock::new(|| {
    #[derive(Deserialize)]
    struct AppConfig {
        integration: Integration,
    }

    let config = serde_json::from_str::<AppConfig>(include_str!("../../app.config.json"))
        .expect("app.config.json must contain valid integration settings")
        .integration;
    config
        .validate()
        .expect("Invalid application integration settings");
    config
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_integration_matches_installer_registration() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(
            config["plugins"]["deep-link"]["desktop"]["schemes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|scheme| scheme.as_str() == Some(INTEGRATION.deep_link_scheme.as_str())),
        );
        assert!(
            config["bundle"]["fileAssociations"]
                .as_array()
                .unwrap()
                .iter()
                .any(
                    |association| association["ext"].as_array().is_some_and(|extensions| {
                        extensions.iter().any(|extension| {
                            extension.as_str() == Some(INTEGRATION.file_extension.as_str())
                        })
                    })
                ),
        );
    }

    #[test]
    fn integration_identifiers_reject_reserved_and_malformed_values() {
        for value in ["", "WrongCase", "1app", "app.name", "app/name", "app name"] {
            let invalid = Integration {
                deep_link_scheme: value.into(),
                file_extension: "example-doc".into(),
            };
            assert!(invalid.validate().is_err(), "accepted {value}");
        }
        let mut config = Integration {
            deep_link_scheme: "a".repeat(64),
            file_extension: "example-doc".into(),
        };
        assert!(config.validate().is_ok());
        config.deep_link_scheme.push('a');
        assert!(config.validate().is_err());
        config.deep_link_scheme = "https".into();
        assert!(config.validate().is_err());
        config.deep_link_scheme = "example-app".into();
        for extension in ["json", "exe", "jpg", "../outside", "APP"] {
            config.file_extension = extension.into();
            assert!(config.validate().is_err(), "accepted {extension}");
        }
    }
}
