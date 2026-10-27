//! 宿主 HTTP 演示的有界请求、响应与按窗口隔离的取消状态。

use crate::{
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    network::{self, NetworkMode},
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::{BTreeMap, HashMap},
    future::{Future, poll_fn},
    sync::Mutex,
    task::Poll,
    time::Duration,
};
use tauri::ipc::Channel;
use tauri_plugin_http::reqwest::{
    self,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use tokio::sync::oneshot;

const MAX_ACTIVE_REQUESTS: usize = 16;
const BODY_LIMIT: usize = 65536;
const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const HEADER_LIMIT: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
pub enum HttpDemoMethod {
    #[serde(rename = "GET")]
    Get,
    #[serde(rename = "POST")]
    Post,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpDemoRequest {
    pub url: String,
    pub method: HttpDemoMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub headers: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpDemoResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub body: String,
}

type RequestKey = (String, String);
type ActiveRequests = HashMap<RequestKey, Option<oneshot::Sender<()>>>;

#[derive(Default)]
pub struct DemoHttpState {
    active: Mutex<ActiveRequests>,
}

struct RequestGuard<'a> {
    state: &'a DemoHttpState,
    key: RequestKey,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.active.lock() {
            active.remove(&self.key);
        }
    }
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn cancelled() -> NativeError {
    NativeError::new(ErrorCode::UserCancelled, "HTTP demo request was cancelled")
}

fn timeout_error() -> NativeError {
    NativeError {
        code: ErrorCode::HttpTimeout,
        message: "HTTP demo request timed out; retry the request".to_owned(),
        retryable: true,
    }
}

fn transport_error(error: reqwest::Error, message: &str) -> NativeError {
    if error.is_timeout() {
        timeout_error()
    } else {
        NativeError::operation(ErrorCode::Internal, message, error)
    }
}

impl DemoHttpState {
    fn register(
        &self,
        owner: &str,
        request_id: String,
    ) -> NativeResult<(RequestGuard<'_>, oneshot::Receiver<()>)> {
        bounded_text(&request_id, 128, "HTTP demo request ID")?;
        if request_id.is_empty() {
            return Err(invalid("HTTP demo request ID is required"));
        }
        let key = (owner.to_owned(), request_id);
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "HTTP demo state is unavailable"))?;
        if active.contains_key(&key) {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "HTTP demo request ID is already active",
            ));
        }
        if active.len() >= MAX_ACTIVE_REQUESTS {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "HTTP demo request limit was reached; wait for an active request to finish",
            ));
        }
        let (sender, receiver) = oneshot::channel();
        active.insert(key.clone(), Some(sender));
        Ok((RequestGuard { state: self, key }, receiver))
    }

    pub fn cancel(&self, owner: &str, request_id: &str) -> NativeResult<()> {
        bounded_text(request_id, 128, "HTTP demo request ID")?;
        let mut active = self
            .active
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "HTTP demo state is unavailable"))?;
        // 保留表项直到请求 future 退出，取消不能提前释放容量或复用相同 ID。
        if let Some(sender) = active
            .get_mut(&(owner.to_owned(), request_id.to_owned()))
            .and_then(Option::take)
        {
            let _ = sender.send(());
        }
        Ok(())
    }

    pub fn cancel_window(&self, owner: &str) {
        if let Ok(mut active) = self.active.lock() {
            for ((label, _), sender) in active.iter_mut() {
                if label == owner
                    && let Some(sender) = sender.take()
                {
                    let _ = sender.send(());
                }
            }
        }
    }

    pub async fn request(
        &self,
        owner: &str,
        request_id: String,
        input: HttpDemoRequest,
        mode: NetworkMode,
        on_started: Channel<()>,
    ) -> NativeResult<HttpDemoResponse> {
        let validated = validate(input)?;
        let (_guard, cancellation) = self.register(owner, request_id)?;
        // ACK 后前端才发送取消，避免异步 IPC 调度造成先取消、后注册的竞态。
        on_started.send(()).map_err(|_| cancelled())?;
        match tokio::time::timeout(
            validated.timeout,
            cancellable(cancellation, fetch(validated, mode)),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(timeout_error()),
        }
    }
}

