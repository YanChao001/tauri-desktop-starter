//! 扩展的显式来源 HTTP broker；直连固定已校验 DNS，系统代理需单独授权。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extensions::{ExtensionManifest, ExtensionPermission},
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    sync::{
        Arc, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri_plugin_http::reqwest::{
    self,
    header::{HeaderMap, HeaderName, HeaderValue},
};

pub const HTTP_BODY_LIMIT: usize = 1024 * 1024;
pub const HTTP_RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
pub const HTTP_URL_LIMIT: usize = 4096;
pub const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const IMAGE_RESPONSE_LIMIT: usize = 16 * 1024 * 1024;
const IMAGE_TIMEOUT: Duration = Duration::from_secs(20);
const HEADER_LIMIT: usize = 16 * 1024;
const HEADER_COUNT: usize = 32;
const MAX_DNS_WORKERS: usize = 4;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionNetworkMode {
    #[default]
    Direct,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionHttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
    #[serde(default)]
    pub network_mode: ExtensionNetworkMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionHttpResponse {
    pub url: String,
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

pub(crate) struct ValidatedRequest {
    pub url: url::Url,
    pub origin: String,
    method: reqwest::Method,
    headers: HeaderMap,
    local: bool,
    network_mode: ExtensionNetworkMode,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn failed(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionRunFailed, message)
}
fn timeout_error() -> NativeError {
    NativeError::new(
        ErrorCode::ExtensionTimeout,
        "Extension HTTP request exceeded its time limit",
    )
}
fn transport_error(error: reqwest::Error, message: &str) -> NativeError {
    if error.is_timeout() {
        timeout_error()
    } else {
        failed(message)
    }
}
pub(crate) fn check_cancelled(stop: &AtomicBool) -> NativeResult<()> {
    if stop.load(Ordering::Acquire) {
        Err(NativeError::new(
            ErrorCode::UserCancelled,
            "Extension request was stopped",
        ))
    } else {
        Ok(())
    }
}
fn check_active(stop: &AtomicBool, deadline: Instant) -> NativeResult<()> {
    check_cancelled(stop)?;
    if Instant::now() >= deadline {
        Err(timeout_error())
    } else {
        Ok(())
    }
}

/// 只接受普通公网单播；拒绝兼容/映射地址、隧道和 IANA 特殊用途网段。
pub(crate) fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !matches!(a, 0 | 10 | 127 | 224..=255)
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 169 && b == 254)
                && !(a == 172 && (16..=31).contains(&b))
                && !(a == 192
                    && ((b == 0 && matches!(c, 0 | 2)) || (b == 88 && c == 99) || b == 168))
                && !(a == 198 && (matches!(b, 18 | 19) || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            (segments[0] & 0xe000) == 0x2000
                && segments[0] != 0x2002
                && !(segments[0] == 0x2001
                    && (segments[1] == 0
                        || (segments[1] == 2 && segments[2] == 0)
                        || segments[1] == 0x0db8
                        || (segments[1] & 0xfff0) == 0x10
                        || (segments[1] & 0xfff0) == 0x20))
                && !(segments[0] == 0x3fff && (segments[1] & 0xf000) == 0)
        }
    }
}

pub(crate) fn approved_public_url(source: &str) -> NativeResult<url::Url> {
    if source.len() > HTTP_URL_LIMIT || source.chars().any(char::is_control) {
        return Err(invalid("Invalid extension image URL"));
    }
    let authority = source
        .get(8..)
        .filter(|_| {
            source
                .get(..8)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
        })
        .and_then(|rest| rest.split(['/', '\\', '?', '#']).next())
        .filter(|authority| !authority.is_empty() && !authority.contains('@'));
    if authority.is_none() {
        return Err(invalid(
            "Extension images require credential-free HTTPS URLs",
        ));
    }
    let url = url::Url::parse(source).map_err(|_| invalid("Invalid extension image URL"))?;
    if url.scheme() != "https"
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid(
            "Extension images require credential-free HTTPS on port 443",
        ));
    }
    // IP 字面量会绕过连接的 DNS resolver，图片资源统一使用受检查的公网域名。
    let Some(url::Host::Domain(host)) = url.host() else {
        return Err(invalid("Extension images require a public DNS name"));
    };
    if !public_hostname(host) {
        return Err(invalid("Extension images require a public DNS name"));
    }
    Ok(url)
}

