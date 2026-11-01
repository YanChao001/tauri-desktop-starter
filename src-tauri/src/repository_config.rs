//! 编译期仓库传输配置；不改变市场来源身份或向前端开放下载地址。
use serde::Deserialize;
use std::sync::LazyLock;
use url::Url;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryConfig {
    hosting: HostingConfig,
    marketplace: MarketplaceConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostingConfig {
    repository_url_template: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceConfig {
    catalog_url_template: String,
    package_url_template: String,
    download_url_prefixes: Vec<String>,
}

impl RepositoryConfig {
    pub(crate) fn configured() -> Result<&'static Self, ()> {
        static CONFIG: LazyLock<Result<RepositoryConfig, serde_json::Error>> =
            LazyLock::new(|| serde_json::from_str(include_str!("../../repository.config.json")));
        CONFIG.as_ref().map_err(|_| ())
    }

    pub(crate) fn catalog_url(&self, repository: &str) -> Result<Url, ()> {
        let repository_url = self.repository_url(repository)?;
        template_url(
            &self.marketplace.catalog_url_template,
            &[
                ("repository", repository),
                ("repositoryUrl", repository_url.as_str()),
            ],
        )
    }

    pub(crate) fn package_url(&self, repository: &str, tag: &str, asset: &str) -> Result<Url, ()> {
        let repository_url = self.repository_url(repository)?;
        let tag = path_segment(&repository_url, tag)?;
        let asset = path_segment(&repository_url, asset)?;
        template_url(
            &self.marketplace.package_url_template,
            &[
                ("repository", repository),
                ("repositoryUrl", repository_url.as_str()),
                ("tag", &tag),
                ("asset", &asset),
            ],
        )
    }

    fn repository_url(&self, repository: &str) -> Result<Url, ()> {
        let url = template_url(
            &self.hosting.repository_url_template,
            &[("repository", repository)],
        )?;
        if url.query().is_some() {
            return Err(());
        }
        Ok(url)
    }

    fn download_prefixes(&self, repository: &str) -> Result<Vec<Url>, ()> {
        let repository_url = self.repository_url(repository)?;
        self.marketplace
            .download_url_prefixes
            .iter()
            .map(|template| {
                let url = template_url(
                    template,
                    &[
                        ("repository", repository),
                        ("repositoryUrl", repository_url.as_str()),
                    ],
                )?;
                if url.query().is_some() || !url.path().ends_with('/') {
                    return Err(());
                }
                Ok(url)
            })
            .collect()
    }

    pub(crate) fn allows_download(&self, url: &Url, repository: &str) -> bool {
        if !valid_download_url(url) {
            return false;
        }
        // 先验证完整受控策略，再按规范化 origin 与目录边界匹配，避免部分配置静默生效。
        self.download_prefixes(repository).is_ok_and(|prefixes| {
            prefixes.iter().any(|prefix| {
                url.origin() == prefix.origin() && url.path().starts_with(prefix.path())
            })
        })
    }
}

fn valid_download_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.has_host()
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|port| port == 443)
        && url.fragment().is_none()
}

fn template_url(template: &str, values: &[(&str, &str)]) -> Result<Url, ()> {
    let mut expanded = template.to_owned();
    for (name, value) in values {
        expanded = expanded.replace(&format!("{{{name}}}"), value);
    }
    if expanded.contains('{') || expanded.contains('}') {
        return Err(());
    }
    let url = Url::parse(&expanded).map_err(|_| ())?;
    if !valid_download_url(&url) {
        return Err(());
    }
    Ok(url)
}

