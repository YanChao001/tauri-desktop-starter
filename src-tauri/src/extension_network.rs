//! 扩展的显式来源 HTTP broker；DNS 校验结果固定到本次连接，不继承代理或 cookie。
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
const HEADER_LIMIT: usize = 16 * 1024;
const HEADER_COUNT: usize = 32;
const MAX_DNS_WORKERS: usize = 4;

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
        url::Host::Domain(host) => {
            let host = host.to_owned();
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
            .await?
        }
    };
    validate_addresses(&addresses, local)?;
    Ok(addresses)
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

pub(crate) async fn fetch(
    validated: ValidatedRequest,
    body: Option<String>,
    credential: Option<String>,
    stop: Arc<AtomicBool>,
    deadline: Instant,
) -> NativeResult<ExtensionHttpResponse> {
    let cancellation = stop.clone();
    cancellable(&stop, deadline, async move {
        let addresses = resolve(&validated.url, validated.local).await?;
        check_active(&cancellation, deadline)?;
        let host = validated
            .url
            .host_str()
            .ok_or_else(|| invalid("Missing network host"))?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .referer(false)
            .timeout(HTTP_TIMEOUT)
            .connect_timeout(Duration::from_secs(5))
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|_| failed("Cannot prepare extension HTTP transport"))?;
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
        if response
            .content_length()
            .is_some_and(|length| length > HTTP_RESPONSE_LIMIT as u64)
        {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Extension HTTP response exceeds 2 MiB",
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
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| transport_error(error, "Extension HTTP response could not be read"))?
        {
            if bytes.len() + chunk.len() > HTTP_RESPONSE_LIMIT {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Extension HTTP response exceeds 2 MiB",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
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
        }
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