struct ValidatedRequest {
    url: url::Url,
    method: reqwest::Method,
    headers: HeaderMap,
    body: Option<String>,
    timeout: Duration,
}

fn validate(input: HttpDemoRequest) -> NativeResult<ValidatedRequest> {
    bounded_text(&input.url, 4096, "HTTP demo URL")?;
    let url = url::Url::parse(&input.url).map_err(|_| invalid("Invalid HTTP demo URL"))?;
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("httpbin.org" | "jsonplaceholder.typicode.com")
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(invalid("Choose one of the allowed HTTPS demo endpoints"));
    }
    if input
        .body
        .as_ref()
        .is_some_and(|body| body.len() > BODY_LIMIT)
    {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "HTTP demo request body exceeds 64 KiB",
        ));
    }
    let source_headers = input.headers.unwrap_or_default();
    if source_headers.len() > 32
        || source_headers
            .iter()
            .map(|(name, value)| name.len() + value.len())
            .sum::<usize>()
            > HEADER_LIMIT
    {
        return Err(invalid("HTTP demo headers exceed the supported size"));
    }
    let mut headers = HeaderMap::new();
    for (name, value) in source_headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| invalid("Invalid HTTP demo header name"))?;
        if !network::permitted_header(name.as_str()) || headers.contains_key(&name) {
            return Err(invalid("HTTP demo header is restricted or duplicated"));
        }
        let value =
            HeaderValue::from_str(&value).map_err(|_| invalid("Invalid HTTP demo header value"))?;
        headers.insert(name, value);
    }
    let method = match input.method {
        HttpDemoMethod::Get => reqwest::Method::GET,
        HttpDemoMethod::Post => reqwest::Method::POST,
    };
    Ok(ValidatedRequest {
        url,
        body: (method == reqwest::Method::POST)
            .then_some(input.body)
            .flatten(),
        method,
        headers,
        timeout: Duration::from_millis(u64::from(
            input.timeout_ms.unwrap_or(10000).clamp(100, 30000),
        )),
    })
}

async fn cancellable<T>(
    cancellation: oneshot::Receiver<()>,
    future: impl Future<Output = NativeResult<T>>,
) -> NativeResult<T> {
    let mut cancellation = std::pin::pin!(cancellation);
    let mut future = std::pin::pin!(future);
    poll_fn(|context| {
        if cancellation.as_mut().poll(context).is_ready() {
            Poll::Ready(Err(cancelled()))
        } else {
            future.as_mut().poll(context)
        }
    })
    .await
}

