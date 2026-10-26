//! 纯文本局域网聊天 broker。固定协议、有界 TCP 和本地历史，不提供文件或 Shell 能力。
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
use tauri::Manager;

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
const FRAME_TIMEOUT: Duration = Duration::from_secs(3);

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
            schema_version: 1,
            extension_id: id.into(),
            node_id: token()?,
            nickname: "局域网朋友".into(),
            contacts: BTreeMap::new(),
            messages: VecDeque::new(),
        })
    }
    fn validate(&self, id: &str) -> NativeResult<()> {
        if self.schema_version != 1 {
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
                || text(&message.text).is_err()
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

struct Connection {
    id: String,
    stream: Arc<Mutex<TcpStream>>,
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
            if header.schema_version != 1 {
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
        Ok(Arc::new(Self {
            root: root.into(),
            path,
            data: Mutex::new(data),
            runtime: Mutex::new(Runtime::default()),
            operation: Mutex::new(()),
            retired: AtomicBool::new(false),
            last_error: Mutex::new(None),
            send_times: Mutex::new(VecDeque::new()),
            receive_times: Mutex::new(VecDeque::new()),
        }))
    }
    fn encoded(&self, data: &Document) -> NativeResult<Vec<u8>> {
        checked_root(&self.root)?;
        checked_file(&self.path)?;
        let bytes = serde_json::to_vec(data).map_err(|_| io_error("Cannot encode LAN history"))?;
        if bytes.len() > MAX_DISK {
            return Err(invalid("LAN history exceeds its storage limit"));
        }
        Ok(bytes)
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
        let result = edit(&mut next)?;
        while next.messages.len() > MAX_HISTORY {
            next.messages.pop_front();
        }
        let mut encoded_size = serde_json::to_vec(&next)
            .map_err(|_| io_error("Cannot encode LAN history"))?
            .len();
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
        let bytes = self.encoded(&next)?;
        commit_permit(permit, || {
            atomic_write(&self.path, &bytes)?;
            *data = next;
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
        if !valid_token(id) {
            return Err(invalid("LAN peer sent an invalid message identity"));
        }
        text(&content)?;
        self.mutate(|data| {
            // 已读到的帧也可能晚于连接替换或联系人删除，须在持 data 锁的写入链重新核对。
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            if !runtime
                .connections
                .get(peer_id)
                .is_some_and(|connection| connection.id == connection_id)
            {
                return Err(unavailable("LAN connection was replaced or closed"));
            }
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
        Ok(
            json!({ "running": !runtime.stop.load(Ordering::Acquire), "nickname": data.nickname, "nodeId": data.node_id, "port": runtime.port, "addresses": if runtime.address.is_empty() { vec![default_address().to_string()] } else { vec![runtime.address.clone()] }, "peers": peers, "messages": data.messages, "historyLimit": MAX_HISTORY, "lastError": self.last_error.lock().ok().and_then(|v| v.clone()), "encrypted": false }),
        )
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
    fn stop_permitted(&self, permit: Option<&ServicePermit>) -> NativeResult<()> {
        let mut previous = {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            commit_permit(permit, || {
                runtime.stop.store(true, Ordering::Release);
                Ok(std::mem::take(&mut *runtime))
            })?
        };
        for connection in previous.connections.values() {
            if let Ok(stream) = connection.stream.lock() {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
        if let Some(listener) = previous.listener.take() {
            let _ = listener.join();
        }
        for worker in previous.workers {
            let _ = worker.join();
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
                    version: 1,
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
            version: 1,
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
                if let Ok(stream) = existing.stream.lock() {
                    let _ = stream.shutdown(Shutdown::Both);
                }
            } else if runtime.connections.len() >= MAX_CONNECTIONS {
                return Err(unavailable("LAN session reached its connection limit"));
            }
            runtime.connections.insert(
                peer_id.clone(),
                Connection {
                    id: connection_id.clone(),
                    stream: writer.clone(),
                    preferred,
                },
            );
        }
        let result = (|| {
            self.mutate(|data| {
                if !data.contacts.contains_key(&peer_id) && data.contacts.len() >= MAX_CONTACTS {
                    return Err(unavailable("LAN contact limit reached"));
                }
                let unread = data
                    .contacts
                    .get(&peer_id)
                    .map_or(0, |contact| contact.unread);
                data.contacts.insert(
                    peer_id.clone(),
                    Contact {
                        id: peer_id.clone(),
                        nickname: peer_name.clone(),
                        address: remote.ip().to_string(),
                        port: peer_port,
                        last_seen: now(),
                        unread,
                    },
                );
                Ok(())
            })?;
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
                        self.receive_message(&peer_id, &connection_id, &id, content)?;
                        let mut stream = writer
                            .lock()
                            .map_err(|_| unavailable("LAN sender is unavailable"))?;
                        write_frame(&mut stream, &Frame::Ack { id })?;
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
                        let name = nickname(&name)?;
                        self.mutate(|data| {
                            if let Some(contact) = data.contacts.get_mut(&peer_id) {
                                contact.nickname = name;
                                contact.last_seen = now();
                            }
                            Ok(())
                        })?;
                    }
                    Frame::Hello { .. } => return Err(invalid("LAN peer repeated its handshake")),
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
        check_permit(permit)?;
        text(content)?;
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
        let writer = self
            .runtime
            .lock()
            .map_err(|_| unavailable("LAN session is unavailable"))?
            .connections
            .get(peer_id)
            .map(|v| v.stream.clone())
            .ok_or_else(|| unavailable("This LAN contact is not connected"))?;
        let id = token()?;
        self.mutate_permitted(permit, |data| {
            data.messages.push_back(Message {
                id: id.clone(),
                peer_id: peer_id.into(),
                sender: data.node_id.clone(),
                nickname: data.nickname.clone(),
                text: content.into(),
                at: now(),
                outgoing: true,
                delivery: "sent".into(),
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
                    &Frame::Message {
                        id: id.clone(),
                        text: content.into(),
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
    fn dispatch_guarded(
        &self,
        owner: &str,
        id: &str,
        request: Request,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<Value> {
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
            Request::Start { nickname, port } => {
                let port = port.unwrap_or(DEFAULT_PORT);
                if port == 0 {
                    return Err(invalid("LAN port must be nonzero"));
                }
                node.start_permitted(&nickname, default_address().into(), port, permit)?;
            }
            Request::Stop {} => node.stop_permitted(permit)?,
            Request::Connect { address, port } => {
                node.connect_permitted(&address, port.unwrap_or(DEFAULT_PORT), permit)?
            }
            Request::Send { peer_id, text } => node.send_permitted(&peer_id, &text, permit)?,
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
        ExtensionLan { inner: state }.dispatch_permitted(&owner, &id, request, &permit)
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
        let fill = [0_u8; 64 * 1024];
        for pass in 0..2 {
            let mut full = false;
            for _ in 0..1024 {
                match sender.write(&fill) {
                    Ok(_) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        full = true;
                        break;
                    }
                    Err(error) => panic!("Cannot fill loopback send buffer: {error}"),
                }
            }
            assert!(full, "Loopback send buffer never reached backpressure");
            if pass == 0 {
                thread::sleep(Duration::from_millis(30));
            }
        }
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = thread::spawn(move || {
            started_tx.send(()).unwrap();
            let result = write_frame_permitted(
                &mut sender,
                &Frame::Message {
                    id: token().unwrap(),
                    text: "x".repeat(MAX_TEXT),
                },
                Some(&permit),
                Instant::now() + Duration::from_secs(2),
            );
            done_tx.send(result).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(
            done_rx.recv_timeout(Duration::from_millis(30)).is_err(),
            "A saturated TCP writer should be waiting outside commit"
        );
        let closing = Instant::now();
        store.begin_window_close("main").unwrap();
        assert!(
            closing.elapsed() < Duration::from_millis(250),
            "TCP backpressure blocked the window lifecycle mutex"
        );
        assert_eq!(
            done_rx
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .unwrap_err()
                .code,
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
            },
            Request::Connect {
                address: "127.0.0.1".into(),
                port: Some(port),
            },
            Request::Send {
                peer_id: token().unwrap(),
                text: "不能发送".into(),
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
        let root = directory();
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
        service.close_window("first");
        assert!(!node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        service.close_window("second");
        assert!(node.retired.load(Ordering::Acquire));
        assert!(node.runtime.lock().unwrap().stop.load(Ordering::Acquire));
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
        let status = service.dispatch("third", ID, Request::Status {}).unwrap();
        assert_eq!(status["nickname"], "保留昵称");
        assert_eq!(status["running"], false);
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
        node.runtime.lock().unwrap().connections.insert(
            peer_id.clone(),
            Connection {
                id: first_id.clone(),
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
        node.runtime.lock().unwrap().connections.insert(
            peer_id.clone(),
            Connection {
                id: second_id.clone(),
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
            for _ in 0..600 {
                data.messages.push_back(Message {
                    id: token()?,
                    peer_id: peer_id.clone(),
                    sender: data.node_id.clone(),
                    nickname: data.nickname.clone(),
                    text: "x\t".repeat(MAX_TEXT / 2),
                    at: now(),
                    outgoing: true,
                    delivery: "sent".into(),
                });
            }
            Ok(())
        })
        .unwrap();
        let data = node.data.lock().unwrap();
        assert!(data.messages.len() < MAX_HISTORY);
        assert!(!data.messages.is_empty());
        assert!(fs::metadata(&node.path).unwrap().len() <= MAX_DISK as u64);
        data.validate(ID).unwrap();
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
}