fn public_hostname(host: &str) -> bool {
    let labels = host.split('.').collect::<Vec<_>>();
    if host.len() > 253
        || labels.len() < 2
        || labels.iter().any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        || labels
            .last()
            .is_some_and(|label| label.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return false;
    }
    ![
        "localhost",
        "local",
        "internal",
        "intranet",
        "lan",
        "home",
        "corp",
        "onion",
        "test",
        "invalid",
        "example",
        "arpa",
        "alt",
        "localdomain",
    ]
    .iter()
    .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        && !["example.com", "example.net", "example.org"]
            .iter()
            .any(|name| host == *name || host.ends_with(&format!(".{name}")))
}

fn permitted_header(name: &str) -> bool {
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

pub(crate) fn validate_request(
    manifest: &ExtensionManifest,
    grants: &[ExtensionPermission],
    request: &ExtensionHttpRequest,
) -> NativeResult<ValidatedRequest> {
    bounded_text(&request.url, HTTP_URL_LIMIT, "Extension URL")?;
    let url = url::Url::parse(&request.url).map_err(|_| invalid("Invalid extension HTTP URL"))?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(invalid(
            "Extension URLs cannot contain credentials or fragments",
        ));
    }
    let origin = url.origin().ascii_serialization();
    let rule = manifest
        .network
        .iter()
        .find(|rule| rule.origin == origin)
        .ok_or_else(|| invalid("The extension did not declare this exact network origin"))?;
    let local = rule.validate()?;
    let permission = if local {
        ExtensionPermission::NetworkLocal
    } else {
        ExtensionPermission::NetworkHttps
    };
    if !manifest.has_permission(permission) || !grants.contains(&permission) {
        return Err(invalid("Network access to this origin was not granted"));
    }
    if request.network_mode == ExtensionNetworkMode::System {
        if local {
            return Err(invalid("Loopback HTTP requests cannot use a system proxy"));
        }
        let permission = ExtensionPermission::NetworkSystemProxy;
        if !manifest.has_permission(permission) || !grants.contains(&permission) {
            return Err(invalid("System proxy access was not granted"));
        }
    }
    if !rule.methods.contains(&request.method) {
        return Err(invalid("The extension did not declare this HTTP method"));
    }
    let method = match request.method.as_str() {
        "GET" => reqwest::Method::GET,
        "HEAD" => reqwest::Method::HEAD,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return Err(invalid("Unsupported extension HTTP method")),
    };
    if request
        .body
        .as_ref()
        .is_some_and(|body| body.len() > HTTP_BODY_LIMIT)
    {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Extension request body exceeds 1 MiB",
        ));
    }
    if matches!(method, reqwest::Method::GET | reqwest::Method::HEAD) && request.body.is_some() {
        return Err(invalid("GET and HEAD requests cannot contain a body"));
    }
    if request.headers.len() > HEADER_COUNT
        || request
            .headers
            .iter()
            .map(|(name, value)| name.len() + value.len())
            .sum::<usize>()
            > HEADER_LIMIT
    {
        return Err(invalid("Extension HTTP headers exceed the supported size"));
    }
    let mut headers = HeaderMap::new();
    for (name, value) in &request.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| invalid("Invalid extension HTTP header"))?;
        if !permitted_header(name.as_str()) || headers.contains_key(&name) {
            return Err(invalid("Extension HTTP header is restricted or duplicated"));
        }
        let value = HeaderValue::from_str(value)
            .map_err(|_| invalid("Invalid extension HTTP header value"))?;
        headers.insert(name, value);
    }
    Ok(ValidatedRequest {
        url,
        origin,
        method,
        headers,
        local,
        network_mode: request.network_mode,
    })
}

fn validate_addresses(addresses: &[SocketAddr], local: bool) -> NativeResult<()> {
    if addresses.is_empty()
        || addresses.len() > 32
        || addresses.iter().any(|address| {
            if local {
                !address.ip().is_loopback()
            } else {
                !is_public_ip(address.ip())
            }
        })
    {
        return Err(invalid(
            "Extension destination must resolve entirely to approved network addresses",
        ));
    }
    Ok(())
}

