//! 内网通信 broker：有界 TCP、显式附件选取与私有历史，不提供任意路径或执行能力。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_services::ServicePermit,
    storage::atomic_write,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    fs::{self, Metadata},
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream, UdpSocket},
    path::{Component, Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[path = "extension_lan_attachment.rs"]
mod attachment_io;
use attachment_io::{AttachmentCache, CachedAttachment};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

const DEFAULT_PORT: u16 = 45873;
const MAX_TEXT: usize = 8 * 1024;
// JSON 字符串最坏按每个正文字节转义为 6 字节，并为固定协议字段保留开销。
const MAX_FRAME: usize = MAX_TEXT * 6 + 1024;
const MAX_HISTORY: usize = 500;
const MAX_CONTACTS: usize = 64;
const MAX_CONNECTIONS: usize = 16;
const MAX_WORKERS: usize = 24;
const MAX_INSTANCES: usize = 16;
const MAX_DISK: usize = 1024 * 1024;
const MAX_IMAGE_ATTACHMENT: usize = 8 * 1024 * 1024;
const MAX_FILE_ATTACHMENT: usize = 1024 * 1024 * 1024;
const MAX_ATTACHMENTS_DISK: u64 = 2 * 1024 * 1024 * 1024;
#[cfg(test)]
const ATTACHMENT_TIMEOUT: Duration = Duration::from_secs(20);
static ATTACHMENT_SENDERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
const FRAME_TIMEOUT: Duration = Duration::from_secs(3);

#[cfg(test)]
fn binary_receiver_test_guard() -> std::sync::MutexGuard<'static, ()> {
    // 各 fixture 内仍保留真实双向并发；不同 fixture 不竞争进程级四个接收名额。
    static RECEIVER_FIXTURES: Mutex<()> = Mutex::new(());
    RECEIVER_FIXTURES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn unavailable(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionUnavailable, message)
}
fn io_error(message: &str) -> NativeError {
    NativeError::new(ErrorCode::StorageIo, message)
}
fn transport(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionRunFailed, message)
}
fn check_permit(permit: Option<&ServicePermit>) -> NativeResult<()> {
    permit.map_or(Ok(()), ServicePermit::check)
}
fn commit_permit<T>(
    permit: Option<&ServicePermit>,
    operation: impl FnOnce() -> NativeResult<T>,
) -> NativeResult<T> {
    match permit {
        Some(permit) => permit.commit(operation),
        None => operation(),
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |v| v.as_millis() as u64)
}
fn token() -> NativeResult<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| unavailable("Cannot create LAN session identity"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_token(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn nickname(value: &str) -> NativeResult<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 120
        || value.chars().count() > 40
        || value.chars().any(char::is_control)
    {
        return Err(invalid("Nickname must contain 1 to 40 visible characters"));
    }
    Ok(value.into())
}
fn text(value: &str) -> NativeResult<()> {
    if value.trim().is_empty()
        || value.len() > MAX_TEXT
        || value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(invalid(
            "Chat text must contain 1 to 8192 UTF-8 bytes without control characters",
        ));
    }
    Ok(())
}
fn local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
    }
}
fn default_address() -> Ipv4Addr {
    // UDP connect 仅查询本机路由，不发送数据、解析 DNS 或探测外部服务。
    UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .ok()
        .and_then(|socket| {
            socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
            socket.local_addr().ok()
        })
        .and_then(|address| match address.ip() {
            IpAddr::V4(ip) if local_ip(ip.into()) => Some(ip),
            _ => None,
        })
        .unwrap_or(Ipv4Addr::LOCALHOST)
}
fn linked(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.is_symlink()
    }
}
fn checked_root(root: &Path) -> NativeResult<()> {
    if !root.is_absolute() || root.components().any(|p| matches!(p, Component::ParentDir)) {
        return Err(invalid(
            "LAN storage requires an absolute application directory",
        ));
    }
    for parent in root.ancestors().collect::<Vec<_>>().into_iter().rev() {
        match fs::symlink_metadata(parent) {
            Ok(metadata) if metadata.is_dir() && !linked(&metadata) => {}
            Ok(_) => return Err(invalid("LAN storage refuses directory links")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(parent)
                    .map_err(|_| io_error("Cannot create LAN history directory"))?;
                let metadata = fs::symlink_metadata(parent)
                    .map_err(|_| io_error("Cannot inspect LAN history directory"))?;
                if !metadata.is_dir() || linked(&metadata) {
                    return Err(invalid("LAN storage refuses directory links"));
                }
            }
            Err(_) => return Err(io_error("Cannot inspect LAN history directory")),
        }
    }
    Ok(())
}
fn checked_file(path: &Path) -> NativeResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_file() && !linked(&metadata) && metadata.len() <= MAX_DISK as u64 =>
        {
            Ok(true)
        }
        Ok(_) => Err(NativeError::new(
            ErrorCode::StorageCorrupt,
            "LAN history is oversized or is not a regular file; original data was preserved",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(io_error("Cannot inspect LAN history")),
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Contact {
    id: String,
    nickname: String,
    address: String,
    port: u16,
    last_seen: u64,
    unread: u32,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    id: String,
    peer_id: String,
    sender: String,
    nickname: String,
    text: String,
    at: u64,
    outgoing: bool,
    delivery: String,
    #[serde(default = "text_kind")]
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attachment: Option<Attachment>,
}
fn text_kind() -> String {
    "text".into()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Attachment {
    name: String,
    mime: String,
    bytes: usize,
    sha256: String,
}
fn attachment_name(value: &str) -> NativeResult<String> {
    let value = value.trim();
    let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if value.is_empty()
        || value.len() > 240
        || value.ends_with(['.', ' '])
        || value
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err(invalid("Attachment filename is invalid"));
    }
    Ok(value.into())
}
impl Attachment {
    fn validate(&self, kind: &str) -> NativeResult<()> {
        attachment_name(&self.name)?;
        let limit = if kind == "image" {
            MAX_IMAGE_ATTACHMENT
        } else {
            MAX_FILE_ATTACHMENT
        };
        if self.bytes == 0 || self.bytes > limit {
            return Err(attachment_io::too_large(kind));
        }
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || !matches!(
                (kind, self.mime.as_str()),
                ("file", "application/octet-stream")
                    | ("image", "image/png" | "image/jpeg" | "image/webp")
            )
        {
            return Err(invalid("Attachment metadata exceeds the supported limits"));
        }
        Ok(())
    }
}
#[cfg(test)]
fn validate_attachment_bytes(
    attachment: &Attachment,
    kind: &str,
    bytes: &[u8],
) -> NativeResult<()> {
    attachment.validate(kind)?;
    if bytes.len() != attachment.bytes
        || format!("{:x}", Sha256::digest(bytes)) != attachment.sha256
    {
        return Err(invalid("LAN attachment checksum or length is invalid"));
    }
    if kind == "image" {
        crate::extension_resources::bounded_render_image(bytes, &attachment.mime, true)?;
    }
    Ok(())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    schema_version: u32,
    extension_id: String,
    node_id: String,
    nickname: String,
    contacts: BTreeMap<String, Contact>,
    messages: VecDeque<Message>,
}
impl Document {
    fn fresh(id: &str) -> NativeResult<Self> {
        Ok(Self {
            schema_version: 2,
            extension_id: id.into(),
            node_id: token()?,
            nickname: "内网朋友".into(),
            contacts: BTreeMap::new(),
            messages: VecDeque::new(),
        })
    }
    fn validate(&self, id: &str) -> NativeResult<()> {
        if !matches!(self.schema_version, 1 | 2) {
            return Err(NativeError::new(
                ErrorCode::ExtensionIncompatible,
                "LAN history uses an unsupported version; original data was preserved",
            ));
        }
        let bad = || {
            NativeError::new(
                ErrorCode::StorageCorrupt,
                "LAN history is invalid; original data was preserved",
            )
        };
        if self.extension_id != id
            || !valid_token(&self.node_id)
            || nickname(&self.nickname).is_err()
            || self.contacts.len() > MAX_CONTACTS
            || self.messages.len() > MAX_HISTORY
        {
            return Err(bad());
        }
        for (id, contact) in &self.contacts {
            if id != &contact.id
                || !valid_token(id)
                || nickname(&contact.nickname).is_err()
                || contact.port == 0
                || !contact.address.parse::<IpAddr>().is_ok_and(local_ip)
                || contact.unread > MAX_HISTORY as u32
            {
                return Err(bad());
            }
        }
        let mut ids = BTreeSet::new();
        for message in &self.messages {
            if !ids.insert(&message.id)
                || !valid_token(&message.id)
                || !self.contacts.contains_key(&message.peer_id)
                || !valid_token(&message.sender)
                || nickname(&message.nickname).is_err()
                || match (&message.attachment, message.kind.as_str()) {
                    (None, "text" | "sticker") => text(&message.text).is_err(),
                    (Some(attachment), "image" | "file") => {
                        attachment.validate(&message.kind).is_err() || !message.text.is_empty()
                    }
                    _ => true,
                }
                || !matches!(
                    message.delivery.as_str(),
                    "received" | "sent" | "delivered" | "failed"
                )
            {
                return Err(bad());
            }
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Frame {
    Hello {
        version: u8,
        #[serde(rename = "nodeId")]
        node_id: String,
        nickname: String,
        port: u16,
    },
    Message {
        id: String,
        text: String,
    },
    Ack {
        id: String,
    },
    Profile {
        nickname: String,
    },
    Sticker {
        id: String,
        text: String,
    },
    Attachment {
        id: String,
        #[serde(rename = "mediaKind")]
        media_kind: String,
        attachment: Attachment,
    },
}
fn write_frame(stream: &mut TcpStream, frame: &Frame) -> NativeResult<()> {
    write_frame_permitted(stream, frame, None, Instant::now() + Duration::from_secs(2))
}
fn write_frame_permitted(
    stream: &mut TcpStream,
    frame: &Frame,
    permit: Option<&ServicePermit>,
    deadline: Instant,
) -> NativeResult<()> {
    let bytes =
        serde_json::to_vec(frame).map_err(|_| invalid("Cannot encode LAN protocol frame"))?;
    if bytes.len() > MAX_FRAME {
        return Err(invalid("LAN protocol frame exceeds its size limit"));
    }
    let mut frame = (bytes.len() as u32).to_be_bytes().to_vec();
    frame.extend_from_slice(&bytes);
    let mut offset = 0;
    let result = (|| {
        while offset < frame.len() {
            check_permit(permit)?;
            if Instant::now() >= deadline {
                return Err(transport("LAN connection exceeded its send deadline"));
            }
            // 所有 broker socket 均为 nonblocking；仅短 write syscall 持窗口锁，
            // 背压等待与重试在锁外，关闭窗口可立即撤销后续发送。
            let written = commit_permit(permit, || Ok(stream.write(&frame[offset..])))?;
            match written {
                Ok(0) => {
                    return Err(transport(
                        "LAN peer disconnected before the message was sent",
                    ));
                }
                Ok(count) => offset += count,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(_) => return Err(transport("LAN connection could not send the message")),
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = stream.shutdown(Shutdown::Both);
    }
    result
}
fn read_bytes(
    stream: &mut TcpStream,
    bytes: &mut [u8],
    stop: &AtomicBool,
    idle: bool,
) -> NativeResult<bool> {
    let deadline = Instant::now() + FRAME_TIMEOUT;
    let mut offset = 0;
    while offset < bytes.len() {
        if stop.load(Ordering::Acquire) {
            return Err(unavailable("LAN session was stopped"));
        }
        if (offset > 0 || !idle) && Instant::now() >= deadline {
            return Err(transport("LAN peer sent an incomplete frame"));
        }
        match stream.read(&mut bytes[offset..]) {
            Ok(0) => return Err(transport("LAN peer disconnected")),
            Ok(read) => offset += read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                thread::sleep(Duration::from_millis(if idle && offset == 0 {
                    20
                } else {
                    5
                }));
                if idle && offset == 0 {
                    return Ok(false);
                }
                if Instant::now() >= deadline {
                    return Err(transport("LAN peer sent an incomplete frame"));
                }
            }
            Err(_) => return Err(transport("LAN connection failed")),
        }
    }
    Ok(true)
}
fn read_frame(stream: &mut TcpStream, stop: &AtomicBool) -> NativeResult<Option<Frame>> {
    let mut length = [0; 4];
    if !read_bytes(stream, &mut length, stop, true)? {
        return Ok(None);
    }
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(invalid("LAN peer exceeded the frame size limit"));
    }
    let mut bytes = vec![0; length];
    read_bytes(stream, &mut bytes, stop, false)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| invalid("LAN peer sent an unsupported protocol frame"))
}
#[cfg(test)]
fn write_attachment_bytes(
    stream: &mut TcpStream,
    bytes: &[u8],
    permit: Option<&ServicePermit>,
    stop: &AtomicBool,
) -> NativeResult<()> {
    let deadline = Instant::now() + ATTACHMENT_TIMEOUT;
    let mut offset = 0;
    while offset < bytes.len() {
        check_permit(permit)?;
        if stop.load(Ordering::Acquire) {
            return Err(unavailable("LAN transfer was stopped"));
        }
        if Instant::now() >= deadline {
            return Err(transport("LAN attachment exceeded its send deadline"));
        }
        let end = (offset + 64 * 1024).min(bytes.len());
        match commit_permit(permit, || Ok(stream.write(&bytes[offset..end])))? {
            Ok(0) => return Err(transport("LAN attachment was interrupted")),
            Ok(count) => offset += count,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(5))
            }
            Err(_) => return Err(transport("LAN attachment could not be sent")),
        }
    }
    Ok(())
}

struct Connection {
    id: String,
    stream: Arc<Mutex<TcpStream>>,
    control: TcpStream,
    preferred: bool,
}
struct Runtime {
    stop: Arc<AtomicBool>,
    port: u16,
    address: String,
    listener: Option<JoinHandle<()>>,
    workers: Vec<JoinHandle<()>>,
    connections: BTreeMap<String, Connection>,
    pending: usize,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(true)),
            port: 0,
            address: String::new(),
            listener: None,
            workers: Vec::new(),
            connections: BTreeMap::new(),
            pending: 0,
        }
    }
}
struct Node {
    root: PathBuf,
    path: PathBuf,
    data: Mutex<Document>,
    runtime: Mutex<Runtime>,
    operation: Mutex<()>,
    retired: AtomicBool,
    last_error: Mutex<Option<String>>,
    send_times: Mutex<VecDeque<Instant>>,
    receive_times: Mutex<VecDeque<Instant>>,
    cache: Mutex<AttachmentCache>,
    acks: Mutex<VecDeque<(String, String, String)>>,
    loopback: Mutex<Option<Arc<Node>>>,
    echo: AtomicBool,
}
impl Node {
    fn open(root: &Path, id: &str) -> NativeResult<Arc<Self>> {
        checked_root(root)?;
        let path = root.join(format!("{:x}.json", Sha256::digest(id.as_bytes())));
        let data = if checked_file(&path)? {
            let mut file =
                fs::File::open(&path).map_err(|_| io_error("Cannot read LAN history"))?;
            let mut bytes = Vec::new();
            Read::by_ref(&mut file)
                .take(MAX_DISK as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| io_error("Cannot read LAN history"))?;
            if bytes.len() > MAX_DISK {
                return Err(NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "LAN history exceeds its size limit; original data was preserved",
                ));
            }
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Header {
                schema_version: u32,
            }
            let header: Header = serde_json::from_slice(&bytes).map_err(|_| {
                NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "LAN history is invalid; original data was preserved",
                )
            })?;
            if !matches!(header.schema_version, 1 | 2) {
                return Err(NativeError::new(
                    ErrorCode::ExtensionIncompatible,
                    "LAN history uses an unsupported version; original data was preserved",
                ));
            }
            let data: Document = serde_json::from_slice(&bytes).map_err(|_| {
                NativeError::new(
                    ErrorCode::StorageCorrupt,
                    "LAN history is invalid; original data was preserved",
                )
            })?;
            data.validate(id)?;
            data
        } else {
            Document::fresh(id)?
        };
        let node = Arc::new(Self {
            root: root.into(),
            path,
            data: Mutex::new(data),
            runtime: Mutex::new(Runtime::default()),
            operation: Mutex::new(()),
            retired: AtomicBool::new(false),
            last_error: Mutex::new(None),
            send_times: Mutex::new(VecDeque::new()),
            receive_times: Mutex::new(VecDeque::new()),
            cache: Mutex::new(AttachmentCache::default()),
            acks: Mutex::new(VecDeque::new()),
            loopback: Mutex::new(None),
            echo: AtomicBool::new(false),
        });
        node.cleanup_partial_attachments()?;
        Ok(node)
    }
    fn mutate<T>(&self, edit: impl FnOnce(&mut Document) -> NativeResult<T>) -> NativeResult<T> {
        self.mutate_permitted(None, edit)
    }
    fn mutate_permitted<T>(
        &self,
        permit: Option<&ServicePermit>,
        edit: impl FnOnce(&mut Document) -> NativeResult<T>,
    ) -> NativeResult<T> {
        check_permit(permit)?;
        let mut data = self
            .data
            .lock()
            .map_err(|_| unavailable("LAN history is unavailable"))?;
        let mut next = data.clone();
        next.schema_version = 2;
        let result = edit(&mut next)?;
        while next.messages.len() > MAX_HISTORY {
            next.messages.pop_front();
        }
        let mut bytes =
            serde_json::to_vec(&next).map_err(|_| io_error("Cannot encode LAN history"))?;
        let mut encoded_size = bytes.len();
        while encoded_size > MAX_DISK {
            if let Some(message) = next.messages.pop_front() {
                let bytes = serde_json::to_vec(&message)
                    .map_err(|_| io_error("Cannot encode LAN history"))?
                    .len();
                encoded_size =
                    encoded_size.saturating_sub(bytes + usize::from(!next.messages.is_empty()));
            } else {
                return Err(invalid("LAN history exceeds its storage limit"));
            }
        }
        // 常规写入复用首次编码；只有淘汰旧消息后才重新编码最终快照。
        if encoded_size != bytes.len() {
            bytes = serde_json::to_vec(&next).map_err(|_| io_error("Cannot encode LAN history"))?;
        }
        if bytes.len() > MAX_DISK {
            return Err(invalid("LAN history exceeds its storage limit"));
        }
        checked_root(&self.root)?;
        checked_file(&self.path)?;
        commit_permit(permit, || {
            atomic_write(&self.path, &bytes)?;
            *data = next;
            self.prune_attachments(&data);
            Ok(result)
        })
    }
    fn forget_contact(&self, data: &mut Document, peer_id: &str) -> NativeResult<()> {
        // 调用方在整个编辑与落盘期间持 data 锁；连接检查不能发生在取得该锁之前。
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        if runtime.connections.contains_key(peer_id) {
            return Err(invalid(
                "Stop the LAN session before forgetting a connected contact",
            ));
        }
        data.contacts.remove(peer_id);
        data.messages.retain(|message| message.peer_id != peer_id);
        Ok(())
    }
    fn receive_message(
        &self,
        peer_id: &str,
        connection_id: &str,
        id: &str,
        content: String,
    ) -> NativeResult<()> {
        self.receive_content(peer_id, connection_id, id, content, "text")
    }
    fn current_connection(
        &self,
        peer_id: &str,
        connection_id: &str,
    ) -> NativeResult<std::sync::MutexGuard<'_, Runtime>> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        if runtime.stop.load(Ordering::Acquire)
            || !runtime
                .connections
                .get(peer_id)
                .is_some_and(|connection| connection.id == connection_id)
        {
            return Err(unavailable("LAN connection was replaced or closed"));
        }
        Ok(runtime)
    }
    fn remember_peer(
        &self,
        peer_id: &str,
        connection_id: &str,
        name: String,
        address: IpAddr,
        port: u16,
    ) -> NativeResult<()> {
        self.mutate(|data| {
            let _runtime = self.current_connection(peer_id, connection_id)?;
            if !data.contacts.contains_key(peer_id) && data.contacts.len() >= MAX_CONTACTS {
                return Err(unavailable("LAN contact limit reached"));
            }
            let unread = data
                .contacts
                .get(peer_id)
                .map_or(0, |contact| contact.unread);
            data.contacts.insert(
                peer_id.into(),
                Contact {
                    id: peer_id.into(),
                    nickname: name,
                    address: address.to_string(),
                    port,
                    last_seen: now(),
                    unread,
                },
            );
            Ok(())
        })
    }
    fn update_peer_profile(
        &self,
        peer_id: &str,
        connection_id: &str,
        name: &str,
    ) -> NativeResult<()> {
        let name = nickname(name)?;
        self.mutate(|data| {
            let _runtime = self.current_connection(peer_id, connection_id)?;
            let contact = data
                .contacts
                .get_mut(peer_id)
                .ok_or_else(|| unavailable("The LAN contact no longer exists"))?;
            contact.nickname = name;
            contact.last_seen = now();
            Ok(())
        })
    }
    fn receive_content(
        &self,
        peer_id: &str,
        connection_id: &str,
        id: &str,
        content: String,
        kind: &str,
    ) -> NativeResult<()> {
        if !valid_token(id) {
            return Err(invalid("LAN peer sent an invalid message identity"));
        }
        text(&content)?;
        self.mutate(|data| {
            // 已读到的帧也可能晚于连接替换或联系人删除，须在持 data 锁的写入链重新核对。
            let _runtime = self.current_connection(peer_id, connection_id)?;
            let contact = data
                .contacts
                .get_mut(peer_id)
                .ok_or_else(|| unavailable("The LAN contact no longer exists"))?;
            if data.messages.iter().any(|message| message.id == id) {
                return Ok(());
            }
            data.messages.push_back(Message {
                id: id.into(),
                peer_id: peer_id.into(),
                sender: peer_id.into(),
                nickname: contact.nickname.clone(),
                text: content,
                at: now(),
                outgoing: false,
                delivery: "received".into(),
                kind: kind.into(),
                attachment: None,
            });
            contact.unread = (contact.unread + 1).min(MAX_HISTORY as u32);
            contact.last_seen = now();
            Ok(())
        })
    }
    fn status(&self) -> NativeResult<Value> {
        let data = self
            .data
            .lock()
            .map_err(|_| unavailable("LAN history is unavailable"))?;
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        let peers: Vec<_> = data
            .contacts
            .values()
            .map(|peer| {
                let mut value = serde_json::to_value(peer).unwrap_or(Value::Null);
                value["connected"] = runtime.connections.contains_key(&peer.id).into();
                value
            })
            .collect();
        let helper = self
            .loopback
            .lock()
            .map_err(|_| unavailable("Loopback helper is unavailable"))?;
        let loopback_peer_id = helper
            .as_ref()
            .map(|helper| {
                helper
                    .data
                    .lock()
                    .map(|data| data.node_id.clone())
                    .map_err(|_| unavailable("Loopback helper is unavailable"))
            })
            .transpose()?;
        Ok(
            json!({ "running": !runtime.stop.load(Ordering::Acquire), "nickname": data.nickname, "nodeId": data.node_id, "port": runtime.port, "addresses": if runtime.address.is_empty() { vec![default_address().to_string()] } else { vec![runtime.address.clone()] }, "peers": peers, "messages": data.messages, "historyLimit": MAX_HISTORY, "lastError": self.last_error.lock().ok().and_then(|v| v.clone()), "encrypted": false, "mode": if helper.is_some() { "loopback" } else { "lan" }, "loopbackPeerId": loopback_peer_id, "attachmentLimit": MAX_FILE_ATTACHMENT, "imageAttachmentLimit": MAX_IMAGE_ATTACHMENT, "fileAttachmentLimit": MAX_FILE_ATTACHMENT, "attachmentCacheLimit": MAX_ATTACHMENTS_DISK }),
        )
    }
    #[cfg(test)]
    fn attachment_root(&self) -> PathBuf {
        self.path.with_extension("attachments")
    }
    fn start_loopback(
        self: &Arc<Self>,
        name: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        let name = nickname(name)?;
        self.stop_permitted(permit)?;
        let helper_root = self.path.with_extension("loopback");
        let helper = Self::open(&helper_root, "internal.loopback-helper")?;
        helper.echo.store(true, Ordering::Release);
        helper.mutate_permitted(permit, |data| {
            data.messages.clear();
            data.contacts.clear();
            Ok(())
        })?;
        helper.start_permitted("回环助手", Ipv4Addr::LOCALHOST.into(), 0, permit)?;
        let result = (|| {
            self.start_permitted(&name, Ipv4Addr::LOCALHOST.into(), 0, permit)?;
            let port = helper
                .runtime
                .lock()
                .map_err(|_| unavailable("Loopback helper is unavailable"))?
                .port;
            self.connect_permitted("127.0.0.1", port, permit)?;
            let mut slot = self
                .loopback
                .lock()
                .map_err(|_| unavailable("Loopback helper is unavailable"))?;
            commit_permit(permit, || {
                *slot = Some(helper.clone());
                Ok(())
            })
        })();
        if result.is_err() {
            helper.stop();
            self.stop();
        }
        result
    }
    fn error(&self, message: &str) {
        if let Ok(mut error) = self.last_error.lock() {
            *error = Some(message.into());
        }
    }
    #[cfg(test)]
    fn start(self: &Arc<Self>, name: &str, address: IpAddr, port: u16) -> NativeResult<()> {
        self.start_permitted(name, address, port, None)
    }
    fn start_permitted(
        self: &Arc<Self>,
        name: &str,
        address: IpAddr,
        port: u16,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        check_permit(permit)?;
        let name = nickname(name)?;
        if !local_ip(address) {
            return Err(invalid(
                "LAN listeners require a private or loopback interface",
            ));
        }
        let needs_cleanup = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?
            .listener
            .as_ref()
            .is_some_and(|handle| handle.is_finished());
        if needs_cleanup {
            self.stop();
        }
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        if !runtime.stop.load(Ordering::Acquire) {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "LAN session is already listening",
            ));
        }
        let listener = commit_permit(permit, || {
            TcpListener::bind(SocketAddr::new(address, port)).map_err(|_| {
                transport("Cannot listen on this LAN address and port; it may already be in use")
            })
        })?;
        listener
            .set_nonblocking(true)
            .map_err(|_| transport("Cannot configure LAN listener"))?;
        let actual = listener
            .local_addr()
            .map_err(|_| transport("Cannot inspect LAN listener"))?;
        // 释放运行时锁后保存，避免与 status 的 data→runtime 顺序相反。
        drop(runtime);
        self.mutate_permitted(permit, |data| {
            data.nickname = name;
            Ok(())
        })?;
        runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        if !runtime.stop.load(Ordering::Acquire) {
            return Err(NativeError::new(
                ErrorCode::Conflict,
                "LAN session is already listening",
            ));
        }
        let stop = Arc::new(AtomicBool::new(false));
        let node = self.clone();
        let listener_stop = stop.clone();
        commit_permit(permit, || {
            let handle = thread::Builder::new()
                .name("extension-lan-listener".into())
                .spawn(move || {
                    while !listener_stop.load(Ordering::Acquire) {
                        node.flush_acks(&listener_stop);
                        match listener.accept() {
                            Ok((stream, remote)) if local_ip(remote.ip()) => {
                                if let Err(error) =
                                    node.attach(stream, remote, listener_stop.clone(), false, None)
                                {
                                    node.error(&error.message);
                                }
                            }
                            Ok((stream, _)) => {
                                let _ = stream.shutdown(Shutdown::Both);
                            }
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(40))
                            }
                            Err(_) => {
                                node.error("LAN listener stopped after a transport error");
                                break;
                            }
                        }
                    }
                    listener_stop.store(true, Ordering::Release);
                })
                .map_err(|_| unavailable("Cannot create LAN listener worker"))?;
            *runtime = Runtime {
                stop,
                port: actual.port(),
                address: actual.ip().to_string(),
                listener: Some(handle),
                ..Runtime::default()
            };
            if let Ok(mut error) = self.last_error.lock() {
                *error = None;
            }
            Ok(())
        })
    }
    fn stop(&self) {
        let _ = self.stop_permitted(None);
    }
    fn interrupt_permitted(&self, permit: Option<&ServicePermit>) -> NativeResult<()> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        commit_permit(permit, || {
            runtime.stop.store(true, Ordering::Release);
            Ok(())
        })
    }
    fn queue_ack(&self, peer: &str, connection: &str, id: &str) -> NativeResult<()> {
        let mut acks = self
            .acks
            .lock()
            .map_err(|_| unavailable("LAN acknowledgements are unavailable"))?;
        if acks.len() >= 256 {
            return Err(NativeError::new(
                ErrorCode::ExtensionBusy,
                "LAN acknowledgement queue is full",
            ));
        }
        acks.push_back((peer.into(), connection.into(), id.into()));
        Ok(())
    }
    fn flush_acks(&self, stop: &Arc<AtomicBool>) {
        for _ in 0..32 {
            if stop.load(Ordering::Acquire) {
                return;
            }
            let pending = self.acks.lock().ok().and_then(|mut acks| acks.pop_front());
            let Some((peer, connection_id, id)) = pending else {
                return;
            };
            let writer = self.runtime.lock().ok().and_then(|runtime| {
                if !Arc::ptr_eq(stop, &runtime.stop) {
                    return None;
                }
                runtime
                    .connections
                    .get(&peer)
                    .filter(|connection| connection.id == connection_id)
                    .map(|connection| connection.stream.clone())
            });
            let Some(writer) = writer else {
                continue;
            };
            match writer.try_lock() {
                Ok(mut stream) => {
                    if let Err(error) = write_frame_permitted(
                        &mut stream,
                        &Frame::Ack { id },
                        None,
                        Instant::now() + Duration::from_millis(250),
                    ) {
                        self.error(&error.message);
                        return;
                    }
                }
                Err(std::sync::TryLockError::WouldBlock) => {
                    if let Ok(mut acks) = self.acks.lock() {
                        acks.push_back((peer, connection_id, id));
                    }
                }
                Err(_) => {}
            }
        }
    }
    fn stop_permitted(&self, permit: Option<&ServicePermit>) -> NativeResult<()> {
        let (mut previous, helper) = {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            commit_permit(permit, || {
                let helper = self
                    .loopback
                    .lock()
                    .map_err(|_| unavailable("Loopback helper is unavailable"))?
                    .take();
                runtime.stop.store(true, Ordering::Release);
                Ok((std::mem::take(&mut *runtime), helper))
            })?
        };
        // shutdown 使用独立句柄，不能等待可能由长附件发送持有的 writer 锁。
        for connection in previous.connections.values() {
            let _ = connection.control.shutdown(Shutdown::Both);
        }
        if let Some(helper) = helper {
            helper.stop();
            // 测试助手只保留固定身份，停止即回收它为回声暂存的消息和附件。
            if let Err(error) = helper.mutate(|data| {
                data.messages.clear();
                data.contacts.clear();
                Ok(())
            }) {
                self.error(&error.message);
            }
        }
        if let Some(listener) = previous.listener.take() {
            let _ = listener.join();
        }
        for worker in previous.workers {
            let _ = worker.join();
        }
        if let Ok(mut acks) = self.acks.lock() {
            acks.clear();
        }
        Ok(())
    }
    #[cfg(test)]
    fn connect(self: &Arc<Self>, address: &str, port: u16) -> NativeResult<()> {
        self.connect_permitted(address, port, None)
    }
    fn connect_permitted(
        self: &Arc<Self>,
        address: &str,
        port: u16,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        check_permit(permit)?;
        let address = address.parse::<IpAddr>().map_err(|_| {
            invalid("Enter a numeric private LAN IP address, without a URL or hostname")
        })?;
        if !local_ip(address) || port == 0 {
            return Err(invalid(
                "LAN connections require a private or loopback IP and a nonzero port",
            ));
        }
        let stop = {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            if runtime.stop.load(Ordering::Acquire) {
                return Err(unavailable("Start the LAN listener before connecting"));
            }
            runtime.stop.clone()
        };
        let remote = SocketAddr::new(address, port);
        let stream = TcpStream::connect_timeout(&remote, Duration::from_secs(3)).map_err(|_| {
            transport("Cannot connect to this LAN peer; check the IP, port, listener and firewall")
        })?;
        if stop.load(Ordering::Acquire) {
            let _ = stream.shutdown(Shutdown::Both);
            return Err(unavailable("LAN session was stopped"));
        }
        check_permit(permit)?;
        self.attach(stream, remote, stop, true, permit)
    }
    fn attach(
        self: &Arc<Self>,
        mut stream: TcpStream,
        remote: SocketAddr,
        stop: Arc<AtomicBool>,
        initiated: bool,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        check_permit(permit)?;
        stream
            .set_read_timeout(Some(Duration::from_millis(200)))
            .map_err(|_| transport("Cannot configure LAN read timeout"))?;
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| transport("Cannot configure LAN write timeout"))?;
        stream
            .set_nodelay(true)
            .map_err(|_| transport("Cannot configure LAN stream"))?;
        stream
            .set_nonblocking(true)
            .map_err(|_| transport("Cannot configure nonblocking LAN stream"))?;
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?;
        if stop.load(Ordering::Acquire)
            || !Arc::ptr_eq(&stop, &runtime.stop)
            || runtime.connections.len() >= MAX_CONNECTIONS
            || runtime.pending >= 8
        {
            return Err(unavailable(
                "LAN session reached its connection limit or was stopped",
            ));
        }
        let mut active = Vec::new();
        for worker in runtime.workers.drain(..) {
            if worker.is_finished() {
                let _ = worker.join();
            } else {
                active.push(worker);
            }
        }
        runtime.workers = active;
        if runtime.workers.len() >= MAX_WORKERS {
            return Err(unavailable("LAN session reached its worker limit"));
        }
        commit_permit(permit, || {
            runtime.pending += 1;
            let node = self.clone();
            let handle = thread::Builder::new()
                .name("extension-lan-peer".into())
                .spawn(move || {
                    let result = node.peer_loop(&mut stream, remote, &stop, initiated);
                    let _ = stream.shutdown(Shutdown::Both);
                    if let Err(error) = result
                        && !stop.load(Ordering::Acquire)
                    {
                        node.error(&error.message);
                    }
                });
            match handle {
                Ok(handle) => {
                    runtime.workers.push(handle);
                    Ok(())
                }
                Err(_) => {
                    runtime.pending = runtime.pending.saturating_sub(1);
                    Err(unavailable("Cannot create LAN connection worker"))
                }
            }
        })
    }
    fn peer_loop(
        &self,
        stream: &mut TcpStream,
        remote: SocketAddr,
        stop: &Arc<AtomicBool>,
        initiated: bool,
    ) -> NativeResult<()> {
        let (node_id, name) = {
            let data = self
                .data
                .lock()
                .map_err(|_| unavailable("LAN history is unavailable"))?;
            (data.node_id.clone(), data.nickname.clone())
        };
        let port = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?
            .port;
        let handshake = (|| {
            write_frame(
                stream,
                &Frame::Hello {
                    version: 2,
                    node_id: node_id.clone(),
                    nickname: name,
                    port,
                },
            )?;
            let deadline = Instant::now() + FRAME_TIMEOUT;
            loop {
                if let Some(frame) = read_frame(stream, stop)? {
                    break Ok(frame);
                }
                if Instant::now() >= deadline {
                    break Err(transport("LAN peer did not complete the handshake"));
                }
            }
        })();
        if let Ok(mut runtime) = self.runtime.lock()
            && Arc::ptr_eq(stop, &runtime.stop)
        {
            runtime.pending = runtime.pending.saturating_sub(1);
        }
        let Frame::Hello {
            version: 2,
            node_id: peer_id,
            nickname: peer_name,
            port: peer_port,
        } = handshake?
        else {
            return Err(invalid("LAN peer uses an unsupported protocol"));
        };
        if !valid_token(&peer_id) || peer_id == node_id || peer_port == 0 {
            return Err(invalid("LAN peer sent an invalid identity"));
        }
        let peer_name = nickname(&peer_name)?;
        let connection_id = token()?;
        let writer = Arc::new(Mutex::new(
            stream
                .try_clone()
                .map_err(|_| transport("Cannot create LAN sender"))?,
        ));
        let control = stream
            .try_clone()
            .map_err(|_| transport("Cannot create LAN connection control handle"))?;
        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            if stop.load(Ordering::Acquire) || !Arc::ptr_eq(stop, &runtime.stop) {
                return Err(unavailable("The LAN session was stopped"));
            }
            // 两端同时连接时，双方保留同一条“较小节点 ID 发起”的连接，
            // 避免各自保留相反方向后互相关闭，最终两条都断开。
            let preferred = (node_id < peer_id) == initiated;
            if let Some(existing) = runtime.connections.get(&peer_id) {
                if !preferred || existing.preferred {
                    return Ok(());
                }
                let _ = existing.control.shutdown(Shutdown::Both);
            } else if runtime.connections.len() >= MAX_CONNECTIONS {
                return Err(unavailable("LAN session reached its connection limit"));
            }
            runtime.connections.insert(
                peer_id.clone(),
                Connection {
                    id: connection_id.clone(),
                    stream: writer.clone(),
                    control,
                    preferred,
                },
            );
        }
        let result = (|| {
            self.remember_peer(&peer_id, &connection_id, peer_name, remote.ip(), peer_port)?;
            let mut received = VecDeque::new();
            while !stop.load(Ordering::Acquire) {
                let Some(frame) = read_frame(stream, stop)? else {
                    continue;
                };
                let tick = Instant::now();
                received.push_back(tick);
                while received
                    .front()
                    .is_some_and(|time| tick.duration_since(*time) > Duration::from_secs(1))
                {
                    received.pop_front();
                }
                if received.len() > 30 {
                    return Err(unavailable("LAN peer exceeded the message rate limit"));
                }
                {
                    let mut times = self
                        .receive_times
                        .lock()
                        .map_err(|_| unavailable("LAN receiver is unavailable"))?;
                    while times
                        .front()
                        .is_some_and(|time| tick.duration_since(*time) > Duration::from_secs(1))
                    {
                        times.pop_front();
                    }
                    if times.len() >= 60 {
                        return Err(unavailable(
                            "LAN session exceeded its aggregate frame rate limit",
                        ));
                    }
                    times.push_back(tick);
                }
                match frame {
                    Frame::Message { id, text: content } => {
                        self.receive_message(&peer_id, &connection_id, &id, content.clone())?;
                        self.queue_ack(&peer_id, &connection_id, &id)?;
                        if self.echo.load(Ordering::Acquire) {
                            self.send_permitted(&peer_id, &content, None)?;
                        }
                    }
                    Frame::Sticker { id, text: content } => {
                        self.receive_content(
                            &peer_id,
                            &connection_id,
                            &id,
                            content.clone(),
                            "sticker",
                        )?;
                        self.queue_ack(&peer_id, &connection_id, &id)?;
                        if self.echo.load(Ordering::Acquire) {
                            self.send_content_permitted(&peer_id, &content, "sticker", None)?;
                        }
                    }
                    Frame::Attachment {
                        id,
                        media_kind,
                        attachment,
                    } => {
                        let mut cached = self.receive_attachment(
                            (&peer_id, &connection_id, &id),
                            &media_kind,
                            attachment,
                            stream,
                            stop,
                        )?;
                        self.queue_ack(&peer_id, &connection_id, &id)?;
                        if self.echo.load(Ordering::Acquire) {
                            self.send_cached_for_session(&peer_id, &mut cached, Some(stop), None)?;
                        }
                    }
                    Frame::Ack { id } => {
                        if !valid_token(&id) {
                            return Err(invalid("LAN peer sent an invalid acknowledgement"));
                        }
                        let known = self
                            .data
                            .lock()
                            .map_err(|_| unavailable("LAN history is unavailable"))?
                            .messages
                            .iter()
                            .any(|message| {
                                message.id == id
                                    && message.peer_id == peer_id
                                    && message.outgoing
                                    && message.delivery != "delivered"
                            });
                        if !known {
                            continue;
                        }
                        self.mutate(|data| {
                            if let Some(message) = data.messages.iter_mut().find(|message| {
                                message.id == id && message.peer_id == peer_id && message.outgoing
                            }) {
                                message.delivery = "delivered".into();
                            }
                            Ok(())
                        })?;
                    }
                    Frame::Profile { nickname: name } => {
                        self.update_peer_profile(&peer_id, &connection_id, &name)?;
                    }
                    Frame::Hello { .. } => return Err(invalid("LAN peer repeated its handshake")),
                }
                if self.echo.load(Ordering::Acquire) {
                    // 助手的送达回执不呈现给用户；回送完成即可回收隐藏副本。
                    self.mutate(|data| {
                        data.messages.clear();
                        for peer in data.contacts.values_mut() {
                            peer.unread = 0;
                        }
                        Ok(())
                    })?;
                }
            }
            Ok(())
        })();
        if let Ok(mut runtime) = self.runtime.lock() {
            if runtime
                .connections
                .get(&peer_id)
                .is_some_and(|connection| connection.id == connection_id)
            {
                runtime.connections.remove(&peer_id);
            } else {
                // 被确定性去重替换的旧通道断开是正常回收，不覆盖新通道状态。
                return Ok(());
            }
        }
        result
    }
    #[cfg(test)]
    fn send(&self, peer_id: &str, content: &str) -> NativeResult<()> {
        self.send_permitted(peer_id, content, None)
    }
    fn send_permitted(
        &self,
        peer_id: &str,
        content: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        self.send_content_permitted(peer_id, content, "text", permit)
    }
    fn send_content_permitted(
        &self,
        peer_id: &str,
        content: &str,
        kind: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        check_permit(permit)?;
        text(content)?;
        if !matches!(kind, "text" | "sticker") {
            return Err(invalid("Unsupported LAN message kind"));
        }
        if !valid_token(peer_id) {
            return Err(invalid("Invalid LAN contact identity"));
        }
        {
            let mut times = self
                .send_times
                .lock()
                .map_err(|_| unavailable("LAN sender is unavailable"))?;
            let tick = Instant::now();
            while times
                .front()
                .is_some_and(|time| tick.duration_since(*time) > Duration::from_secs(1))
            {
                times.pop_front();
            }
            if times.len() >= 10 {
                return Err(unavailable("Send at most 10 LAN messages per second"));
            }
            times.push_back(tick);
        }
        let (writer, connection_id) = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?
            .connections
            .get(peer_id)
            .map(|connection| (connection.stream.clone(), connection.id.clone()))
            .ok_or_else(|| unavailable("This LAN contact is not connected"))?;
        let id = token()?;
        self.mutate_permitted(permit, |data| {
            let _runtime = self.current_connection(peer_id, &connection_id)?;
            // 握手先发布连接再保存联系人；并发发送不能落盘悬空的 peer_id。
            if !data.contacts.contains_key(peer_id) {
                return Err(unavailable("The LAN contact is not ready"));
            }
            data.messages.push_back(Message {
                id: id.clone(),
                peer_id: peer_id.into(),
                sender: data.node_id.clone(),
                nickname: data.nickname.clone(),
                text: content.into(),
                at: now(),
                outgoing: true,
                delivery: "sent".into(),
                kind: kind.into(),
                attachment: None,
            });
            Ok(())
        })?;
        let deadline = Instant::now() + Duration::from_secs(2);
        let result = writer
            .lock()
            .map_err(|_| unavailable("LAN sender is unavailable"))
            .and_then(|mut stream| {
                write_frame_permitted(
                    &mut stream,
                    &if kind == "sticker" {
                        Frame::Sticker {
                            id: id.clone(),
                            text: content.into(),
                        }
                    } else {
                        Frame::Message {
                            id: id.clone(),
                            text: content.into(),
                        }
                    },
                    permit,
                    deadline,
                )
            });
        if result.is_err() && check_permit(permit).is_ok() {
            let _ = self.mutate_permitted(permit, |data| {
                if let Some(message) = data.messages.iter_mut().find(|message| message.id == id) {
                    message.delivery = "failed".into();
                }
                Ok(())
            });
        }
        result
    }
    #[cfg(test)]
    fn send_cached_permitted(
        &self,
        peer_id: &str,
        cached: &mut CachedAttachment,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        self.send_cached_for_session(peer_id, cached, None, permit)
    }
    fn send_cached_for_session(
        &self,
        peer_id: &str,
        cached: &mut CachedAttachment,
        expected_stop: Option<&Arc<AtomicBool>>,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        check_permit(permit)?;
        if !valid_token(peer_id) {
            return Err(invalid("Invalid LAN contact identity"));
        }
        cached.attachment.validate(&cached.kind)?;
        let (writer, stop, connection_id) = {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            if runtime.stop.load(Ordering::Acquire)
                || expected_stop.is_some_and(|expected| !Arc::ptr_eq(expected, &runtime.stop))
            {
                return Err(attachment_io::interrupted("LAN session was stopped"));
            }
            let connection = runtime
                .connections
                .get(peer_id)
                .ok_or_else(|| unavailable("This LAN contact is not connected"))?;
            (
                connection.stream.clone(),
                runtime.stop.clone(),
                connection.id.clone(),
            )
        };
        let id = token()?;
        self.mutate_permitted(permit, |data| {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            if stop.load(Ordering::Acquire)
                || !runtime
                    .connections
                    .get(peer_id)
                    .is_some_and(|c| c.id == connection_id)
            {
                return Err(attachment_io::interrupted(
                    "LAN connection was replaced or stopped",
                ));
            }
            if !data.contacts.contains_key(peer_id) {
                return Err(unavailable("The LAN contact is not ready"));
            }
            data.messages.push_back(Message {
                id: id.clone(),
                peer_id: peer_id.into(),
                sender: data.node_id.clone(),
                nickname: data.nickname.clone(),
                text: String::new(),
                at: now(),
                outgoing: true,
                delivery: "sent".into(),
                kind: cached.kind.clone(),
                attachment: Some(cached.attachment.clone()),
            });
            Ok(())
        })?;
        let result = writer
            .lock()
            .map_err(|_| unavailable("LAN sender is unavailable"))
            .and_then(|mut stream| {
                let result = (|| {
                    write_frame_permitted(
                        &mut stream,
                        &Frame::Attachment {
                            id: id.clone(),
                            media_kind: cached.kind.clone(),
                            attachment: cached.attachment.clone(),
                        },
                        permit,
                        Instant::now() + Duration::from_secs(2),
                    )?;
                    attachment_io::write_cached(&mut stream, cached, permit, &stop)
                })();
                if result.is_err() {
                    let _ = stream.shutdown(Shutdown::Both);
                }
                result
            });
        let result =
            if result.is_err() && stop.load(Ordering::Acquire) && check_permit(permit).is_ok() {
                Err(attachment_io::interrupted("LAN transfer was stopped"))
            } else {
                result
            };
        if result.is_err() && check_permit(permit).is_ok() {
            let _ = self.mutate_permitted(permit, |data| {
                if let Some(message) = data.messages.iter_mut().find(|m| m.id == id) {
                    message.delivery = "failed".into();
                }
                Ok(())
            });
        }
        result
    }
    #[cfg(test)]
    fn store_attachment(
        &self,
        metadata: &Attachment,
        kind: &str,
        bytes: &[u8],
    ) -> NativeResult<()> {
        validate_attachment_bytes(metadata, kind, bytes)?;
        let mut source = tempfile::NamedTempFile::new_in(&self.root).unwrap();
        source.write_all(bytes).unwrap();
        let cached = self.import_attachment(source.path(), kind, None, None)?;
        if cached.attachment.sha256 != metadata.sha256 {
            return Err(invalid("Invalid test attachment checksum"));
        }
        Ok(())
    }
    #[cfg(test)]
    fn read_attachment(&self, id: &str) -> NativeResult<(Attachment, Vec<u8>, String)> {
        let mut cached = self.cached_attachment(id, None)?;
        let mut bytes = Vec::new();
        cached
            .file
            .read_to_end(&mut bytes)
            .map_err(|_| io_error("Cannot read test attachment"))?;
        Ok((cached.attachment.clone(), bytes, cached.kind.clone()))
    }
    #[cfg(test)]
    fn send_attachment_permitted(
        &self,
        peer_id: &str,
        kind: &str,
        metadata: Attachment,
        bytes: Vec<u8>,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        validate_attachment_bytes(&metadata, kind, &bytes)?;
        let mut source = tempfile::Builder::new()
            .prefix("lan-test-")
            .suffix(if kind == "image" { ".png" } else { ".bin" })
            .tempfile_in(&self.root)
            .unwrap();
        source.write_all(&bytes).unwrap();
        let mut cached = self.import_attachment(source.path(), kind, permit, None)?;
        cached.attachment.name = metadata.name;
        self.send_cached_permitted(peer_id, &mut cached, permit)
    }
    #[cfg(test)]
    fn set_nickname(&self, name: &str) -> NativeResult<()> {
        self.set_nickname_permitted(name, None)
    }
    fn set_nickname_permitted(
        &self,
        name: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<()> {
        check_permit(permit)?;
        let name = nickname(name)?;
        self.mutate_permitted(permit, |data| {
            data.nickname = name.clone();
            Ok(())
        })?;
        let writers: Vec<_> = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?
            .connections
            .values()
            .map(|connection| connection.stream.clone())
            .collect();
        let deadline = Instant::now() + Duration::from_secs(2);
        for writer in writers {
            check_permit(permit)?;
            if Instant::now() >= deadline {
                self.error(
                    "Nickname was saved locally; its LAN broadcast exceeded the send deadline",
                );
                break;
            }
            if writer
                .lock()
                .map_err(|_| unavailable("LAN sender is unavailable"))
                .and_then(|mut stream| {
                    write_frame_permitted(
                        &mut stream,
                        &Frame::Profile {
                            nickname: name.clone(),
                        },
                        permit,
                        deadline,
                    )
                })
                .is_err()
            {
                self.error(
                    "Nickname was saved locally, but one LAN peer could not receive the update",
                );
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    Status {},
    Start {
        nickname: String,
        port: Option<u16>,
        mode: Option<String>,
    },
    Loopback {
        nickname: String,
    },
    Stop {},
    Connect {
        address: String,
        port: Option<u16>,
    },
    Send {
        #[serde(rename = "peerId")]
        peer_id: String,
        text: String,
        kind: Option<String>,
    },
    SendAttachment {
        #[serde(rename = "peerId")]
        peer_id: String,
        kind: String,
    },
    PreviewAttachment {
        #[serde(rename = "messageId")]
        message_id: String,
    },
    SaveAttachment {
        #[serde(rename = "messageId")]
        message_id: String,
    },
    MarkRead {
        #[serde(rename = "peerId")]
        peer_id: String,
    },
    Nickname {
        nickname: String,
    },
    ClearHistory {},
    Forget {
        #[serde(rename = "peerId")]
        peer_id: String,
    },
}
fn parse_request(request: Value) -> NativeResult<Request> {
    if serde_json::to_vec(&request).map_or(true, |value| value.len() > MAX_FRAME) {
        return Err(invalid("LAN service request exceeds its size limit"));
    }
    serde_json::from_value(request).map_err(|_| invalid("Invalid LAN service request"))
}
struct Entry {
    node: Arc<Node>,
    owners: BTreeSet<String>,
}
struct Registry {
    root: PathBuf,
    isolated: bool,
    entries: Mutex<BTreeMap<String, Entry>>,
}
#[derive(Clone)]
pub struct ExtensionLan {
    inner: Arc<Registry>,
}
impl ExtensionLan {
    pub fn new(root: PathBuf, isolated: bool) -> Self {
        Self {
            inner: Arc::new(Registry {
                root,
                isolated,
                entries: Mutex::new(BTreeMap::new()),
            }),
        }
    }
    #[cfg(test)]
    fn dispatch_permitted(
        &self,
        owner: &str,
        id: &str,
        request: Request,
        permit: &ServicePermit,
    ) -> NativeResult<Value> {
        permit.check()?;
        let result = self.dispatch_guarded(owner, id, request, Some(permit))?;
        permit.check()?;
        Ok(result)
    }
    #[cfg(test)]
    fn dispatch(&self, owner: &str, id: &str, request: Request) -> NativeResult<Value> {
        self.dispatch_guarded(owner, id, request, None)
    }
    fn owned_node(
        &self,
        owner: &str,
        id: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<Arc<Node>> {
        check_permit(permit)?;
        if self.inner.isolated {
            return Err(unavailable(
                "LAN messaging is disabled during isolated recovery",
            ));
        }
        if !crate::extensions::valid_id(id)
            || owner.is_empty()
            || owner.len() > 128
            || owner.chars().any(char::is_control)
        {
            return Err(invalid("Invalid LAN resource owner"));
        }
        let node = {
            let mut entries = self
                .inner
                .entries
                .lock()
                .map_err(|_| unavailable("LAN services are unavailable"))?;
            if !entries.contains_key(id) {
                if entries.len() >= MAX_INSTANCES {
                    return Err(unavailable("LAN service instance limit reached"));
                }
                let node = Node::open(&self.inner.root, id)?;
                commit_permit(permit, || {
                    entries.insert(
                        id.into(),
                        Entry {
                            node,
                            owners: BTreeSet::new(),
                        },
                    );
                    Ok(())
                })?;
            }
            let entry = entries
                .get_mut(id)
                .ok_or_else(|| unavailable("LAN service is unavailable"))?;
            if entry.owners.len() >= 32 && !entry.owners.contains(owner) {
                return Err(unavailable("LAN window limit reached"));
            }
            commit_permit(permit, || {
                entry.owners.insert(owner.into());
                Ok(())
            })?;
            entry.node.clone()
        };
        Ok(node)
    }
    // 对话框只由桌面请求入口调度；纯 broker 测试无需链接系统 GUI 入口。
    fn dispatch_native(
        &self,
        app: &tauri::AppHandle,
        owner: &str,
        id: &str,
        request: Request,
        permit: &ServicePermit,
    ) -> NativeResult<Value> {
        let permit = Some(permit);
        let node = self.owned_node(owner, id, permit)?;
        let operation = node
            .operation
            .lock()
            .map_err(|_| unavailable("LAN service is unavailable"))?;
        if node.retired.load(Ordering::Acquire) {
            return Err(unavailable("The LAN service owner has closed"));
        }
        check_permit(permit)?;
        // 文件对话框和流式 I/O 不占用调度锁；窗口租约、停止标记和连接代次在提交处复查。
        drop(operation);
        match request {
            Request::SendAttachment { peer_id, kind } => {
                if !matches!(kind.as_str(), "image" | "file") || !valid_token(&peer_id) {
                    return Err(invalid("Unsupported LAN attachment request"));
                }
                let stop = {
                    let runtime = node
                        .runtime
                        .lock()
                        .map_err(|_| unavailable("LAN session is unavailable"))?;
                    if runtime.stop.load(Ordering::Acquire)
                        || !runtime.connections.contains_key(&peer_id)
                    {
                        return Err(unavailable("This LAN contact is not connected"));
                    }
                    runtime.stop.clone()
                };
                let _capacity = ATTACHMENT_SENDERS.try_acquire().map_err(|_| {
                    NativeError::new(ErrorCode::ExtensionBusy, "LAN attachment senders are busy")
                })?;
                let mut dialog = app.dialog().file();
                if kind == "image" {
                    dialog = dialog.add_filter("Images", &["jpg", "jpeg", "png", "webp"]);
                }
                check_permit(permit)?;
                let Some(path) = dialog.blocking_pick_file() else {
                    check_permit(permit)?;
                    let mut status = node.status()?;
                    status["cancelled"] = true.into();
                    return Ok(status);
                };
                check_permit(permit)?;
                let path = path
                    .into_path()
                    .map_err(|_| invalid("Invalid selected attachment path"))?;
                let mut cached = node.import_attachment(&path, &kind, permit, Some(&stop))?;
                let runtime = node
                    .runtime
                    .lock()
                    .map_err(|_| unavailable("LAN session is unavailable"))?;
                if stop.load(Ordering::Acquire) || !Arc::ptr_eq(&stop, &runtime.stop) {
                    return Err(attachment_io::interrupted(
                        "LAN session changed during attachment selection",
                    ));
                }
                drop(runtime);
                node.send_cached_for_session(&peer_id, &mut cached, Some(&stop), permit)?;
                let mut status = node.status()?;
                status["cancelled"] = false.into();
                Ok(status)
            }
            Request::SaveAttachment { message_id } => {
                let mut cached = node.cached_attachment(&message_id, permit)?;
                check_permit(permit)?;
                let Some(path) = app
                    .dialog()
                    .file()
                    .set_file_name(&cached.attachment.name)
                    .blocking_save_file()
                else {
                    check_permit(permit)?;
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| invalid("Invalid selected attachment destination"))?;
                attachment_io::save(
                    &mut cached,
                    &path,
                    permit.ok_or_else(|| unavailable("Native save permit is unavailable"))?,
                )?;
                Ok(
                    json!({"cancelled":false,"name":path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or(cached.attachment.name.clone())}),
                )
            }
            _ => Err(invalid("Unsupported native LAN dialog action")),
        }
    }
    fn dispatch_guarded(
        &self,
        owner: &str,
        id: &str,
        request: Request,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<Value> {
        let node = self.owned_node(owner, id, permit)?;
        if matches!(request, Request::Status {}) {
            if node.retired.load(Ordering::Acquire) {
                return Err(unavailable("The LAN service owner has closed"));
            }
            check_permit(permit)?;
            return node.status();
        }
        if matches!(request, Request::Stop {}) {
            node.interrupt_permitted(permit)?;
        }
        let _operation = node
            .operation
            .lock()
            .map_err(|_| unavailable("LAN service is unavailable"))?;
        if node.retired.load(Ordering::Acquire) {
            return Err(unavailable("The LAN service owner has closed"));
        }
        check_permit(permit)?;
        match request {
            Request::Status {} => {}
            Request::Start {
                nickname,
                port,
                mode,
            } => {
                let name = self::nickname(&nickname)?;
                if mode
                    .as_deref()
                    .is_some_and(|mode| !matches!(mode, "lan" | "loopback"))
                {
                    return Err(invalid("Unsupported LAN connection mode"));
                }
                if mode.as_deref() == Some("loopback") {
                    node.start_loopback(&name, permit)?;
                    return node.status();
                }
                let port = port.unwrap_or(DEFAULT_PORT);
                if port == 0 {
                    return Err(invalid("LAN port must be nonzero"));
                }
                if node
                    .loopback
                    .lock()
                    .map_err(|_| unavailable("Loopback helper is unavailable"))?
                    .is_some()
                {
                    node.stop_permitted(permit)?;
                }
                node.start_permitted(&name, default_address().into(), port, permit)?;
            }
            Request::Loopback { nickname } => node.start_loopback(&nickname, permit)?,
            Request::Stop {} => node.stop_permitted(permit)?,
            Request::Connect { address, port } => {
                node.connect_permitted(&address, port.unwrap_or(DEFAULT_PORT), permit)?
            }
            Request::Send {
                peer_id,
                text,
                kind,
            } => node.send_content_permitted(
                &peer_id,
                &text,
                kind.as_deref().unwrap_or("text"),
                permit,
            )?,
            Request::SendAttachment { .. } => {
                return Err(unavailable(
                    "Native file picker requires the desktop request entry",
                ));
            }
            Request::PreviewAttachment { message_id } => {
                let mut cached = node.cached_attachment(&message_id, permit)?;
                let data_url = attachment_io::preview(&mut cached)?;
                check_permit(permit)?;
                return Ok(json!({"dataUrl":data_url}));
            }
            Request::SaveAttachment { .. } => {
                return Err(unavailable(
                    "Native save dialog requires the desktop request entry",
                ));
            }
            Request::MarkRead { peer_id } => node.mutate_permitted(permit, |data| {
                let peer = data
                    .contacts
                    .get_mut(&peer_id)
                    .ok_or_else(|| invalid("Unknown LAN contact"))?;
                peer.unread = 0;
                Ok(())
            })?,
            Request::Nickname { nickname: name } => {
                node.set_nickname_permitted(&name, permit)?;
            }
            Request::ClearHistory {} => node.mutate_permitted(permit, |data| {
                data.messages.clear();
                for peer in data.contacts.values_mut() {
                    peer.unread = 0;
                }
                Ok(())
            })?,
            Request::Forget { peer_id } => {
                node.mutate_permitted(permit, |data| node.forget_contact(data, &peer_id))?;
            }
        }
        node.status()
    }
    pub fn close_window(&self, owner: &str) {
        if let Ok(mut entries) = self.inner.entries.lock() {
            let keys: Vec<_> = entries
                .iter_mut()
                .filter_map(|(id, entry)| {
                    entry.owners.remove(owner);
                    entry.owners.is_empty().then(|| id.clone())
                })
                .collect();
            for id in keys {
                if let Some(entry) = entries.remove(&id) {
                    let _operation = entry.node.operation.lock();
                    entry.node.retired.store(true, Ordering::Release);
                    entry.node.stop();
                }
            }
        }
    }
    pub fn stop_extension(&self, id: &str) {
        if let Ok(mut entries) = self.inner.entries.lock()
            && let Some(entry) = entries.remove(id)
        {
            let _operation = entry.node.operation.lock();
            entry.node.retired.store(true, Ordering::Release);
            entry.node.stop();
        }
    }
    pub fn shutdown(&self) {
        if let Ok(mut entries) = self.inner.entries.lock() {
            for entry in std::mem::take(&mut *entries).into_values() {
                let _operation = entry.node.operation.lock();
                entry.node.retired.store(true, Ordering::Release);
                entry.node.stop();
            }
        }
    }
}
impl Drop for Registry {
    fn drop(&mut self) {
        if let Ok(entries) = self.entries.get_mut() {
            for entry in entries.values() {
                entry.node.stop();
            }
        }
    }
}
pub(crate) async fn request(
    app: tauri::AppHandle,
    owner: &str,
    extension_id: &str,
    request: Value,
    permit: ServicePermit,
) -> NativeResult<Value> {
    let request = parse_request(request)?;
    permit.check()?;
    let state = app.state::<ExtensionLan>().inner.clone();
    let owner = owner.to_owned();
    let id = extension_id.to_owned();
    blocking::run(move || {
        let broker = ExtensionLan { inner: state };
        let result = match request {
            Request::SendAttachment { .. } | Request::SaveAttachment { .. } => {
                broker.dispatch_native(&app, &owner, &id, request, &permit)?
            }
            _ => broker.dispatch_guarded(&owner, &id, request, Some(&permit))?,
        };
        permit.check()?;
        Ok(result)
    })
    .await
}
pub fn close_window(app: &tauri::AppHandle, owner: &str) {
    app.state::<ExtensionLan>().close_window(owner);
}
pub fn stop_extension(app: &tauri::AppHandle, id: &str) {
    app.state::<ExtensionLan>().stop_extension(id);
}
pub fn shutdown(app: &tauri::AppHandle) {
    app.state::<ExtensionLan>().shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "market.lan-chat";
    struct ActiveNode(Arc<Node>);
    impl Drop for ActiveNode {
        fn drop(&mut self) {
            self.0.stop();
        }
    }
    fn directory() -> tempfile::TempDir {
        tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
    }
    fn node(root: &Path, name: &str) -> ActiveNode {
        let node = Node::open(root, ID).unwrap();
        node.start(name, Ipv4Addr::LOCALHOST.into(), 0).unwrap();
        ActiveNode(node)
    }
    fn wait(mut check: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(6);
        while !check() {
            assert!(Instant::now() < deadline, "LAN operation did not finish");
            thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn real_tcp_peers_exchange_acknowledged_text_profiles_and_persist_history() {
        let first_root = directory();
        let second_root = directory();
        let first = node(first_root.path(), "小林");
        let second = node(second_root.path(), "小周");
        let second_port = second.0.runtime.lock().unwrap().port;
        let first_id = first.0.data.lock().unwrap().node_id.clone();
        let second_id = second.0.data.lock().unwrap().node_id.clone();
        first.0.connect("127.0.0.1", second_port).unwrap();
        wait(|| {
            first.0.runtime.lock().unwrap().connections.len() == 1
                && second.0.runtime.lock().unwrap().connections.len() == 1
        });
        first
            .0
            .send(&second_id, "你好，局域网朋友 🌍\n这是真实 TCP 消息。")
            .unwrap();
        wait(|| {
            second.0.data.lock().unwrap().messages.len() == 1
                && first
                    .0
                    .data
                    .lock()
                    .unwrap()
                    .messages
                    .front()
                    .is_some_and(|m| m.delivery == "delivered")
        });
        assert_eq!(second.0.data.lock().unwrap().contacts[&first_id].unread, 1);
        second.0.send(&first_id, "收到啦！").unwrap();
        wait(|| first.0.data.lock().unwrap().messages.len() == 2);
        first.0.set_nickname("林同学").unwrap();
        wait(|| second.0.data.lock().unwrap().contacts[&first_id].nickname == "林同学");
        first.0.stop();
        second.0.stop();
        let reopened = Node::open(first_root.path(), ID).unwrap();
        let status = reopened.status().unwrap();
        assert_eq!(status["nickname"], "林同学");
        assert_eq!(status["messages"].as_array().unwrap().len(), 2);
        assert_eq!(status["running"], false);
        assert_eq!(
            status["messages"][0]["text"],
            "你好，局域网朋友 🌍\n这是真实 TCP 消息。"
        );
        assert!(reopened.runtime.lock().unwrap().connections.is_empty());
    }
    #[test]
    fn simultaneous_connections_converge_on_one_working_tcp_channel() {
        let first_root = directory();
        let second_root = directory();
        let first = node(first_root.path(), "甲");
        let second = node(second_root.path(), "乙");
        let first_port = first.0.runtime.lock().unwrap().port;
        let second_port = second.0.runtime.lock().unwrap().port;
        let first_node = first.0.clone();
        let second_node = second.0.clone();
        let left = thread::spawn(move || first_node.connect("127.0.0.1", second_port));
        let right = thread::spawn(move || second_node.connect("127.0.0.1", first_port));
        left.join().unwrap().unwrap();
        right.join().unwrap().unwrap();
        wait(|| {
            first.0.runtime.lock().unwrap().connections.len() == 1
                && second.0.runtime.lock().unwrap().connections.len() == 1
        });
        thread::sleep(Duration::from_millis(150));
        let second_id = second.0.data.lock().unwrap().node_id.clone();
        first.0.send(&second_id, "同时点击也能连通").unwrap();
        wait(|| {
            first
                .0
                .data
                .lock()
                .unwrap()
                .messages
                .front()
                .is_some_and(|m| m.delivery == "delivered")
        });
        assert_eq!(second.0.data.lock().unwrap().messages.len(), 1);
        assert_eq!(first.0.runtime.lock().unwrap().connections.len(), 1);
        assert_eq!(second.0.runtime.lock().unwrap().connections.len(), 1);
    }
    #[test]
    fn history_and_request_boundaries_reject_public_targets_and_unknown_fields() {
        for ip in [
            "8.8.8.8",
            "0.0.0.0",
            "224.0.0.1",
            "255.255.255.255",
            "2001:4860:4860::8888",
            "::ffff:127.0.0.1",
        ] {
            assert!(!local_ip(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "127.0.0.1",
            "192.168.1.42",
            "10.2.3.4",
            "172.16.0.1",
            "::1",
            "fd00::1",
        ] {
            assert!(local_ip(ip.parse().unwrap()), "{ip}");
        }
        assert!(text(&"x".repeat(MAX_TEXT + 1)).is_err());
        assert!(text("\0").is_err());
        assert!(nickname("\n").is_err());
        assert!(
            serde_json::from_value::<Request>(json!({"action":"status", "path":"C:/secret"}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<Request>(
                json!({"action":"send", "peerId":"peer", "text":"hello", "file":"secret"})
            )
            .is_err()
        );
        let root = directory();
        let service = ExtensionLan::new(root.path().into(), false);
        assert!(
            service
                .dispatch("main", "../../escape", Request::Status {})
                .is_err()
        );
        let node = node(root.path(), "测试");
        for address in [
            "8.8.8.8",
            "https://192.168.1.1",
            "localhost",
            "192.168.1.1:80",
        ] {
            assert!(node.0.connect(address, 45873).is_err());
        }
    }
    #[test]
    fn tcp_backpressure_does_not_hold_the_window_lifecycle_lock() {
        let root = directory();
        let store = crate::extensions::ExtensionStore::new(root.path().join("extensions"), false);
        let activity = store
            .begin_service(store.window_run_token("main".into()).unwrap())
            .unwrap();
        let permit = ServicePermit::for_test(activity);
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let mut sender = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_receiver, _) = listener.accept().unwrap();
        sender.set_nonblocking(true).unwrap();
        let (progress_tx, progress_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            let frame = Frame::Message {
                id: token().unwrap(),
                text: "x".repeat(MAX_TEXT),
            };
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                match write_frame_permitted(&mut sender, &frame, Some(&permit), deadline) {
                    Ok(()) => progress_tx.send(()).unwrap(),
                    Err(error) => {
                        done_tx.send(error).unwrap();
                        break;
                    }
                }
            }
        });
        progress_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        // WouldBlock 只反映瞬时容量；接收端内核仍可能 ACK 并腾出空间。
        // 持续发送真实帧，直到完成进度停滞，避免把稍晚成功的一帧误当失败。
        let saturating = Instant::now();
        loop {
            match progress_rx.recv_timeout(Duration::from_millis(30)) {
                Ok(()) => assert!(
                    saturating.elapsed() < Duration::from_secs(2),
                    "Loopback send buffer never reached backpressure"
                ),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => break,
                Err(error) => panic!("TCP writer stopped before window close: {error}"),
            }
        }
        assert!(
            matches!(
                done_rx.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Empty)
            ),
            "A saturated TCP writer should be waiting outside commit"
        );
        let closing = Instant::now();
        store.begin_window_close("main").unwrap();
        assert!(
            closing.elapsed() < Duration::from_millis(250),
            "TCP backpressure blocked the window lifecycle mutex"
        );
        assert_eq!(
            done_rx.recv_timeout(Duration::from_secs(1)).unwrap().code,
            ErrorCode::ExtensionUnavailable
        );
        worker.join().unwrap();
        store.wait_stopped();
    }
    #[test]
    fn maximal_escaped_text_fits_both_service_requests_and_protocol_frames() {
        let peer_id = token().unwrap();
        for character in ['\\', '"', '\r', '\n', '\t'] {
            let content = format!("{}x", character.to_string().repeat(MAX_TEXT - 1));
            assert_eq!(content.len(), MAX_TEXT);
            text(&content).unwrap();
            let request = json!({"action":"send", "peerId":peer_id, "text":content});
            let Request::Send { text: parsed, .. } = parse_request(request).unwrap() else {
                panic!("Expected the original send request");
            };
            assert_eq!(parsed, content);
            let frame = serde_json::to_vec(&Frame::Message {
                id: token().unwrap(),
                text: content.clone(),
            })
            .unwrap();
            assert!(frame.len() <= MAX_FRAME);
            let Frame::Message { text: decoded, .. } = serde_json::from_slice(&frame).unwrap()
            else {
                panic!("Expected the original message frame");
            };
            assert_eq!(decoded, content);
        }
        let worst_encoding = "\u{0001}".repeat(MAX_TEXT);
        let encoded = serde_json::to_vec(&Frame::Message {
            id: token().unwrap(),
            text: worst_encoding.clone(),
        })
        .unwrap();
        assert!(encoded.len() > MAX_TEXT * 6);
        assert!(encoded.len() <= MAX_FRAME);
        assert!(text(&worst_encoding).is_err());
        assert!(text(&"x".repeat(MAX_TEXT + 1)).is_err());
        assert!(
            parse_request(json!({"action":"send", "peerId":peer_id, "text":"x".repeat(MAX_FRAME)}))
                .is_err()
        );
        assert!(
            parse_request(
                json!({"action":"send", "peerId":peer_id, "text":"hello", "file":"private"})
            )
            .is_err()
        );
    }
    #[test]
    fn service_permits_accept_epoch_owners_and_block_late_lan_side_effects() {
        let root = directory();
        let store = crate::extensions::ExtensionStore::new(root.path().join("extensions"), false);
        let service = ExtensionLan::new(root.path().join("lan"), false);
        let activity = store
            .begin_service(store.window_run_token("main".into()).unwrap())
            .unwrap();
        let old_owner = activity.owner();
        assert!(old_owner.starts_with("main@"));
        let old_permit = ServicePermit::for_test(activity);
        let status = service
            .dispatch_permitted(
                &old_owner,
                ID,
                Request::Nickname {
                    nickname: "保留的原昵称".into(),
                },
                &old_permit,
            )
            .unwrap();
        assert_eq!(status["nickname"], "保留的原昵称");
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        let original = fs::read(&node.path).unwrap();
        let receiver = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        receiver.set_nonblocking(true).unwrap();
        let port = receiver.local_addr().unwrap().port();
        store.begin_window_close("main").unwrap();
        for request in [
            Request::Start {
                nickname: "不能监听".into(),
                port: Some(port),
                mode: None,
            },
            Request::Connect {
                address: "127.0.0.1".into(),
                port: Some(port),
            },
            Request::Send {
                peer_id: token().unwrap(),
                text: "不能发送".into(),
                kind: None,
            },
            Request::Loopback {
                nickname: "不能回环".into(),
            },
            Request::SendAttachment {
                peer_id: token().unwrap(),
                kind: "file".into(),
            },
            Request::PreviewAttachment {
                message_id: token().unwrap(),
            },
            Request::SaveAttachment {
                message_id: token().unwrap(),
            },
            Request::Nickname {
                nickname: "不能修改".into(),
            },
            Request::ClearHistory {},
        ] {
            assert_eq!(
                service
                    .dispatch_permitted(&old_owner, ID, request, &old_permit)
                    .unwrap_err()
                    .code,
                ErrorCode::ExtensionUnavailable
            );
        }
        assert_eq!(fs::read(&node.path).unwrap(), original);
        assert_eq!(
            receiver.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        assert!(node.runtime.lock().unwrap().stop.load(Ordering::Acquire));

        store.reopen_window("main").unwrap();
        let activity = store
            .begin_service(store.window_run_token("main".into()).unwrap())
            .unwrap();
        let next_owner = activity.owner();
        assert_ne!(old_owner, next_owner);
        let next_permit = ServicePermit::for_test(activity);
        service
            .dispatch_permitted(&next_owner, ID, Request::Status {}, &next_permit)
            .unwrap();
        node.start("保留的原昵称", Ipv4Addr::LOCALHOST.into(), 0)
            .unwrap();
        assert!(
            service
                .dispatch_permitted(&old_owner, ID, Request::Stop {}, &old_permit)
                .is_err()
        );
        assert!(!node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        service.close_window(&old_owner);
        assert!(!node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        assert_eq!(
            service
                .dispatch_permitted(&next_owner, ID, Request::Status {}, &next_permit)
                .unwrap()["running"],
            true
        );
        service.close_window(&next_owner);
        assert!(node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        drop(old_permit);
        drop(next_permit);
        store.wait_stopped();
    }
    #[test]
    fn window_cleanup_stops_only_the_last_owner_and_retains_chat_data() {
        let _receivers = binary_receiver_test_guard();
        let root = directory();
        let peer_root = directory();
        let peer = node(peer_root.path(), "对端");
        let service = ExtensionLan::new(root.path().into(), false);
        service
            .dispatch(
                "first",
                ID,
                Request::Nickname {
                    nickname: "保留昵称".into(),
                },
            )
            .unwrap();
        service.dispatch("second", ID, Request::Status {}).unwrap();
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        node.start("保留昵称", Ipv4Addr::LOCALHOST.into(), 0)
            .unwrap();
        let port = node.runtime.lock().unwrap().port;
        let peer_id = peer.0.data.lock().unwrap().node_id.clone();
        let local_id = node.data.lock().unwrap().node_id.clone();
        node.connect("127.0.0.1", peer.0.runtime.lock().unwrap().port)
            .unwrap();
        wait(|| node.data.lock().unwrap().contacts.contains_key(&peer_id));
        let bytes = b"shared window attachment\0\xff".to_vec();
        let expected_sha = format!("{:x}", Sha256::digest(&bytes));
        node.send_attachment_permitted(
            &peer_id,
            "file",
            attachment("shared.bin", "file", &bytes),
            bytes.clone(),
            None,
        )
        .unwrap();
        wait(|| {
            peer.0.data.lock().unwrap().messages.len() == 1
                && node.data.lock().unwrap().messages.front().unwrap().delivery == "delivered"
        });
        let attachment_message = node
            .data
            .lock()
            .unwrap()
            .messages
            .front()
            .unwrap()
            .id
            .clone();
        service.close_window("first");
        assert!(!node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        service
            .dispatch(
                "second",
                ID,
                Request::Send {
                    peer_id: peer_id.clone(),
                    text: "第二个窗口仍可发送".into(),
                    kind: None,
                },
            )
            .unwrap();
        wait(|| peer.0.data.lock().unwrap().messages.len() == 2);
        peer.0.send(&local_id, "双向连接仍然可用").unwrap();
        wait(|| {
            let data = node.data.lock().unwrap();
            data.messages.len() == 3
                && data
                    .messages
                    .iter()
                    .filter(|message| message.outgoing)
                    .all(|message| message.delivery == "delivered")
        });
        service.close_window("second");
        assert!(node.retired.load(Ordering::Acquire));
        assert!(node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
        let status = service.dispatch("third", ID, Request::Status {}).unwrap();
        assert_eq!(status["nickname"], "保留昵称");
        assert_eq!(status["running"], false);
        assert_eq!(status["messages"].as_array().unwrap().len(), 3);
        let reopened = service.inner.entries.lock().unwrap()[ID].node.clone();
        let (metadata, stored, _) = reopened.read_attachment(&attachment_message).unwrap();
        assert_eq!(metadata.sha256, expected_sha);
        assert_eq!(stored, bytes);
        let isolated = ExtensionLan::new(root.path().into(), true);
        assert_eq!(
            isolated
                .dispatch("main", ID, Request::Status {})
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        service.shutdown();
    }
    #[test]
    fn forgetting_rechecks_a_connection_published_after_the_disconnected_observation() {
        let root = directory();
        let service = ExtensionLan::new(root.path().join("lan"), false);
        service.dispatch("main", ID, Request::Status {}).unwrap();
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        let peer_id = token().unwrap();
        node.mutate(|data| {
            data.contacts.insert(
                peer_id.clone(),
                Contact {
                    id: peer_id.clone(),
                    nickname: "重连朋友".into(),
                    address: Ipv4Addr::LOCALHOST.to_string(),
                    port: DEFAULT_PORT,
                    last_seen: now(),
                    unread: 0,
                },
            );
            Ok(())
        })
        .unwrap();
        let original = fs::read(&node.path).unwrap();
        let receiver = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = TcpStream::connect(receiver.local_addr().unwrap()).unwrap();
        let (_remote, _) = receiver.accept().unwrap();
        let data = node.data.lock().unwrap();
        let mut next = data.clone();
        assert!(node.runtime.lock().unwrap().connections.is_empty());
        // 通道固定交错：先观察离线，再由握手线程发布连接，最后执行持 data 锁的删除规则。
        let (published_tx, published_rx) = std::sync::mpsc::sync_channel(0);
        let reconnecting = node.clone();
        let connected_peer = peer_id.clone();
        let publisher = thread::spawn(move || {
            reconnecting.runtime.lock().unwrap().connections.insert(
                connected_peer,
                Connection {
                    id: token().unwrap(),
                    control: stream.try_clone().unwrap(),
                    stream: Arc::new(Mutex::new(stream)),
                    preferred: true,
                },
            );
            published_tx.send(()).unwrap();
        });
        published_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(
            node.forget_contact(&mut next, &peer_id).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert!(next.contacts.contains_key(&peer_id));
        next.validate(ID).unwrap();
        drop(data);
        publisher.join().unwrap();
        assert!(
            service
                .dispatch(
                    "main",
                    ID,
                    Request::Forget {
                        peer_id: peer_id.clone()
                    }
                )
                .is_err()
        );
        assert_eq!(fs::read(&node.path).unwrap(), original);
        node.mutate(|data| {
            data.messages.push_back(Message {
                id: token()?,
                peer_id: peer_id.clone(),
                sender: peer_id.clone(),
                nickname: "重连朋友".into(),
                text: "重连后的消息".into(),
                at: now(),
                outgoing: false,
                delivery: "received".into(),
                kind: "text".into(),
                attachment: None,
            });
            Ok(())
        })
        .unwrap();
        Node::open(&node.root, ID).unwrap();
        node.stop();
        service
            .dispatch("main", ID, Request::Forget { peer_id })
            .unwrap();
        let reopened = Node::open(&node.root, ID).unwrap();
        let data = reopened.data.lock().unwrap();
        assert!(data.contacts.is_empty());
        assert!(data.messages.is_empty());
    }
    #[test]
    fn replaced_connection_late_messages_cannot_restore_a_forgotten_contact() {
        let root = directory();
        let service = ExtensionLan::new(root.path().join("lan"), false);
        service.dispatch("main", ID, Request::Status {}).unwrap();
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        let peer_id = token().unwrap();
        node.mutate(|data| {
            data.contacts.insert(
                peer_id.clone(),
                Contact {
                    id: peer_id.clone(),
                    nickname: "重连朋友".into(),
                    address: Ipv4Addr::LOCALHOST.to_string(),
                    port: DEFAULT_PORT,
                    last_seen: now(),
                    unread: 0,
                },
            );
            Ok(())
        })
        .unwrap();
        let receiver = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = Arc::new(Mutex::new(
            TcpStream::connect(receiver.local_addr().unwrap()).unwrap(),
        ));
        let (_remote, _) = receiver.accept().unwrap();
        let first_id = token().unwrap();
        node.runtime.lock().unwrap().stop = Arc::new(AtomicBool::new(false));
        node.runtime.lock().unwrap().connections.insert(
            peer_id.clone(),
            Connection {
                id: first_id.clone(),
                control: stream.lock().unwrap().try_clone().unwrap(),
                stream: stream.clone(),
                preferred: false,
            },
        );
        node.receive_message(&peer_id, &first_id, &token().unwrap(), "有效消息".into())
            .unwrap();
        let late_id = token().unwrap();
        let late_content = "旧连接已经读取、尚未写入历史的消息";
        let second_id = token().unwrap();
        // 直接固定各阶段，无需等待线程调度：A 已读帧，随后 B 替换 A。
        node.runtime.lock().unwrap().connections.insert(
            peer_id.clone(),
            Connection {
                id: second_id.clone(),
                control: stream.lock().unwrap().try_clone().unwrap(),
                stream: stream.clone(),
                preferred: true,
            },
        );
        let before_replaced_frame = fs::read(&node.path).unwrap();
        assert_eq!(
            node.receive_message(&peer_id, &first_id, &late_id, late_content.into())
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(fs::read(&node.path).unwrap(), before_replaced_frame);
        node.runtime.lock().unwrap().connections.remove(&peer_id);
        service
            .dispatch(
                "main",
                ID,
                Request::Forget {
                    peer_id: peer_id.clone(),
                },
            )
            .unwrap();
        let forgotten = fs::read(&node.path).unwrap();
        assert_eq!(
            node.receive_message(&peer_id, &first_id, &late_id, late_content.into())
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(fs::read(&node.path).unwrap(), forgotten);
        // 即使新通道已经发表，但联系人尚未保存，入站写入也不能产生孤儿 peer_id。
        let control = stream.lock().unwrap().try_clone().unwrap();
        node.runtime.lock().unwrap().connections.insert(
            peer_id.clone(),
            Connection {
                id: second_id.clone(),
                control,
                stream,
                preferred: true,
            },
        );
        assert_eq!(
            node.receive_message(&peer_id, &second_id, &late_id, late_content.into())
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(fs::read(&node.path).unwrap(), forgotten);
        let reopened = Node::open(&node.root, ID).unwrap();
        let data = reopened.data.lock().unwrap();
        assert!(data.contacts.is_empty());
        assert!(data.messages.is_empty());
    }
    #[test]
    fn outgoing_messages_wait_for_the_handshake_contact_before_persisting() {
        let root = directory();
        let node = Node::open(root.path(), ID).unwrap();
        node.mutate(|_| Ok(())).unwrap();
        let original = fs::read(&node.path).unwrap();
        let peer_id = token().unwrap();
        let connection_id = token().unwrap();
        let receiver = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let stream = TcpStream::connect(receiver.local_addr().unwrap()).unwrap();
        let (mut remote, _) = receiver.accept().unwrap();
        stream.set_nonblocking(true).unwrap();
        remote.set_nonblocking(true).unwrap();
        {
            let mut runtime = node.runtime.lock().unwrap();
            runtime.stop = Arc::new(AtomicBool::new(false));
            // 固定真实握手的中间态：连接已可查到，联系人还没完成持久化。
            runtime.connections.insert(
                peer_id.clone(),
                Connection {
                    id: connection_id.clone(),
                    control: stream.try_clone().unwrap(),
                    stream: Arc::new(Mutex::new(stream)),
                    preferred: true,
                },
            );
        }
        for kind in ["text", "sticker"] {
            assert_eq!(
                node.send_content_permitted(&peer_id, "等待联系人", kind, None)
                    .unwrap_err()
                    .code,
                ErrorCode::ExtensionUnavailable,
            );
        }
        let bytes = b"attachment".to_vec();
        assert_eq!(
            node.send_attachment_permitted(
                &peer_id,
                "file",
                attachment("pending.bin", "file", &bytes),
                bytes,
                None,
            )
            .unwrap_err()
            .code,
            ErrorCode::ExtensionUnavailable,
        );
        assert_eq!(fs::read(&node.path).unwrap(), original);
        assert!(node.data.lock().unwrap().messages.is_empty());
        let mut sent = [0_u8; 1];
        assert_eq!(
            remote.read(&mut sent).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock,
        );
        Node::open(root.path(), ID).unwrap();

        node.remember_peer(
            &peer_id,
            &connection_id,
            "已完成握手".into(),
            Ipv4Addr::LOCALHOST.into(),
            DEFAULT_PORT,
        )
        .unwrap();
        node.send(&peer_id, "正常发送").unwrap();
        // 非阻塞接收允许短暂空闲；发送完成不代表对端已经收到 TCP 帧。
        let receiving = AtomicBool::new(false);
        let deadline = Instant::now() + FRAME_TIMEOUT;
        let received = loop {
            if let Some(frame) = read_frame(&mut remote, &receiving).unwrap() {
                break frame;
            }
            assert!(Instant::now() < deadline, "The message did not arrive");
        };
        assert!(matches!(
            received,
            Frame::Message { text, .. } if text == "正常发送",
        ));
        let reopened = Node::open(root.path(), ID).unwrap();
        assert_eq!(reopened.data.lock().unwrap().messages.len(), 1);
        node.stop();
    }
    #[test]
    fn future_corrupt_and_oversized_history_are_never_overwritten() {
        let root = directory();
        let path = root
            .path()
            .join(format!("{:x}.json", Sha256::digest(ID.as_bytes())));
        for (bytes, code) in [
            (
                b"{\"schemaVersion\":99,\"unknown\":true}".to_vec(),
                ErrorCode::ExtensionIncompatible,
            ),
            (b"not-json".to_vec(), ErrorCode::StorageCorrupt),
            (vec![b' '; MAX_DISK + 1], ErrorCode::StorageCorrupt),
        ] {
            fs::write(&path, &bytes).unwrap();
            let error = Node::open(root.path(), ID).err().unwrap();
            assert_eq!(error.code, code);
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn stored_history_is_bounded_by_both_message_count_and_encoded_bytes() {
        for (count, text) in [
            (1, "普通消息".into()),
            (MAX_HISTORY + 1, "短消息".into()),
            (600, "x\t".repeat(MAX_TEXT / 2)),
        ] {
            let root = directory();
            let node = Node::open(root.path(), ID).unwrap();
            let peer_id = token().unwrap();
            node.mutate(|data| {
                data.contacts.insert(
                    peer_id.clone(),
                    Contact {
                        id: peer_id.clone(),
                        nickname: "朋友".into(),
                        address: "192.168.1.2".into(),
                        port: DEFAULT_PORT,
                        last_seen: now(),
                        unread: 0,
                    },
                );
                for _ in 0..count {
                    data.messages.push_back(Message {
                        id: token()?,
                        peer_id: peer_id.clone(),
                        sender: data.node_id.clone(),
                        nickname: data.nickname.clone(),
                        text: text.clone(),
                        at: now(),
                        outgoing: true,
                        delivery: "sent".into(),
                        kind: "text".into(),
                        attachment: None,
                    });
                }
                Ok(())
            })
            .unwrap();
            let data = node.data.lock().unwrap();
            if text.len() == MAX_TEXT {
                assert!(data.messages.len() < MAX_HISTORY);
            } else {
                assert_eq!(data.messages.len(), count.min(MAX_HISTORY));
            }
            assert!(!data.messages.is_empty());
            let bytes = fs::read(&node.path).unwrap();
            assert!(bytes.len() <= MAX_DISK);
            assert_eq!(
                serde_json::from_slice::<Value>(&bytes).unwrap(),
                serde_json::to_value(&*data).unwrap(),
                "持久化内容必须与淘汰旧消息后的内存快照一致"
            );
            Node::open(root.path(), ID).unwrap();
        }
    }
    #[test]
    fn malformed_frames_and_cancellation_release_real_tcp_connections() {
        let root = directory();
        let node = node(root.path(), "测试");
        let port = node.0.runtime.lock().unwrap().port;
        let mut attacker = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        attacker
            .write_all(&((MAX_FRAME + 1) as u32).to_be_bytes())
            .unwrap();
        wait(|| node.0.last_error.lock().unwrap().is_some());
        assert!(node.0.runtime.lock().unwrap().connections.is_empty());
        let _idle = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let started = Instant::now();
        node.0.stop();
        assert!(started.elapsed() < Duration::from_secs(2));
        assert!(node.0.runtime.lock().unwrap().workers.is_empty());
    }
    fn attachment(name: &str, kind: &str, bytes: &[u8]) -> Attachment {
        Attachment {
            name: name.into(),
            mime: if kind == "image" {
                "image/png"
            } else {
                "application/octet-stream"
            }
            .into(),
            bytes: bytes.len(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
        }
    }
    #[test]
    fn binary_256k_512k_2m_real_tcp_and_loopback() {
        let _receivers = binary_receiver_test_guard();
        let left_root = directory();
        let right_root = directory();
        let left = node(left_root.path(), "发送端");
        let right = node(right_root.path(), "接收端");
        left.0
            .connect("127.0.0.1", right.0.runtime.lock().unwrap().port)
            .unwrap();
        wait(|| left.0.runtime.lock().unwrap().connections.len() == 1);
        let right_id = right.0.data.lock().unwrap().node_id.clone();
        for (index, length) in [256 * 1024, 512 * 1024, 2 * 1024 * 1024]
            .into_iter()
            .enumerate()
        {
            let bytes: Vec<_> = (0..length).map(|i| (i % 251) as u8).collect();
            left.0
                .send_attachment_permitted(
                    &right_id,
                    "file",
                    attachment("test.bin", "file", &bytes),
                    bytes.clone(),
                    None,
                )
                .unwrap();
            wait(|| {
                right.0.data.lock().unwrap().messages.len() == index + 1
                    && left
                        .0
                        .data
                        .lock()
                        .unwrap()
                        .messages
                        .back()
                        .unwrap()
                        .delivery
                        == "delivered"
            });
            let id = right
                .0
                .data
                .lock()
                .unwrap()
                .messages
                .back()
                .unwrap()
                .id
                .clone();
            assert_eq!(right.0.read_attachment(&id).unwrap().1, bytes);
        }
        let loop_root = directory();
        let service = ExtensionLan::new(loop_root.path().into(), false);
        service
            .dispatch(
                "main",
                ID,
                Request::Loopback {
                    nickname: "回环测试".into(),
                },
            )
            .unwrap();
        let main = service.inner.entries.lock().unwrap()[ID].node.clone();
        let helper = main.loopback.lock().unwrap().as_ref().unwrap().clone();
        let helper_id = helper.data.lock().unwrap().node_id.clone();
        wait(|| main.runtime.lock().unwrap().connections.len() == 1);
        for (index, length) in [256 * 1024, 512 * 1024, 2 * 1024 * 1024]
            .into_iter()
            .enumerate()
        {
            let bytes: Vec<_> = (0..length).map(|i| (i % 251) as u8).collect();
            main.send_attachment_permitted(
                &helper_id,
                "file",
                attachment("test.bin", "file", &bytes),
                bytes.clone(),
                None,
            )
            .unwrap();
            wait(|| main.data.lock().unwrap().messages.len() == (index + 1) * 2);
            let id = main
                .data
                .lock()
                .unwrap()
                .messages
                .back()
                .unwrap()
                .id
                .clone();
            assert_eq!(main.read_attachment(&id).unwrap().1, bytes);
        }
    }
    #[test]
    fn raw_long_path_512k_loopback() {
        let _receivers = binary_receiver_test_guard();
        let owned = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let raw = owned
            .path()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_owned();
        let root = PathBuf::from(raw)
            .join("production-path-segment-a")
            .join("production-path-segment-b");
        let service = ExtensionLan::new(root, false);
        service
            .dispatch(
                "main",
                ID,
                Request::Loopback {
                    nickname: "长路径测试".into(),
                },
            )
            .unwrap();
        let main = service.inner.entries.lock().unwrap()[ID].node.clone();
        let helper = main.loopback.lock().unwrap().as_ref().unwrap().clone();
        let bytes: Vec<_> = (0..512 * 1024).map(|i| (i % 251) as u8).collect();
        let metadata = attachment("long-path.bin", "file", &bytes);
        #[cfg(windows)]
        {
            assert!(
                !helper
                    .attachment_root()
                    .to_string_lossy()
                    .starts_with(r"\\?\")
            );
            assert!(
                helper
                    .attachment_root()
                    .join(&metadata.sha256)
                    .as_os_str()
                    .len()
                    > 260
            );
        }
        let helper_id = helper.data.lock().unwrap().node_id.clone();
        wait(|| main.runtime.lock().unwrap().connections.len() == 1);
        main.send_attachment_permitted(&helper_id, "file", metadata, bytes.clone(), None)
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while main.data.lock().unwrap().messages.len() != 2 && Instant::now() < deadline {
            if let Some(error) = helper.last_error.lock().unwrap().clone() {
                panic!("helper failed: {error}");
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            main.data.lock().unwrap().messages.len(),
            2,
            "helper error: {:?}",
            helper.last_error.lock().unwrap()
        );
        let id = main
            .data
            .lock()
            .unwrap()
            .messages
            .back()
            .unwrap()
            .id
            .clone();
        assert_eq!(main.read_attachment(&id).unwrap().1, bytes);
    }
    #[test]
    fn loopback_uses_real_tcp_to_echo_text_stickers_images_and_files_and_reclaims_blobs() {
        let _receivers = binary_receiver_test_guard();
        let root = directory();
        let service = ExtensionLan::new(root.path().into(), false);
        let status = service
            .dispatch(
                "main",
                ID,
                Request::Loopback {
                    nickname: "测试用户".into(),
                },
            )
            .unwrap();
        assert_eq!(status["mode"], "loopback");
        assert_eq!(status["addresses"][0], "127.0.0.1");
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        let helper = node.loopback.lock().unwrap().as_ref().unwrap().clone();
        assert_eq!(
            status["loopbackPeerId"],
            helper.data.lock().unwrap().node_id
        );
        assert_ne!(
            node.runtime.lock().unwrap().port,
            helper.runtime.lock().unwrap().port
        );
        wait(|| node.runtime.lock().unwrap().connections.len() == 1);
        let peer_id = helper.data.lock().unwrap().node_id.clone();
        for request in [
            Request::Loopback {
                nickname: String::new(),
            },
            Request::Start {
                nickname: String::new(),
                port: None,
                mode: Some("lan".into()),
            },
        ] {
            assert!(service.dispatch("main", ID, request).is_err());
            assert_eq!(node.status().unwrap()["loopbackPeerId"], peer_id);
            assert!(!helper.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        }
        service
            .dispatch(
                "main",
                ID,
                Request::Send {
                    peer_id: peer_id.clone(),
                    text: "真实回环消息".into(),
                    kind: None,
                },
            )
            .unwrap();
        service
            .dispatch(
                "main",
                ID,
                Request::Send {
                    peer_id: peer_id.clone(),
                    text: "🎉".into(),
                    kind: Some("sticker".into()),
                },
            )
            .unwrap();
        let bytes = b"binary\0attachment\xffpayload".to_vec();
        node.send_attachment_permitted(
            &peer_id,
            "file",
            attachment("测试附件.bin", "file", &bytes),
            bytes.clone(),
            None,
        )
        .unwrap();
        let mut image = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(8, 6)
            .write_to(&mut image, image::ImageFormat::Png)
            .unwrap();
        let image = image.into_inner();
        node.send_attachment_permitted(
            &peer_id,
            "image",
            attachment("图片.png", "image", &image),
            image.clone(),
            None,
        )
        .unwrap();
        wait(|| {
            let data = node.data.lock().unwrap();
            data.messages.len() == 8
                && data
                    .messages
                    .iter()
                    .filter(|m| m.outgoing)
                    .all(|m| m.delivery == "delivered")
        });
        let messages = node.data.lock().unwrap().messages.clone();
        assert_eq!(messages.iter().filter(|m| m.kind == "sticker").count(), 2);
        let unique: BTreeSet<_> = messages.iter().map(|m| m.id.clone()).collect();
        assert_eq!(unique.len(), 8);
        for message in messages.iter().filter(|m| m.attachment.is_some()) {
            let (_, cached, _) = node.read_attachment(&message.id).unwrap();
            assert_eq!(
                cached,
                if message.kind == "image" {
                    image.clone()
                } else {
                    bytes.clone()
                }
            );
        }
        let image_message = messages.iter().find(|m| m.kind == "image").unwrap();
        let preview = service
            .dispatch(
                "main",
                ID,
                Request::PreviewAttachment {
                    message_id: image_message.id.clone(),
                },
            )
            .unwrap();
        assert!(
            preview["dataUrl"]
                .as_str()
                .unwrap()
                .starts_with("data:image/jpeg;base64,")
        );
        assert!(preview["dataUrl"].as_str().unwrap().len() <= 94 * 1024);
        assert_eq!(fs::read_dir(node.attachment_root()).unwrap().count(), 2);
        let reopened = Node::open(root.path(), ID).unwrap();
        assert_eq!(reopened.data.lock().unwrap().messages.len(), 8);
        service
            .dispatch("main", ID, Request::ClearHistory {})
            .unwrap();
        assert_eq!(fs::read_dir(node.attachment_root()).unwrap().count(), 0);
        service.dispatch("main", ID, Request::Stop {}).unwrap();
        assert!(helper.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        assert!(helper.data.lock().unwrap().messages.is_empty());
        assert_eq!(fs::read_dir(helper.attachment_root()).unwrap().count(), 0);
    }
    #[test]
    fn attachment_cache_checks_content_quota_and_existing_corruption_without_overwriting() {
        let root = directory();
        let node = Node::open(root.path(), ID).unwrap();
        for name in [
            "../secret",
            "x/y",
            "x\\y",
            "NUL.txt",
            "COM1.txt",
            "tail.",
            "\0x",
        ] {
            assert!(attachment_name(name).is_err(), "{name:?}");
        }
        assert!(attachment_name("项目说明 2026.pdf").is_ok());
        let bytes = b"expected";
        let metadata = attachment("note.txt", "file", bytes);
        assert!(
            node.store_attachment(&metadata, "file", b"different")
                .is_err()
        );
        let mut oversized = metadata.clone();
        oversized.bytes = MAX_FILE_ATTACHMENT + 1;
        assert!(oversized.validate("file").is_err());
        let invalid_image = attachment("bad.png", "image", bytes);
        assert!(validate_attachment_bytes(&invalid_image, "image", bytes).is_err());
        node.store_attachment(&metadata, "file", bytes).unwrap();
        let path = node.attachment_root().join(&metadata.sha256);
        fs::write(&path, b"tampered").unwrap();
        assert!(node.store_attachment(&metadata, "file", bytes).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"tampered");
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn corrupted_tcp_attachment_is_not_recorded_or_acknowledged() {
        let _receivers = binary_receiver_test_guard();
        let left_root = directory();
        let right_root = directory();
        let left = node(left_root.path(), "接收端");
        let right = node(right_root.path(), "发送端");
        right
            .0
            .connect("127.0.0.1", left.0.runtime.lock().unwrap().port)
            .unwrap();
        wait(|| {
            right.0.runtime.lock().unwrap().connections.len() == 1
                && left.0.runtime.lock().unwrap().connections.len() == 1
        });
        let left_id = left.0.data.lock().unwrap().node_id.clone();
        let writer = right.0.runtime.lock().unwrap().connections[&left_id]
            .stream
            .clone();
        let mut metadata = attachment("wrong.bin", "file", b"invalid");
        metadata.sha256 = "0".repeat(64);
        let message_id = token().unwrap();
        right
            .0
            .mutate(|data| {
                data.messages.push_back(Message {
                    id: message_id.clone(),
                    peer_id: left_id.clone(),
                    sender: data.node_id.clone(),
                    nickname: data.nickname.clone(),
                    text: String::new(),
                    at: now(),
                    outgoing: true,
                    delivery: "sent".into(),
                    kind: "file".into(),
                    attachment: Some(metadata.clone()),
                });
                Ok(())
            })
            .unwrap();
        {
            let mut stream = writer.lock().unwrap();
            write_frame(
                &mut stream,
                &Frame::Attachment {
                    id: message_id.clone(),
                    media_kind: "file".into(),
                    attachment: metadata,
                },
            )
            .unwrap();
            write_attachment_bytes(&mut stream, b"invalid", None, &AtomicBool::new(false)).unwrap();
        }
        wait(|| left.0.runtime.lock().unwrap().connections.is_empty());
        wait(|| right.0.runtime.lock().unwrap().connections.is_empty());
        assert!(left.0.data.lock().unwrap().messages.is_empty());
        assert!(
            fs::read_dir(left.0.attachment_root())
                .unwrap()
                .next()
                .is_none()
        );
        assert_eq!(
            right
                .0
                .data
                .lock()
                .unwrap()
                .messages
                .front()
                .unwrap()
                .delivery,
            "sent"
        );
        assert!(
            left.0
                .last_error
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .contains("checksum")
        );
    }
    #[test]
    fn old_text_history_is_read_without_rewrite_then_migrated_atomically() {
        let root = directory();
        let node = Node::open(root.path(), ID).unwrap();
        let peer_id = token().unwrap();
        node.mutate(|data| {
            data.contacts.insert(
                peer_id.clone(),
                Contact {
                    id: peer_id.clone(),
                    nickname: "旧朋友".into(),
                    address: "127.0.0.1".into(),
                    port: DEFAULT_PORT,
                    last_seen: now(),
                    unread: 1,
                },
            );
            data.messages.push_back(Message {
                id: token()?,
                peer_id: peer_id.clone(),
                sender: peer_id.clone(),
                nickname: "旧朋友".into(),
                text: "保留旧消息".into(),
                at: now(),
                outgoing: false,
                delivery: "received".into(),
                kind: "text".into(),
                attachment: None,
            });
            Ok(())
        })
        .unwrap();
        let mut old: Value = serde_json::from_slice(&fs::read(&node.path).unwrap()).unwrap();
        old["schemaVersion"] = 1.into();
        old["messages"][0].as_object_mut().unwrap().remove("kind");
        let original = serde_json::to_vec(&old).unwrap();
        fs::write(&node.path, &original).unwrap();
        let reopened = Node::open(root.path(), ID).unwrap();
        assert_eq!(fs::read(&node.path).unwrap(), original);
        assert_eq!(reopened.status().unwrap()["messages"][0]["kind"], "text");
        reopened.set_nickname("迁移后的昵称").unwrap();
        let migrated: Value = serde_json::from_slice(&fs::read(&node.path).unwrap()).unwrap();
        assert_eq!(migrated["schemaVersion"], 2);
        assert_eq!(migrated["messages"][0]["text"], "保留旧消息");
    }
    fn stream_fixture(root: &Path, bytes: usize) -> (tempfile::NamedTempFile, String) {
        let mut file = tempfile::Builder::new()
            .prefix("stream-")
            .suffix(".bin")
            .tempfile_in(root)
            .unwrap();
        let mut hash = Sha256::new();
        let chunk: Vec<_> = (0..attachment_io::CHUNK).map(|i| (i % 251) as u8).collect();
        let mut remaining = bytes;
        while remaining != 0 {
            let count = remaining.min(chunk.len());
            file.write_all(&chunk[..count]).unwrap();
            hash.update(&chunk[..count]);
            remaining -= count;
        }
        file.flush().unwrap();
        (file, format!("{:x}", hash.finalize()))
    }
    #[test]
    fn streaming_16m_loopback_import_receive_and_long_path_save_are_verified() {
        let _receivers = binary_receiver_test_guard();
        let owned = tempfile::tempdir_in(std::env::temp_dir()).unwrap();
        let root = PathBuf::from(
            owned
                .path()
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_owned(),
        )
        .join("production-path-segment-a")
        .join("production-path-segment-b");
        fs::create_dir_all(&root).unwrap();
        let service = ExtensionLan::new(root.clone(), false);
        let status = service
            .dispatch(
                "main",
                ID,
                Request::Loopback {
                    nickname: "流式回环".into(),
                },
            )
            .unwrap();
        assert_eq!(status["fileAttachmentLimit"], MAX_FILE_ATTACHMENT);
        assert_eq!(status["imageAttachmentLimit"], MAX_IMAGE_ATTACHMENT);
        let main = service.inner.entries.lock().unwrap()[ID].node.clone();
        wait(|| main.runtime.lock().unwrap().connections.len() == 1);
        let peer = status["loopbackPeerId"].as_str().unwrap();
        let (source, hash) = stream_fixture(&root, 16 * 1024 * 1024);
        let mut cached = main
            .import_attachment(source.path(), "file", None, None)
            .unwrap();
        assert_eq!(cached.attachment.sha256, hash);
        main.send_cached_permitted(peer, &mut cached, None).unwrap();
        let helper = main.loopback.lock().unwrap().as_ref().unwrap().clone();
        // This verifies streamed bytes and persistence, not a small-message latency budget.
        let deadline = Instant::now() + ATTACHMENT_TIMEOUT;
        while main.data.lock().unwrap().messages.len() != 2 {
            let main_error = main.last_error.lock().unwrap().clone();
            let helper_error = helper.last_error.lock().unwrap().clone();
            assert!(
                main_error.is_none(),
                "attachment receiver failed: {main_error:?}"
            );
            assert!(
                helper_error.is_none(),
                "loopback helper failed: {helper_error:?}"
            );
            assert!(
                Instant::now() < deadline,
                "streamed attachment did not finish"
            );
            thread::sleep(Duration::from_millis(10));
        }
        let id = main
            .data
            .lock()
            .unwrap()
            .messages
            .back()
            .unwrap()
            .id
            .clone();
        let mut received = main.cached_attachment(&id, None).unwrap();
        assert_eq!(received.attachment.bytes, 16 * 1024 * 1024);
        assert_eq!(received.attachment.sha256, hash);
        let store =
            crate::extensions::ExtensionStore::new(owned.path().join("extension-store"), false);
        let activity = store
            .begin_service(store.window_run_token("save-test".into()).unwrap())
            .unwrap();
        let permit = ServicePermit::for_test(activity);
        let destination = root
            .join("long-save-parent-segment-one")
            .join("long-save-parent-segment-two")
            .join("long-save-parent-segment-three");
        fs::create_dir_all(&destination).unwrap();
        let destination = destination.join("saved-attachment.bin");
        attachment_io::save(&mut received, &destination, &permit).unwrap();
        let mut saved = fs::File::open(&destination).unwrap();
        let mut actual = Sha256::new();
        let mut chunk = [0_u8; attachment_io::CHUNK];
        loop {
            let count = saved.read(&mut chunk).unwrap();
            if count == 0 {
                break;
            }
            actual.update(&chunk[..count]);
        }
        assert_eq!(format!("{:x}", actual.finalize()), hash);
        assert!(fs::read_dir(main.attachment_root()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".part")
        }));
        drop(permit);
        store.wait_stopped();
    }
    #[test]
    fn simultaneous_consecutive_binary_sends_do_not_block_peer_readers_on_acknowledgements() {
        let _receivers = binary_receiver_test_guard();
        let left_root = directory();
        let right_root = directory();
        let left = node(left_root.path(), "左");
        let right = node(right_root.path(), "右");
        left.0
            .connect("127.0.0.1", right.0.runtime.lock().unwrap().port)
            .unwrap();
        wait(|| {
            left.0.runtime.lock().unwrap().connections.len() == 1
                && right.0.runtime.lock().unwrap().connections.len() == 1
        });
        let left_id = left.0.data.lock().unwrap().node_id.clone();
        let right_id = right.0.data.lock().unwrap().node_id.clone();
        let (left_source, _) = stream_fixture(left_root.path(), 2 * 1024 * 1024);
        let (right_source, _) = stream_fixture(right_root.path(), 2 * 1024 * 1024);
        let mut left_cached = left
            .0
            .import_attachment(left_source.path(), "file", None, None)
            .unwrap();
        let mut right_cached = right
            .0
            .import_attachment(right_source.path(), "file", None, None)
            .unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let first = left.0.clone();
        let ready = barrier.clone();
        let a = thread::spawn(move || {
            ready.wait();
            for _ in 0..3 {
                first
                    .send_cached_permitted(&right_id, &mut left_cached, None)
                    .unwrap();
            }
        });
        let second = right.0.clone();
        let b = thread::spawn(move || {
            barrier.wait();
            for _ in 0..3 {
                second
                    .send_cached_permitted(&left_id, &mut right_cached, None)
                    .unwrap();
            }
        });
        a.join().unwrap();
        b.join().unwrap();
        wait(|| {
            [left.0.clone(), right.0.clone()].iter().all(|node| {
                let data = node.data.lock().unwrap();
                data.messages.len() == 6
                    && data
                        .messages
                        .iter()
                        .filter(|m| m.outgoing)
                        .all(|m| m.delivery == "delivered")
            })
        });
    }
    #[test]
    fn incomplete_stream_cleans_part_file_and_preserves_existing_history() {
        let _receivers = binary_receiver_test_guard();
        let left_root = directory();
        let right_root = directory();
        let left = node(left_root.path(), "接收");
        let right = node(right_root.path(), "发送");
        right
            .0
            .connect("127.0.0.1", left.0.runtime.lock().unwrap().port)
            .unwrap();
        wait(|| {
            left.0.runtime.lock().unwrap().connections.len() == 1
                && right.0.runtime.lock().unwrap().connections.len() == 1
        });
        let left_id = left.0.data.lock().unwrap().node_id.clone();
        let right_id = right.0.data.lock().unwrap().node_id.clone();
        right.0.send(&left_id, "保留原消息").unwrap();
        wait(|| left.0.data.lock().unwrap().messages.len() == 1);
        let original = fs::read(&left.0.path).unwrap();
        let writer = right.0.runtime.lock().unwrap().connections[&left_id]
            .stream
            .clone();
        let partial = vec![7; 256 * 1024];
        let metadata = Attachment {
            name: "partial.bin".into(),
            mime: "application/octet-stream".into(),
            bytes: 2 * 1024 * 1024,
            sha256: "a".repeat(64),
        };
        {
            let mut stream = writer.lock().unwrap();
            write_frame(
                &mut stream,
                &Frame::Attachment {
                    id: token().unwrap(),
                    media_kind: "file".into(),
                    attachment: metadata,
                },
            )
            .unwrap();
            write_attachment_bytes(&mut stream, &partial, None, &AtomicBool::new(false)).unwrap();
            let receiving_deadline = Instant::now() + FRAME_TIMEOUT;
            loop {
                let has_received_bytes =
                    fs::read_dir(left.0.attachment_root())
                        .ok()
                        .is_some_and(|entries| {
                            entries.filter_map(Result::ok).any(|entry| {
                                let name = entry.file_name().to_string_lossy().into_owned();
                            if !name.starts_with(".lan-") || !name.ends_with(".part") { return false; }
                            let directory_length = entry.metadata().ok().map(|metadata| metadata.len());
                            let Ok(mut file) = fs::File::open(entry.path()) else { return false; };
                            let mut first_byte = [0_u8; 1];
                            if file.read_exact(&mut first_byte).is_err() || first_byte != [7] { return false; }
                            if directory_length == Some(0) {
                                eprintln!("Partial body is readable although directory length is zero; handle length={:?}", file.metadata().ok().map(|metadata| metadata.len()));
                            }
                            true
                            })
                        });
                if has_received_bytes {
                    break;
                }
                let last_error = left.0.last_error.lock().unwrap().clone();
                assert!(
                    last_error.is_none() && Instant::now() < receiving_deadline,
                    "Receiver never staged the partial body; lastError={last_error:?}"
                );
                thread::sleep(Duration::from_millis(5));
            }
            stream.shutdown(Shutdown::Both).unwrap();
        }
        wait(|| {
            !left
                .0
                .runtime
                .lock()
                .unwrap()
                .connections
                .contains_key(&right_id)
        });
        assert_eq!(fs::read(&left.0.path).unwrap(), original);
        assert!(
            fs::read_dir(left.0.attachment_root())
                .unwrap()
                .next()
                .is_none()
        );
        Node::open(left_root.path(), ID).unwrap();
    }
    #[test]
    fn stop_interrupts_a_saturated_file_sender_before_waiting_for_its_operation_lock() {
        let root = directory();
        let service = Arc::new(ExtensionLan::new(root.path().into(), false));
        service.dispatch("main", ID, Request::Status {}).unwrap();
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        let operation = node.operation.lock().unwrap();
        let reading = service.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let status = thread::spawn(move || {
            tx.send(reading.dispatch("main", ID, Request::Status {}))
                .unwrap();
        });
        assert!(rx.recv_timeout(Duration::from_secs(1)).unwrap().is_ok());
        drop(operation);
        status.join().unwrap();
        node.start("测试", Ipv4Addr::LOCALHOST.into(), 0).unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        node.connect("127.0.0.1", port).unwrap();
        let (mut stalled, _) = listener.accept().unwrap();
        stalled.set_nonblocking(true).unwrap();
        let peer = token().unwrap();
        write_frame(
            &mut stalled,
            &Frame::Hello {
                version: 2,
                node_id: peer.clone(),
                nickname: "不读取正文的对端".into(),
                port,
            },
        )
        .unwrap();
        wait(|| node.runtime.lock().unwrap().connections.contains_key(&peer));
        let receiving = AtomicBool::new(false);
        let hello_deadline = Instant::now() + FRAME_TIMEOUT;
        let hello = loop {
            if let Some(frame) = read_frame(&mut stalled, &receiving).unwrap() {
                break frame;
            }
            assert!(Instant::now() < hello_deadline);
        };
        assert!(matches!(hello, Frame::Hello { version: 2, .. }));
        let (source, _) = stream_fixture(root.path(), 64 * 1024 * 1024);
        let mut cached = node
            .import_attachment(source.path(), "file", None, None)
            .unwrap();
        let old_stop = node.runtime.lock().unwrap().stop.clone();
        let sender = node.clone();
        let (finished_tx, finished_rx) = std::sync::mpsc::channel();
        let sending = thread::spawn(move || {
            let _operation = sender.operation.lock().unwrap();
            let result = sender.send_cached_permitted(&peer, &mut cached, None);
            finished_tx.send(()).unwrap();
            result
        });
        let header_deadline = Instant::now() + FRAME_TIMEOUT;
        let header = loop {
            if let Some(frame) = read_frame(&mut stalled, &receiving).unwrap() {
                break frame;
            }
            assert!(Instant::now() < header_deadline);
        };
        assert!(matches!(
            header,
            Frame::Attachment {
                attachment: Attachment {
                    bytes: 67_108_864,
                    ..
                },
                ..
            }
        ));
        let mut first_body_chunk = [0_u8; attachment_io::CHUNK];
        assert!(read_bytes(&mut stalled, &mut first_body_chunk, &receiving, false).unwrap());
        assert_eq!(
            &first_body_chunk[..251],
            &(0..251).map(|i| i as u8).collect::<Vec<_>>()
        );
        // 对端实际收到正文后停止消费，等待仍未完成，确保 Stop 命中有背压的发送阶段。
        assert_eq!(
            finished_rx
                .recv_timeout(Duration::from_millis(200))
                .unwrap_err(),
            std::sync::mpsc::RecvTimeoutError::Timeout
        );
        let start = Instant::now();
        service.dispatch("main", ID, Request::Stop {}).unwrap();
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(
            sending.join().unwrap().unwrap_err().code,
            ErrorCode::ExtensionTransferInterrupted
        );
        let restarted = service
            .dispatch(
                "main",
                ID,
                Request::Loopback {
                    nickname: "重启后的会话".into(),
                },
            )
            .unwrap();
        let new_peer = restarted["loopbackPeerId"].as_str().unwrap();
        wait(|| {
            node.runtime
                .lock()
                .unwrap()
                .connections
                .contains_key(new_peer)
        });
        let mut old_selection = node
            .import_attachment(source.path(), "file", None, None)
            .unwrap();
        let before = node.data.lock().unwrap().messages.len();
        assert_eq!(
            node.send_cached_for_session(new_peer, &mut old_selection, Some(&old_stop), None)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionTransferInterrupted
        );
        assert_eq!(node.data.lock().unwrap().messages.len(), before);
    }
    #[test]
    fn preferred_reconnection_and_stop_do_not_wait_for_the_previous_writer() {
        let root = directory();
        let service = ExtensionLan::new(root.path().into(), false);
        service.dispatch("main", ID, Request::Status {}).unwrap();
        let node = service.inner.entries.lock().unwrap()[ID].node.clone();
        node.mutate(|data| {
            data.node_id = "8".repeat(32);
            Ok(())
        })
        .unwrap();
        node.start("本机", Ipv4Addr::LOCALHOST.into(), 0).unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let peer = "1".repeat(32);
        let peer_port = listener.local_addr().unwrap().port();
        node.connect("127.0.0.1", peer_port).unwrap();
        let (mut old_remote, _) = listener.accept().unwrap();
        old_remote.set_nonblocking(true).unwrap();
        write_frame(
            &mut old_remote,
            &Frame::Hello {
                version: 2,
                node_id: peer.clone(),
                nickname: "旧通道".into(),
                port: peer_port,
            },
        )
        .unwrap();
        wait(|| node.runtime.lock().unwrap().connections.contains_key(&peer));
        let (old_id, old_writer) = {
            let runtime = node.runtime.lock().unwrap();
            let connection = &runtime.connections[&peer];
            assert!(!connection.preferred);
            (connection.id.clone(), connection.stream.clone())
        };
        // 固定长附件发送占用 writer 的阶段，重连和停止仍须能通过独立句柄回收它。
        let old_sending = old_writer.lock().unwrap();
        let port = node.runtime.lock().unwrap().port;
        let mut replacement = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        replacement.set_nonblocking(true).unwrap();
        write_frame(
            &mut replacement,
            &Frame::Hello {
                version: 2,
                node_id: peer.clone(),
                nickname: "新通道".into(),
                port: peer_port,
            },
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut replaced = false;
        while Instant::now() < deadline {
            if let Ok(runtime) = node.runtime.try_lock()
                && runtime
                    .connections
                    .get(&peer)
                    .is_some_and(|connection| connection.id != old_id && connection.preferred)
            {
                replaced = true;
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }
        if !replaced {
            drop(old_sending);
            panic!(
                "Preferred reconnection waited for the previous writer while holding the runtime lock"
            );
        }
        assert_eq!(
            service.dispatch("main", ID, Request::Status {}).unwrap()["running"],
            true
        );
        let stopped_at = Instant::now();
        service.dispatch("main", ID, Request::Stop {}).unwrap();
        assert!(stopped_at.elapsed() < Duration::from_secs(2));
        drop(old_sending);
    }
    #[test]
    fn late_handshake_and_profile_cannot_overwrite_a_replacement_contact() {
        let first_root = directory();
        let second_root = directory();
        let first = node(first_root.path(), "本机");
        let second = node(second_root.path(), "旧资料");
        let peer = second.0.data.lock().unwrap().node_id.clone();
        first
            .0
            .connect("127.0.0.1", second.0.runtime.lock().unwrap().port)
            .unwrap();
        wait(|| first.0.data.lock().unwrap().contacts.contains_key(&peer));
        let old_id = first.0.runtime.lock().unwrap().connections[&peer]
            .id
            .clone();
        let new_id = token().unwrap();
        first
            .0
            .runtime
            .lock()
            .unwrap()
            .connections
            .get_mut(&peer)
            .unwrap()
            .id = new_id.clone();
        // 旧握手/资料帧已读出，随后新通道先发布并保存资料；迟到写入必须重新核对代次。
        first
            .0
            .remember_peer(
                &peer,
                &new_id,
                "新握手".into(),
                "192.168.1.22".parse().unwrap(),
                45874,
            )
            .unwrap();
        first
            .0
            .update_peer_profile(&peer, &new_id, "新资料")
            .unwrap();
        let original = fs::read(&first.0.path).unwrap();
        assert_eq!(
            first
                .0
                .remember_peer(
                    &peer,
                    &old_id,
                    "旧握手".into(),
                    Ipv4Addr::LOCALHOST.into(),
                    DEFAULT_PORT
                )
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(
            first
                .0
                .update_peer_profile(&peer, &old_id, "旧资料")
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(fs::read(&first.0.path).unwrap(), original);
        let status = first.0.status().unwrap();
        assert_eq!(status["peers"][0]["nickname"], "新资料");
        assert_eq!(status["peers"][0]["address"], "192.168.1.22");
        assert_eq!(status["peers"][0]["port"], 45874);
        assert_eq!(status["peers"][0]["connected"], true);
        assert!(first.0.last_error.lock().unwrap().is_none());
    }
}