async fn fetch(input: ValidatedRequest, mode: NetworkMode) -> NativeResult<HttpDemoResponse> {
    let client = network::configure_client(
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(input.timeout)
            .referer(false),
        mode,
    )
    .build()
    .map_err(|_| NativeError::new(ErrorCode::Internal, "Cannot prepare HTTP demo transport"))?;
    let mut request = client
        .request(input.method, input.url)
        .headers(input.headers);
    if let Some(body) = input.body {
        request = request.body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| transport_error(error, "HTTP demo connection failed"))?;
    if response.status().is_redirection() {
        return Err(invalid("HTTP demo redirects are not allowed"));
    }
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| !matches!(name.as_str(), "set-cookie" | "set-cookie2"))
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_owned()))
        })
        .collect();
    if response
        .content_length()
        .is_some_and(|size| size > RESPONSE_LIMIT as u64)
    {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Response exceeds 2 MiB",
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(error, "HTTP demo response could not be read"))?
    {
        if body.len().saturating_add(chunk.len()) > RESPONSE_LIMIT {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Response exceeds 2 MiB",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(HttpDemoResponse {
        status,
        headers,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(url: &str) -> HttpDemoRequest {
        HttpDemoRequest {
            url: url.to_owned(),
            method: HttpDemoMethod::Get,
            headers: None,
            body: None,
            timeout_ms: None,
        }
    }

    #[test]
    fn rejects_unapproved_destinations_and_credentials() {
        for url in [
            "http://httpbin.org/",
            "https://httpbin.org.evil.test/",
            "https://user:secret@httpbin.org/",
            "https://httpbin.org:8443/",
            "file:///private.txt",
        ] {
            assert!(validate(input(url)).is_err(), "{url}");
        }
        assert!(validate(input("https://httpbin.org/anything")).is_ok());
        assert!(validate(input("https://jsonplaceholder.typicode.com/posts/1")).is_ok());
    }

    #[test]
    fn rejects_credential_headers_and_utf8_body_overflow() {
        for header in [
            "Authorization",
            "Cookie",
            "Host",
            "Proxy-Authorization",
            "Sec-Fetch-Site",
            "X-Forwarded-For",
        ] {
            let mut request = input("https://httpbin.org/anything");
            request.headers = Some(BTreeMap::from([(header.to_owned(), "secret".to_owned())]));
            assert!(validate(request).is_err(), "{header}");
        }
        let mut request = input("https://httpbin.org/anything");
        request.body = Some("界".repeat(BODY_LIMIT / 3 + 1));
        assert_eq!(
            validate(request).err().unwrap().code,
            ErrorCode::InputTooLong
        );
    }

    #[test]
    fn cancellation_is_scoped_to_owner_and_keeps_capacity_until_drop() {
        let state = DemoHttpState::default();
        let (guard, mut receiver) = state.register("main", "same-id".to_owned()).unwrap();
        state.cancel("secondary", "same-id").unwrap();
        assert!(matches!(
            receiver.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        state.cancel("main", "same-id").unwrap();
        assert!(receiver.try_recv().is_ok());
        assert!(state.register("main", "same-id".to_owned()).is_err());
        drop(guard);
        assert!(state.register("main", "same-id".to_owned()).is_ok());
    }

    #[test]
    fn limits_live_requests_and_window_close_cancels_only_its_owner() {
        let state = DemoHttpState::default();
        let mut live = (0..MAX_ACTIVE_REQUESTS)
            .map(|index| {
                state
                    .register(
                        if index == 0 { "secondary" } else { "main" },
                        index.to_string(),
                    )
                    .unwrap()
            })
            .collect::<Vec<_>>();
        assert!(state.register("main", "overflow".to_owned()).is_err());
        state.cancel_window("main");
        assert!(matches!(
            live[0].1.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        assert!(live[1].1.try_recv().is_ok());
        assert!(state.register("main", "overflow".to_owned()).is_err());
        live.pop();
        assert!(state.register("main", "overflow".to_owned()).is_ok());
    }

    #[test]
    fn cancellation_drops_the_pending_operation() {
        struct Pending {
            started: std::sync::Arc<std::sync::atomic::AtomicBool>,
            dropped: std::sync::Arc<std::sync::atomic::AtomicBool>,
            cancel: Option<oneshot::Sender<()>>,
        }
        impl Future for Pending {
            type Output = NativeResult<()>;
            fn poll(
                mut self: std::pin::Pin<&mut Self>,
                _: &mut std::task::Context<'_>,
            ) -> Poll<Self::Output> {
                self.started
                    .store(true, std::sync::atomic::Ordering::Release);
                if let Some(cancel) = self.cancel.take() {
                    let _ = cancel.send(());
                }
                Poll::Pending
            }
        }
        impl Drop for Pending {
            fn drop(&mut self) {
                self.dropped
                    .store(true, std::sync::atomic::Ordering::Release);
            }
        }
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let started = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (sender, receiver) = oneshot::channel();
        let result = tauri::async_runtime::block_on(cancellable(
            receiver,
            Pending {
                started: started.clone(),
                dropped: dropped.clone(),
                cancel: Some(sender),
            },
        ));
        assert_eq!(result.unwrap_err().code, ErrorCode::UserCancelled);
        assert!(started.load(std::sync::atomic::Ordering::Acquire));
        assert!(dropped.load(std::sync::atomic::Ordering::Acquire));
    }
}