async fn resolve(url: &url::Url, local: bool) -> NativeResult<Vec<SocketAddr>> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| invalid("Invalid network port"))?;
    let addresses = match url.host().ok_or_else(|| invalid("Missing network host"))? {
        url::Host::Ipv4(ip) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        url::Host::Ipv6(ip) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        url::Host::Domain(host) => lookup_addresses(host.to_owned(), port).await?,
    };
    validate_addresses(&addresses, local)?;
    Ok(addresses)
}

async fn lookup_addresses(host: String, port: u16) -> NativeResult<Vec<SocketAddr>> {
    static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let workers = WORKERS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(MAX_DNS_WORKERS)))
        .clone();
    blocking_dns(workers, move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| {
                addresses
                    .take(33)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect::<Vec<_>>()
            })
            .map_err(|_| failed("Extension network name resolution failed"))
    })
    .await
}

fn validate_resolution(
    host: &str,
    target_host: &str,
    addresses: &[SocketAddr],
) -> NativeResult<()> {
    if host.eq_ignore_ascii_case(target_host) {
        validate_addresses(addresses, false)
    } else if !addresses.is_empty() && addresses.len() <= 32 {
        // 每个 client 只服务一个已校验 URL 且禁止重定向；其他域名仅可能是系统选定的代理。
        // CONNECT 的远端 DNS 由代理完成，宿主不能据此断言最终目标 IP。
        Ok(())
    } else {
        Err(invalid("Invalid system proxy network addresses"))
    }
}

#[derive(Clone)]
struct SystemResolver {
    target_host: String,
    target_addresses: Arc<tokio::sync::OnceCell<Vec<SocketAddr>>>,
}

impl reqwest::dns::Resolve for SystemResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        let resolver = self.clone();
        Box::pin(async move {
            let resolved = async {
                if host.eq_ignore_ascii_case(&resolver.target_host) {
                    resolver
                        .target_addresses
                        .get_or_try_init(|| async {
                            let addresses = lookup_addresses(host.clone(), 0).await?;
                            validate_resolution(&host, &resolver.target_host, &addresses)?;
                            Ok(addresses)
                        })
                        .await
                        .cloned()
                } else {
                    let addresses = lookup_addresses(host.clone(), 0).await?;
                    validate_resolution(&host, &resolver.target_host, &addresses)?;
                    Ok(addresses)
                }
            }
            .await
            .map_err(|error: NativeError| {
                Box::new(error) as Box<dyn std::error::Error + Send + Sync>
            })?;
            Ok(Box::new(resolved.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

async fn transport(
    url: &url::Url,
    local: bool,
    mode: ExtensionNetworkMode,
    timeout: Duration,
) -> NativeResult<reqwest::Client> {
    let host = url
        .host_str()
        .ok_or_else(|| invalid("Missing network host"))?;
    let mut builder = reqwest::Client::builder()
        .https_only(!local)
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(5));
    match mode {
        ExtensionNetworkMode::Direct => {
            let addresses = resolve(url, local).await?;
            builder = builder.no_proxy().resolve_to_addrs(host, &addresses);
        }
        ExtensionNetworkMode::System => {
            if local {
                return Err(invalid("Loopback HTTP requests cannot use a system proxy"));
            }
            builder = builder.dns_resolver(Arc::new(SystemResolver {
                target_host: host.to_owned(),
                target_addresses: Arc::new(tokio::sync::OnceCell::new()),
            }));
        }
    }
    builder
        .build()
        .map_err(|_| failed("Cannot prepare extension HTTP transport"))
}

async fn blocking_dns<T: Send + 'static>(
    workers: Arc<tokio::sync::Semaphore>,
    lookup: impl FnOnce() -> NativeResult<T> + Send + 'static,
) -> NativeResult<T> {
    let permit = workers
        .acquire_owned()
        .await
        .map_err(|_| failed("Extension network resolver is unavailable"))?;
    blocking::run(move || {
        // 取消等待不能停止 OS DNS；容量随真实线程保留，避免反复取消积累阻塞任务。
        let _permit = permit;
        lookup()
    })
    .await
}

pub(crate) async fn cancellable<T>(
    stop: &AtomicBool,
    deadline: Instant,
    future: impl Future<Output = NativeResult<T>>,
) -> NativeResult<T> {
    let mut future = std::pin::pin!(future);
    loop {
        check_cancelled(stop)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(timeout_error());
        }
        match tokio::time::timeout(remaining.min(Duration::from_millis(25)), &mut future).await {
            Ok(result) => {
                check_cancelled(stop)?;
                if Instant::now() >= deadline {
                    return Err(timeout_error());
                }
                return result;
            }
            Err(_) => continue,
        }
    }
}

async fn response_bytes(
    response: &mut reqwest::Response,
    limit: usize,
    overflow_message: &str,
) -> NativeResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(NativeError::new(ErrorCode::InputTooLong, overflow_message));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(error, "Extension HTTP response could not be read"))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(NativeError::new(ErrorCode::InputTooLong, overflow_message));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// 固定公网图片下载；来源与传输边界归此模块，解码和资源租约由调用服务维护。
pub(crate) async fn fetch_public_image(
    source: &str,
    mode: ExtensionNetworkMode,
) -> NativeResult<(Vec<u8>, String)> {
    let url = approved_public_url(source)?;
    let stop = AtomicBool::new(false);
    cancellable(&stop, Instant::now() + IMAGE_TIMEOUT, async move {
        let client = transport(&url, false, mode, IMAGE_TIMEOUT).await?;
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|error| transport_error(error, "Extension image connection failed"))?;
        image_response(response).await
    })
    .await
}