fn path_segment(base: &Url, value: &str) -> Result<String, ()> {
    if value.is_empty() || matches!(value, "." | "..") {
        return Err(());
    }
    let mut encoded = base.clone();
    encoded.set_path("/");
    encoded.path_segments_mut().map_err(|_| ())?.push(value);
    Ok(encoded.path().trim_start_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom_config() -> RepositoryConfig {
        serde_json::from_str(
            r#"{
                "hosting": {
                    "repositoryUrlTemplate": "https://code.example.com/projects/{repository}"
                },
                "marketplace": {
                    "catalogUrlTemplate": "https://downloads.example.com/market/{repository}/catalog.json",
                    "packageUrlTemplate": "{repositoryUrl}/packages/{tag}/{asset}",
                    "downloadUrlPrefixes": [
                        "https://downloads.example.com/market/{repository}/",
                        "{repositoryUrl}/packages/",
                        "https://cdn.example.com/extension-assets/"
                    ]
                }
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn controlled_templates_select_custom_catalog_and_package_paths() {
        let config = custom_config();
        assert_eq!(
            config.catalog_url("owner/repo").unwrap().as_str(),
            "https://downloads.example.com/market/owner/repo/catalog.json"
        );
        assert_eq!(
            config
                .package_url("owner/repo", "market-7", "example-1.0.0.json")
                .unwrap()
                .as_str(),
            "https://code.example.com/projects/owner/repo/packages/market-7/example-1.0.0.json"
        );
    }

    #[test]
    fn package_template_keeps_tag_and_asset_in_individual_url_segments() {
        let config = custom_config();
        assert_eq!(
            config
                .package_url(
                    "owner/repo",
                    "release/7?mode=one#part",
                    "asset 100%/name.json"
                )
                .unwrap()
                .as_str(),
            "https://code.example.com/projects/owner/repo/packages/release%2F7%3Fmode=one%23part/asset%20100%25%2Fname.json"
        );
    }

    #[test]
    fn custom_download_directories_allow_only_the_configured_origin_and_path() {
        let config = custom_config();
        for source in [
            "https://downloads.example.com/market/owner/repo/catalog.json",
            "https://code.example.com/projects/owner/repo/packages/tag/asset.json",
            "https://cdn.example.com/extension-assets/item.json?token=opaque",
            "https://CDN.EXAMPLE.COM:443/extension-assets/item.json",
        ] {
            assert!(
                config.allows_download(&Url::parse(source).unwrap(), "owner/repo"),
                "configured directory must permit {source}"
            );
        }
        for source in [
            "https://downloads.example.com/market/owner/repo-evil/catalog.json",
            "https://downloads.example.com/market/owner/other/catalog.json",
            "https://downloads.example.com/market/owner/repo/../private/catalog.json",
            "https://downloads.example.com/market/owner/repo/%2e%2e/private/catalog.json",
            "https://downloads.example.com/market/owner/repo/..\\private/catalog.json",
            "https://downloads.example.com.evil.example/market/owner/repo/catalog.json",
            "https://user@downloads.example.com/market/owner/repo/catalog.json",
            "https://downloads.example.com:444/market/owner/repo/catalog.json",
            "https://downloads.example.com/market/owner/repo/catalog.json#fragment",
            "https://cdn.example.com/extension-assets-evil/item.json",
            "https://cdn.example.com/private/item.json",
            "http://cdn.example.com/extension-assets/item.json",
            "https://github.com/owner/repo/releases/item.json",
        ] {
            assert!(
                !config.allows_download(&Url::parse(source).unwrap(), "owner/repo"),
                "out-of-scope download must reject {source}"
            );
        }
    }

    #[test]
    fn download_prefixes_reject_invalid_policy_without_using_other_entries() {
        for prefix in [
            "http://cdn.example.com/extension-assets/",
            "https://user@cdn.example.com/extension-assets/",
            "https://user:password@cdn.example.com/extension-assets/",
            "https://cdn.example.com:444/extension-assets/",
            "https://cdn.example.com/extension-assets/?token=opaque",
            "https://cdn.example.com/extension-assets/#fragment",
            "https://cdn.example.com/extension-assets",
            "https://cdn.example.com/{unknown}/",
        ] {
            let mut config = custom_config();
            config.marketplace.download_url_prefixes.push(prefix.into());
            assert!(
                !config.allows_download(
                    &Url::parse("https://cdn.example.com/extension-assets/item.json").unwrap(),
                    "owner/repo"
                ),
                "invalid policy must fail closed: {prefix}"
            );
        }
    }

    #[test]
    fn templates_reject_unknown_placeholders_and_unsafe_urls() {
        for template in [
            "{repositoryUrl}/catalog/{unknown}.json",
            "http://downloads.example.com/catalog.json",
            "https://user@downloads.example.com/catalog.json",
            "https://downloads.example.com:444/catalog.json",
            "https://downloads.example.com/catalog.json#fragment",
            "not a URL",
        ] {
            let mut config = custom_config();
            config.marketplace.catalog_url_template = template.into();
            assert!(config.catalog_url("owner/repo").is_err(), "{template}");
        }
        let mut config = custom_config();
        config.hosting.repository_url_template = "https://code.example.com/{missing}".into();
        assert!(config.catalog_url("owner/repo").is_err());
        let mut config = custom_config();
        config.marketplace.package_url_template =
            "{repositoryUrl}/packages/{missing}/{asset}".into();
        assert!(config.package_url("owner/repo", "tag", "asset").is_err());
    }
}