async fn image_response(mut response: reqwest::Response) -> NativeResult<(Vec<u8>, String)> {
    if !response.status().is_success() {
        return Err(failed(
            "Extension image source did not return a successful direct response",
        ));
    }
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") {
        return Err(invalid(
            "Extension images require JPEG, PNG or WebP MIME types",
        ));
    }
    let bytes = response_bytes(
        &mut response,
        IMAGE_RESPONSE_LIMIT,
        "Extension image exceeds 16 MiB",
    )
    .await?;
    Ok((bytes, mime))
}

pub(crate) async fn fetch(
    validated: ValidatedRequest,
    body: Option<String>,
    credential: Option<String>,
    stop: Arc<AtomicBool>,
    deadline: Instant,
) -> NativeResult<ExtensionHttpResponse> {
    let cancellation = stop.clone();
    cancellable(&stop, deadline, async move {
        let client = transport(
            &validated.url,
            validated.local,
            validated.network_mode,
            HTTP_TIMEOUT,
        )
        .await?;
        let mut request = client
            .request(validated.method, validated.url.clone())
            .headers(validated.headers);
        if let Some(credential) = credential {
            request = request.bearer_auth(credential);
        }
        if let Some(body) = body {
            request = request.body(body);
        }
        // DNS/凭据等待期间取消后，不再开始有外部副作用的请求。
        check_active(&cancellation, deadline)?;
        let mut response = request
            .send()
            .await
            .map_err(|error| transport_error(error, "Extension HTTP connection failed"))?;
        if response.status().is_redirection() {
            return Err(failed(
                "Extension HTTP redirects require a separate request to a declared origin",
            ));
        }
        let status = response.status().as_u16();
        let headers = [
            "content-type",
            "etag",
            "last-modified",
            "cache-control",
            "retry-after",
            "x-ratelimit-limit",
            "x-ratelimit-remaining",
            "x-ratelimit-reset",
        ]
        .into_iter()
        .filter_map(|name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .filter(|value| value.len() <= HEADER_LIMIT)
                .map(|value| (name.to_owned(), value.to_owned()))
        })
        .collect();
        let bytes = response_bytes(
            &mut response,
            HTTP_RESPONSE_LIMIT,
            "Extension HTTP response exceeds 2 MiB",
        )
        .await?;
        let body = String::from_utf8(bytes)
            .map_err(|_| failed("Extension HTTP response must be UTF-8 text"))?;
        Ok(ExtensionHttpResponse {
            url: validated.url.into(),
            status,
            headers,
            body,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(origin: &str, local: bool) -> ExtensionManifest {
        serde_json::from_value(serde_json::json!({"formatVersion":3,"apiVersion":2,"minHostVersion":"0.1.4",
            "id":"tests.network","version":"1.0.0","name":"Network test","author":"Tests","description":"Network broker test",
            "commands":[{"id":"main","title":"Main","function":"main","inputFormat":"json","resultFormat":"view","permissions":[]}],
            "permissions":[],"optionalPermissions":[if local { "network:local" } else { "network:https" }],
            "network":[{"origin":origin,"methods":["GET","POST"]}]
        })).unwrap()
    }

    fn request(url: &str) -> ExtensionHttpRequest {
        ExtensionHttpRequest {
            url: url.to_owned(),
            method: "GET".to_owned(),
            headers: BTreeMap::new(),
            body: None,
            credential: None,
            network_mode: ExtensionNetworkMode::Direct,
        }
    }

    #[test]
    fn network_modes_default_to_direct_and_system_requires_its_own_grant() {
        let parsed: ExtensionHttpRequest = serde_json::from_value(serde_json::json!({
            "url":"https://example.com/items", "method":"GET"
        }))
        .unwrap();
        assert_eq!(parsed.network_mode, ExtensionNetworkMode::Direct);
        for addition in [
            serde_json::json!({"networkMode":"insecure"}),
            serde_json::json!({"proxyUrl":"http://127.0.0.1:8000"}),
            serde_json::json!({"dangerAcceptInvalidCerts":true}),
        ] {
            let mut value = serde_json::to_value(&parsed).unwrap();
            value
                .as_object_mut()
                .unwrap()
                .extend(addition.as_object().unwrap().clone());
            assert!(serde_json::from_value::<ExtensionHttpRequest>(value).is_err());
        }
        let mut request = parsed;
        request.network_mode = ExtensionNetworkMode::System;
        let mut public = manifest("https://example.com", false);
        let grants = [
            ExtensionPermission::NetworkHttps,
            ExtensionPermission::NetworkSystemProxy,
        ];
        assert!(validate_request(&public, &grants, &request).is_err());
        public
            .optional_permissions
            .push(ExtensionPermission::NetworkSystemProxy);
        assert!(validate_request(&public, &[ExtensionPermission::NetworkHttps], &request).is_err());
        assert!(
            validate_request(
                &public,
                &[ExtensionPermission::NetworkSystemProxy],
                &request
            )
            .is_err()
        );
        assert_eq!(
            validate_request(&public, &grants, &request)
                .unwrap()
                .network_mode,
            ExtensionNetworkMode::System
        );
        let mut local = manifest("http://127.0.0.1:8000", true);
        local
            .optional_permissions
            .push(ExtensionPermission::NetworkSystemProxy);
        request.url = "http://127.0.0.1:8000/items".into();
        assert!(
            validate_request(
                &local,
                &[
                    ExtensionPermission::NetworkLocal,
                    ExtensionPermission::NetworkSystemProxy
                ],
                &request,
            )
            .is_err()
        );
    }

    #[test]
    fn image_urls_require_public_https_names_and_do_not_accept_transport_options() {
        for source in [
            "https://images.wikimedia.org/photo@2x.png?size=2",
            "https://images.wikimedia.org:443/photo.png",
            "HTTPS://images.wikimedia.org/photo.png",
        ] {
            assert!(approved_public_url(source).is_ok(), "{source}");
        }
        for source in [
            "http://images.wikimedia.org/photo.png",
            "https://images.wikimedia.org:444/photo.png",
            "https://user:password@images.wikimedia.org/photo.png",
            "https://@images.wikimedia.org/photo.png",
            "https:////@images.wikimedia.org/photo.png",
            "https://images.wikimedia.org/photo.png#fragment",
            "https://127.0.0.1/photo.png",
            "https://8.8.8.8/photo.png",
            "https://[2606:4700:4700::1111]/photo.png",
            "https://localhost/photo.png",
            "https://pictures.local/photo.png",
            "https://pictures.internal/photo.png",
            "https://example.com/photo.png",
            "https://sub.example.org/photo.png",
            "https://pictures.invalid/photo.png",
            "https://pictures.test/photo.png",
            "https://pictures.onion/photo.png",
            "https://images.wikimedia.org./photo.png",
            "https://images.wikimedia.org/line\nfeed.png",
            " https://images.wikimedia.org/photo.png",
        ] {
            assert!(approved_public_url(source).is_err(), "{source}");
        }
        assert!(
            approved_public_url(&format!(
                "https://images.wikimedia.org/{}",
                "x".repeat(HTTP_URL_LIMIT)
            ))
            .is_err()
        );
    }

    #[test]
    fn system_resolver_checks_the_target_but_allows_system_proxy_transport_hosts() {
        let target = "images.wikimedia.org";
        for addresses in [
            vec!["198.19.2.163:0".parse().unwrap()],
            vec!["127.0.0.1:0".parse().unwrap()],
            vec!["8.8.8.8:0".parse().unwrap(), "127.0.0.1:0".parse().unwrap()],
        ] {
            assert!(validate_resolution(target, target, &addresses).is_err());
            assert!(validate_addresses(&addresses, false).is_err());
        }
        assert!(
            validate_resolution(
                "IMAGES.WIKIMEDIA.ORG",
                target,
                &["8.8.8.8:0".parse().unwrap()]
            )
            .is_ok()
        );
        assert!(
            validate_resolution("proxy.local", target, &["127.0.0.1:0".parse().unwrap()]).is_ok()
        );
        assert!(validate_resolution("proxy.local", target, &[]).is_err());
        assert!(
            validate_resolution(
                "proxy.local",
                target,
                &vec!["127.0.0.1:0".parse().unwrap(); 33]
            )
            .is_err()
        );
        tauri::async_runtime::block_on(async {
            use reqwest::dns::Resolve;
            let pinned = vec!["8.8.8.8:0".parse().unwrap(), "1.1.1.1:0".parse().unwrap()];
            let target_addresses = Arc::new(tokio::sync::OnceCell::new());
            target_addresses.set(pinned.clone()).unwrap();
            let resolver = SystemResolver {
                target_host: "never-resolve.invalid".into(),
                target_addresses,
            };
            for _ in 0..2 {
                let resolved = resolver
                    .resolve("never-resolve.invalid".parse().unwrap())
                    .await
                    .unwrap()
                    .collect::<Vec<_>>();
                assert_eq!(resolved, pinned);
            }
            let url = url::Url::parse("http://127.0.0.1:8000").unwrap();
            assert!(
                transport(&url, true, ExtensionNetworkMode::System, HTTP_TIMEOUT)
                    .await
                    .is_err()
            );
        });
    }

    #[test]
    fn public_addresses_exclude_internal_mapped_tunnel_and_special_ranges() {
        for address in [
            "0.1.2.3",
            "10.1.2.3",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.1.1",
            "192.168.1.1",
            "192.0.2.1",
            "192.88.99.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "::",
            "::1",
            "::ffff:8.8.8.8",
            "::ffff:127.0.0.1",
            "64:ff9b::808:808",
            "fc00::1",
            "fe80::1",
            "2001::1",
            "2001:db8::1",
            "2002:808:808::1",
            "3fff::1",
            "ff02::1",
        ] {
            assert!(!is_public_ip(address.parse().unwrap()), "{address}");
        }
        for address in [
            "8.8.8.8",
            "1.1.1.1",
            "93.184.216.34",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
        ] {
            assert!(is_public_ip(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn mixed_dns_answers_are_rejected_before_connecting() {
        let addresses = [
            "8.8.8.8:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap(),
        ];
        assert!(validate_addresses(&addresses, false).is_err());
        assert!(validate_addresses(&addresses, true).is_err());
        assert!(validate_addresses(&["[::1]:8080".parse().unwrap()], true).is_ok());
    }

    #[test]
    fn secrets_and_transport_headers_cannot_be_supplied_by_extensions() {
        for header in [
            "authorization",
            "cookie",
            "proxy-authorization",
            "proxy-connection",
            "host",
            "connection",
            "content-length",
            "transfer-encoding",
            "sec-fetch-site",
            "x-forwarded-for",
        ] {
            assert!(!permitted_header(header));
        }
        assert!(permitted_header("accept"));
        assert!(permitted_header("content-type"));
        assert!(permitted_header("x-client-version"));
    }

    #[test]
    fn requests_require_the_exact_origin_method_and_grant() {
        let manifest = manifest("https://example.com", false);
        let valid = request("https://example.com/resource?query=value");
        assert!(validate_request(&manifest, &[], &valid).is_err());
        assert!(validate_request(&manifest, &[ExtensionPermission::NetworkHttps], &valid).is_ok());
        for url in [
            "https://other.example/resource",
            "https://example.com:444/resource",
            "http://example.com/resource",
            "https://user@example.com/resource",
            "https://example.com/resource#fragment",
        ] {
            assert!(
                validate_request(
                    &manifest,
                    &[ExtensionPermission::NetworkHttps],
                    &request(url)
                )
                .is_err()
            );
        }
        let mut invalid = valid.clone();
        invalid.method = "DELETE".to_owned();
        assert!(
            validate_request(&manifest, &[ExtensionPermission::NetworkHttps], &invalid).is_err()
        );
        invalid = valid;
        invalid.headers = BTreeMap::from([
            ("Accept".to_owned(), "text/plain".to_owned()),
            ("accept".to_owned(), "application/json".to_owned()),
        ]);
        assert!(
            validate_request(&manifest, &[ExtensionPermission::NetworkHttps], &invalid).is_err()
        );
        invalid.headers = BTreeMap::from([(
            "Authorization".to_owned(),
            "Bearer inline-secret".to_owned(),
        )]);
        assert!(
            validate_request(&manifest, &[ExtensionPermission::NetworkHttps], &invalid).is_err()
        );
        invalid.headers.clear();
        invalid.method = "POST".to_owned();
        invalid.body = Some("x".repeat(HTTP_BODY_LIMIT + 1));
        assert_eq!(
            validate_request(&manifest, &[ExtensionPermission::NetworkHttps], &invalid)
                .err()
                .unwrap()
                .code,
            ErrorCode::InputTooLong
        );
    }

    #[test]
    fn local_network_is_a_separate_permission() {
        let manifest = manifest("http://127.0.0.1:8234", true);
        let request = request("http://127.0.0.1:8234/api");
        assert!(
            validate_request(&manifest, &[ExtensionPermission::NetworkHttps], &request).is_err()
        );
        assert!(
            validate_request(&manifest, &[ExtensionPermission::NetworkLocal], &request).is_ok()
        );
    }

    #[test]
    fn cancellation_and_expired_deadlines_drop_pending_transport_work() {
        tauri::async_runtime::block_on(async {
            let stop = AtomicBool::new(true);
            let pending = std::future::pending::<NativeResult<()>>();
            assert_eq!(
                cancellable(&stop, Instant::now() + HTTP_TIMEOUT, pending)
                    .await
                    .unwrap_err()
                    .code,
                ErrorCode::UserCancelled
            );
            let stop = AtomicBool::new(false);
            let pending = std::future::pending::<NativeResult<()>>();
            assert_eq!(
                cancellable(&stop, Instant::now(), pending)
                    .await
                    .unwrap_err()
                    .code,
                ErrorCode::ExtensionTimeout
            );
        });
    }

    #[test]
    fn cancelled_dns_waits_keep_capacity_until_the_blocking_resolver_exits() {
        tauri::async_runtime::block_on(async {
            let workers = Arc::new(tokio::sync::Semaphore::new(1));
            let (started, observed) = std::sync::mpsc::channel();
            let (release, pending) = std::sync::mpsc::channel();
            let pool = workers.clone();
            let task = tokio::spawn(async move {
                blocking_dns(pool, move || {
                    started.send(()).unwrap();
                    pending.recv_timeout(Duration::from_secs(5)).unwrap();
                    Ok(())
                })
                .await
            });
            observed.recv_timeout(Duration::from_secs(5)).unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
            assert_eq!(workers.available_permits(), 0);
            release.send(()).unwrap();
            let permit = tokio::time::timeout(Duration::from_secs(5), workers.acquire_owned())
                .await
                .unwrap()
                .unwrap();
            drop(permit);
        });
    }

    fn fixture(response: &'static [u8]) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let length = stream.read(&mut buffer).unwrap();
                assert_ne!(length, 0);
                bytes.extend_from_slice(&buffer[..length]);
                if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length: ")
                                .and_then(|value| value.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
                assert!(bytes.len() <= HTTP_BODY_LIMIT + HEADER_LIMIT);
            }
            stream.write_all(response).unwrap();
            String::from_utf8(bytes).unwrap()
        });
        (origin, server)
    }

    #[test]
    fn image_responses_require_success_raster_mime_and_their_own_byte_limit() {
        for (wire, expected) in [
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nContent-Type: image/PNG; charset=binary\r\nConnection: close\r\n\r\nabc".as_slice(),
                None,
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nContent-Type: image/svg+xml\r\nConnection: close\r\n\r\n".as_slice(),
                Some(ErrorCode::InvalidArgument),
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 16777217\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n".as_slice(),
                Some(ErrorCode::InputTooLong),
            ),
            (
                b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),
                Some(ErrorCode::ExtensionRunFailed),
            ),
        ] {
            let (origin, server) = fixture(wire);
            let response = tauri::async_runtime::block_on(async {
                let url = url::Url::parse(&format!("{origin}/image")).unwrap();
                let client = transport(&url, true, ExtensionNetworkMode::Direct, IMAGE_TIMEOUT)
                    .await
                    .unwrap();
                let response = client.get(url).send().await.unwrap();
                image_response(response).await
            });
            if let Some(code) = expected {
                assert_eq!(response.unwrap_err().code, code);
            } else {
                assert_eq!(response.unwrap(), (b"abc".to_vec(), "image/png".into()));
            }
            let request = server.join().unwrap().to_ascii_lowercase();
            assert!(request.starts_with("get /image http/1.1"));
            assert!(!request.contains("authorization:") && !request.contains("cookie:"));
        }
    }

    #[test]
    fn broker_sends_a_typed_post_and_returns_only_safe_response_headers() {
        let (origin, server) = fixture(b"HTTP/1.1 201 Created\r\nContent-Length: 2\r\nContent-Type: text/plain\r\nSet-Cookie: private=value\r\nConnection: close\r\n\r\nok");
        let manifest = manifest(&origin, true);
        let mut request = request(&format!("{origin}/items"));
        request.method = "POST".to_owned();
        request.body = Some("{\"name\":\"test\"}".to_owned());
        request
            .headers
            .insert("Content-Type".to_owned(), "application/json".to_owned());
        let validated =
            validate_request(&manifest, &[ExtensionPermission::NetworkLocal], &request).unwrap();
        let response = tauri::async_runtime::block_on(fetch(
            validated,
            request.body,
            Some("fixture-secret".to_owned()),
            Arc::new(AtomicBool::new(false)),
            Instant::now() + HTTP_TIMEOUT,
        ))
        .unwrap();
        assert_eq!(response.status, 201);
        assert_eq!(response.body, "ok");
        assert_eq!(response.headers.get("content-type").unwrap(), "text/plain");
        assert!(!response.headers.contains_key("set-cookie"));
        let received = server.join().unwrap().to_ascii_lowercase();
        assert!(received.starts_with("post /items http/1.1"));
        assert!(received.contains("authorization: bearer fixture-secret"));
        assert!(received.ends_with("{\"name\":\"test\"}"));
    }

    #[test]
    fn redirects_and_oversized_responses_are_rejected_without_reading_the_body() {
        for response in [
            b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),
            b"HTTP/1.1 200 OK\r\nContent-Length: 2097153\r\nConnection: close\r\n\r\n".as_slice(),
        ] {
            let (origin, server) = fixture(response);
            let manifest = manifest(&origin, true);
            let request = request(&format!("{origin}/items"));
            let validated = validate_request(&manifest, &[ExtensionPermission::NetworkLocal], &request).unwrap();
            let result = tauri::async_runtime::block_on(fetch(validated, None, None, Arc::new(AtomicBool::new(false)), Instant::now() + HTTP_TIMEOUT));
            assert!(result.is_err());
            server.join().unwrap();
        }
    }
}
