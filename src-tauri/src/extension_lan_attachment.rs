//! LAN 附件的有界磁盘与流式 I/O；不向插件提供文件路径。
use super::*;
use std::io::{Seek, SeekFrom};

pub(super) const CHUNK: usize = 64 * 1024;
const IDLE_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
static RECEIVERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

pub(super) fn interrupted(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionTransferInterrupted, message)
}
pub(super) fn too_large(kind: &str) -> NativeError {
    NativeError::new(
        ErrorCode::ExtensionAttachmentTooLarge,
        if kind == "image" {
            "Images must be nonempty and no larger than 8 MiB"
        } else {
            "Files must be nonempty and no larger than 1 GiB"
        },
    )
}
fn cache_full() -> NativeError {
    NativeError::new(
        ErrorCode::ExtensionAttachmentCacheFull,
        "LAN attachment cache is full; clear chat history before transferring more files",
    )
}
fn capacity(used: u64, reserved: u64, requested: u64) -> NativeResult<()> {
    if used
        .checked_add(reserved)
        .and_then(|v| v.checked_add(requested))
        .is_none_or(|v| v > MAX_ATTACHMENTS_DISK)
    {
        return Err(cache_full());
    }
    Ok(())
}
struct Clock {
    started: Instant,
    progress: Instant,
}
impl Clock {
    fn new() -> Self {
        let at = Instant::now();
        Self {
            started: at,
            progress: at,
        }
    }
    fn check(&self, permit: Option<&ServicePermit>, stop: Option<&AtomicBool>) -> NativeResult<()> {
        check_permit(permit)?;
        if stop.is_some_and(|stop| stop.load(Ordering::Acquire)) {
            return Err(interrupted("LAN transfer was stopped"));
        }
        if self.started.elapsed() >= TOTAL_TIMEOUT || self.progress.elapsed() >= IDLE_TIMEOUT {
            return Err(NativeError::new(
                ErrorCode::ExtensionTimeout,
                "LAN transfer timed out",
            ));
        }
        Ok(())
    }
    fn progress(&mut self) {
        self.progress = Instant::now();
    }
}
fn copy_body(
    reader: &mut impl Read,
    writer: &mut impl Write,
    length: usize,
    permit: Option<&ServicePermit>,
    stop: Option<&AtomicBool>,
    network: bool,
) -> NativeResult<String> {
    let mut clock = Clock::new();
    let mut hash = Sha256::new();
    let mut remaining = length;
    let mut chunk = [0_u8; CHUNK];
    while remaining != 0 {
        clock.check(permit, stop)?;
        let count = remaining.min(CHUNK);
        match reader.read(&mut chunk[..count]) {
            Ok(0) => {
                return Err(interrupted(
                    "LAN attachment ended before its declared length",
                ));
            }
            Ok(count) => {
                writer
                    .write_all(&chunk[..count])
                    .map_err(|_| io_error("Cannot write LAN attachment temporary file"))?;
                hash.update(&chunk[..count]);
                remaining -= count;
                clock.progress();
            }
            Err(error)
                if network
                    && matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
            {
                thread::sleep(Duration::from_millis(5))
            }
            Err(_) => return Err(interrupted("Cannot read LAN attachment content")),
        }
    }
    if !network {
        let mut extra = [0_u8; 1];
        if reader
            .read(&mut extra)
            .map_err(|_| interrupted("Cannot verify LAN attachment length"))?
            != 0
        {
            return Err(interrupted(
                "LAN attachment changed while it was being read",
            ));
        }
    }
    clock.check(permit, stop)?;
    Ok(format!("{:x}", hash.finalize()))
}
fn verify_file(
    file: &mut fs::File,
    attachment: &Attachment,
    permit: Option<&ServicePermit>,
    stop: Option<&AtomicBool>,
) -> NativeResult<()> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| io_error("Cannot read cached LAN attachment"))?;
    let sha = copy_body(
        file,
        &mut std::io::sink(),
        attachment.bytes,
        permit,
        stop,
        false,
    )?;
    if sha != attachment.sha256 {
        return Err(interrupted(
            "LAN attachment checksum is invalid; existing data was preserved",
        ));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| io_error("Cannot rewind cached LAN attachment"))?;
    Ok(())
}
fn image_bytes(file: &mut fs::File, attachment: &Attachment) -> NativeResult<Vec<u8>> {
    if attachment.bytes > MAX_IMAGE_ATTACHMENT {
        return Err(too_large("image"));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| io_error("Cannot read LAN image"))?;
    let mut bytes = Vec::new();
    Read::by_ref(file)
        .take(MAX_IMAGE_ATTACHMENT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| io_error("Cannot read LAN image"))?;
    if bytes.len() != attachment.bytes {
        return Err(interrupted("LAN image length is invalid"));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|_| io_error("Cannot rewind LAN image"))?;
    Ok(bytes)
}

#[derive(Default)]
pub(super) struct AttachmentCache {
    reserved: u64,
    pins: BTreeMap<String, usize>,
    releases: Arc<Mutex<Vec<(String, u64)>>>,
}
impl AttachmentCache {
    fn drain_releases(&mut self) {
        if let Ok(mut releases) = self.releases.lock() {
            for (sha, reserved) in releases.drain(..) {
                self.reserved = self.reserved.saturating_sub(reserved);
                if let Some(count) = self.pins.get_mut(&sha) {
                    *count -= 1;
                    if *count == 0 {
                        self.pins.remove(&sha);
                    }
                }
            }
        }
    }
}
struct Pin {
    releases: Arc<Mutex<Vec<(String, u64)>>>,
    sha: String,
    reserved: u64,
}
impl Drop for Pin {
    fn drop(&mut self) {
        if let Ok(mut releases) = self.releases.lock() {
            releases.push((self.sha.clone(), self.reserved));
        }
    }
}
enum StageFile {
    Existing(fs::File),
    Temporary(tempfile::NamedTempFile),
}
struct Stage {
    attachment: Attachment,
    kind: String,
    file: StageFile,
    root: PathBuf,
    pin: Pin,
}
pub(super) struct CachedAttachment {
    pub(super) attachment: Attachment,
    pub(super) kind: String,
    pub(super) file: fs::File,
    _pin: Pin,
}
impl Stage {
    fn file(&mut self) -> &mut fs::File {
        match &mut self.file {
            StageFile::Existing(file) => file,
            StageFile::Temporary(file) => file.as_file_mut(),
        }
    }
    fn validate(
        &mut self,
        permit: Option<&ServicePermit>,
        stop: Option<&AtomicBool>,
    ) -> NativeResult<()> {
        if let StageFile::Temporary(file) = &self.file {
            file.as_file()
                .sync_all()
                .map_err(|_| io_error("Cannot flush LAN attachment"))?;
        }
        let attachment = self.attachment.clone();
        verify_file(self.file(), &attachment, permit, stop)?;
        if self.kind == "image" {
            let bytes = image_bytes(self.file(), &attachment)?;
            crate::extension_resources::bounded_render_image(&bytes, &attachment.mime, true)?;
        }
        Ok(())
    }
}
impl Stage {
    fn publish(mut self, cache: &mut AttachmentCache) -> NativeResult<CachedAttachment> {
        let path = self.root.join(&self.attachment.sha256);
        let file = match self.file {
            StageFile::Existing(file) => file,
            StageFile::Temporary(file) => match file.persist_noclobber(&path) {
                Ok(file) => file,
                Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err(interrupted(
                        "LAN cache changed during transfer; existing data was preserved, retry the attachment",
                    ));
                }
                Err(_) => return Err(io_error("Cannot commit LAN attachment")),
            },
        };
        cache.reserved = cache.reserved.saturating_sub(self.pin.reserved);
        self.pin.reserved = 0;
        Ok(CachedAttachment {
            attachment: self.attachment,
            kind: self.kind,
            file,
            _pin: self.pin,
        })
    }
}

impl Node {
    fn cache_root(&self) -> NativeResult<PathBuf> {
        let root = self.path.with_extension("attachments");
        checked_root(&root)?;
        // tempfile 的 Windows persist 直接调用 Win32；temp 和 target 都须使用 verbatim 路径。
        fs::canonicalize(root).map_err(|_| io_error("Cannot resolve LAN attachment directory"))
    }
    fn stage(&self, attachment: Attachment, kind: &str) -> NativeResult<Stage> {
        attachment.validate(kind)?;
        let root = self.cache_root()?;
        let path = root.join(&attachment.sha256);
        // 只在新增 blob 前回收；已有附件的预览 / 另存不需要扫描整个缓存。
        // 此处只是提示，取得 cache 锁后仍重新检查目标，避免把检查结果当作租约。
        if matches!(fs::symlink_metadata(&path), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
        {
            self.reclaim_attachments();
        }
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        let existing = match fs::symlink_metadata(&path) {
            Ok(metadata)
                if metadata.is_file()
                    && !linked(&metadata)
                    && metadata.len() == attachment.bytes as u64 =>
            {
                Some(
                    fs::File::open(&path)
                        .map_err(|_| io_error("Cannot open cached LAN attachment"))?,
                )
            }
            Ok(_) => {
                return Err(interrupted(
                    "Existing LAN attachment is invalid; original data was preserved",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(io_error("Cannot inspect LAN attachment cache")),
        };
        let reserved = if existing.is_some() {
            0
        } else {
            attachment.bytes as u64
        };
        if existing.is_none() {
            let mut used = 0_u64;
            for entry in
                fs::read_dir(&root).map_err(|_| io_error("Cannot inspect LAN attachment cache"))?
            {
                let entry = entry.map_err(|_| io_error("Cannot inspect LAN attachment cache"))?;
                let metadata = fs::symlink_metadata(entry.path())
                    .map_err(|_| io_error("Cannot inspect LAN attachment cache"))?;
                if !metadata.is_file() || linked(&metadata) {
                    return Err(invalid("LAN attachment cache refuses links or directories"));
                }
                if !part_name(&entry.file_name().to_string_lossy()) {
                    used = used.saturating_add(metadata.len());
                }
            }
            capacity(used, cache.reserved, reserved)?;
        }
        let file = if let Some(file) = existing {
            StageFile::Existing(file)
        } else {
            StageFile::Temporary(
                tempfile::Builder::new()
                    .prefix(".lan-")
                    .suffix(".part")
                    .tempfile_in(&root)
                    .map_err(|_| io_error("Cannot create LAN attachment temporary file"))?,
            )
        };
        cache.reserved += reserved;
        *cache.pins.entry(attachment.sha256.clone()).or_default() += 1;
        Ok(Stage {
            pin: Pin {
                releases: cache.releases.clone(),
                sha: attachment.sha256.clone(),
                reserved,
            },
            attachment,
            kind: kind.into(),
            file,
            root,
        })
    }
    pub(super) fn cleanup_partial_attachments(&self) -> NativeResult<()> {
        let root = self.path.with_extension("attachments");
        if !root.exists() {
            return Ok(());
        }
        checked_root(&root)?;
        for entry in fs::read_dir(&root)
            .map_err(|_| io_error("Cannot inspect incomplete LAN attachments"))?
        {
            let entry = entry.map_err(|_| io_error("Cannot inspect incomplete LAN attachments"))?;
            if part_name(&entry.file_name().to_string_lossy()) {
                let metadata = fs::symlink_metadata(entry.path())
                    .map_err(|_| io_error("Cannot inspect incomplete LAN attachment"))?;
                if !metadata.is_file() || linked(&metadata) {
                    return Err(invalid("Incomplete LAN attachment refuses links"));
                }
                fs::remove_file(entry.path())
                    .map_err(|_| io_error("Cannot clean incomplete LAN attachment"))?;
            }
        }
        Ok(())
    }
    pub(super) fn prune_attachments(&self, data: &Document) {
        let Ok(mut cache) = self.cache.try_lock() else {
            return;
        };
        cache.drain_releases();
        let root = self.path.with_extension("attachments");
        if !root.exists() || checked_root(&root).is_err() {
            return;
        }
        let referenced: BTreeSet<_> = data
            .messages
            .iter()
            .filter_map(|m| m.attachment.as_ref().map(|a| a.sha256.as_str()))
            .collect();
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.len() == 64
                    && name
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                    && !referenced.contains(name.as_str())
                    && !cache.pins.contains_key(&name)
                    && fs::symlink_metadata(entry.path()).is_ok_and(|m| m.is_file() && !linked(&m))
                {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }
    fn reclaim_attachments(&self) {
        // 保持当前 data guard 到删除结束；旧快照可能漏掉刚提交的消息引用。
        // prune 只尝试取得 cache 锁，不与接收提交的 cache → data 顺序互等。
        if let Ok(data) = self.data.lock() {
            self.prune_attachments(&data);
        }
    }
    pub(super) fn import_attachment(
        &self,
        path: &Path,
        kind: &str,
        permit: Option<&ServicePermit>,
        stop: Option<&AtomicBool>,
    ) -> NativeResult<CachedAttachment> {
        check_permit(permit)?;
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| io_error("Cannot inspect selected LAN attachment"))?;
        if !metadata.is_file() || linked(&metadata) {
            return Err(invalid("Choose a regular attachment file"));
        }
        let limit = if kind == "image" {
            MAX_IMAGE_ATTACHMENT
        } else {
            MAX_FILE_ATTACHMENT
        };
        if metadata.len() == 0 || metadata.len() > limit as u64 {
            return Err(too_large(kind));
        }
        let name = attachment_name(
            path.file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| invalid("Attachment filename must be UTF-8"))?,
        )?;
        let mut source =
            fs::File::open(path).map_err(|_| io_error("Cannot open selected LAN attachment"))?;
        let sha256 = copy_body(
            &mut source,
            &mut std::io::sink(),
            metadata.len() as usize,
            permit,
            stop,
            false,
        )?;
        source
            .seek(SeekFrom::Start(0))
            .map_err(|_| io_error("Cannot rewind selected LAN attachment"))?;
        let mime = if kind == "image" {
            let mut header = [0_u8; 32];
            let count = source
                .read(&mut header)
                .map_err(|_| io_error("Cannot read image header"))?;
            source
                .seek(SeekFrom::Start(0))
                .map_err(|_| io_error("Cannot rewind selected image"))?;
            match image::guess_format(&header[..count]).map_err(|_| {
                NativeError::new(
                    ErrorCode::ExtensionImageInvalid,
                    "Unsupported attachment image",
                )
            })? {
                image::ImageFormat::Png => "image/png",
                image::ImageFormat::Jpeg => "image/jpeg",
                image::ImageFormat::WebP => "image/webp",
                _ => {
                    return Err(NativeError::new(
                        ErrorCode::ExtensionImageInvalid,
                        "Only JPEG, PNG and WebP images are supported",
                    ));
                }
            }
        } else {
            "application/octet-stream"
        };
        let attachment = Attachment {
            name,
            mime: mime.into(),
            bytes: metadata.len() as usize,
            sha256,
        };
        let mut stage = self.stage(attachment.clone(), kind)?;
        if let StageFile::Temporary(file) = &mut stage.file
            && copy_body(
                &mut source,
                file.as_file_mut(),
                attachment.bytes,
                permit,
                stop,
                false,
            )? != attachment.sha256
        {
            return Err(interrupted("Selected attachment changed during import"));
        }
        stage.validate(permit, stop)?;
        check_permit(permit)?;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        commit_permit(permit, || {
            if stop.is_some_and(|stop| stop.load(Ordering::Acquire)) {
                return Err(interrupted("LAN transfer was stopped"));
            }
            stage.publish(&mut cache)
        })
    }
    pub(super) fn receive_attachment(
        &self,
        identities: (&str, &str, &str),
        kind: &str,
        attachment: Attachment,
        stream: &mut TcpStream,
        stop: &AtomicBool,
    ) -> NativeResult<CachedAttachment> {
        let (peer, connection, id) = identities;
        if !valid_token(id) {
            return Err(invalid("Invalid LAN attachment identity"));
        }
        attachment.validate(kind)?;
        let _capacity = RECEIVERS.try_acquire().map_err(|_| {
            NativeError::new(
                ErrorCode::ExtensionBusy,
                "LAN attachment receivers are busy",
            )
        })?;
        let mut stage = self.stage(attachment.clone(), kind)?;
        let hash = match &mut stage.file {
            StageFile::Temporary(file) => copy_body(
                stream,
                file.as_file_mut(),
                attachment.bytes,
                None,
                Some(stop),
                true,
            )?,
            StageFile::Existing(_) => copy_body(
                stream,
                &mut std::io::sink(),
                attachment.bytes,
                None,
                Some(stop),
                true,
            )?,
        };
        if hash != attachment.sha256 {
            return Err(interrupted("LAN attachment checksum is invalid"));
        }
        stage.validate(None, Some(stop))?;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        let result = self.mutate(|data| {
            let runtime = self
                .runtime
                .lock()
                .map_err(|_| unavailable("LAN session is unavailable"))?;
            if stop.load(Ordering::Acquire)
                || !runtime
                    .connections
                    .get(peer)
                    .is_some_and(|c| c.id == connection)
            {
                return Err(interrupted("LAN connection was replaced or stopped"));
            }
            let contact = data
                .contacts
                .get_mut(peer)
                .ok_or_else(|| unavailable("LAN contact no longer exists"))?;
            let cached = stage.publish(&mut cache)?;
            if !data.messages.iter().any(|m| m.id == id) {
                data.messages.push_back(Message {
                    id: id.into(),
                    peer_id: peer.into(),
                    sender: peer.into(),
                    nickname: contact.nickname.clone(),
                    text: String::new(),
                    at: now(),
                    outgoing: false,
                    delivery: "received".into(),
                    kind: kind.into(),
                    attachment: Some(attachment),
                });
                contact.unread = (contact.unread + 1).min(MAX_HISTORY as u32);
                contact.last_seen = now();
            }
            Ok(cached)
        });
        // mutate 内仍持有 cache 锁，通用清理只能跳过；释放后再按当前历史回收。
        // 失败也可能已经提交 blob，清理不能覆盖原来的历史提交错误。
        drop(cache);
        self.reclaim_attachments();
        result
    }
    pub(super) fn cached_attachment(
        &self,
        id: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<CachedAttachment> {
        if !valid_token(id) {
            return Err(invalid("Invalid attachment message identity"));
        }
        let (attachment, kind) = {
            let data = self
                .data
                .lock()
                .map_err(|_| unavailable("LAN history is unavailable"))?;
            let message = data
                .messages
                .iter()
                .find(|m| m.id == id)
                .ok_or_else(|| invalid("Unknown LAN attachment message"))?;
            (
                message
                    .attachment
                    .clone()
                    .ok_or_else(|| invalid("This message has no attachment"))?,
                message.kind.clone(),
            )
        };
        let mut stage = self.stage(attachment, &kind)?;
        if !matches!(stage.file, StageFile::Existing(_)) {
            return Err(io_error("LAN attachment is no longer available"));
        }
        stage.validate(permit, None)?;
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        stage.publish(&mut cache)
    }
}
fn part_name(name: &str) -> bool {
    name.starts_with(".lan-") && name.ends_with(".part")
}

pub(super) fn write_cached(
    stream: &mut TcpStream,
    cached: &mut CachedAttachment,
    permit: Option<&ServicePermit>,
    stop: &AtomicBool,
) -> NativeResult<()> {
    cached
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|_| io_error("Cannot rewind outgoing attachment"))?;
    let mut clock = Clock::new();
    let mut hash = Sha256::new();
    let mut remaining = cached.attachment.bytes;
    let mut chunk = [0_u8; CHUNK];
    while remaining != 0 {
        clock.check(permit, Some(stop))?;
        let count = remaining.min(CHUNK);
        cached
            .file
            .read_exact(&mut chunk[..count])
            .map_err(|_| interrupted("Cached attachment changed while sending"))?;
        hash.update(&chunk[..count]);
        let mut offset = 0;
        while offset != count {
            clock.check(permit, Some(stop))?;
            match commit_permit(permit, || Ok(stream.write(&chunk[offset..count])))? {
                Ok(0) => return Err(interrupted("LAN peer disconnected during file transfer")),
                Ok(written) => {
                    offset += written;
                    clock.progress();
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5))
                }
                Err(_) => return Err(interrupted("LAN attachment could not be sent")),
            }
        }
        remaining -= count;
    }
    if format!("{:x}", hash.finalize()) != cached.attachment.sha256 {
        return Err(interrupted(
            "Cached attachment checksum changed while sending",
        ));
    }
    Ok(())
}
pub(super) fn preview(cached: &mut CachedAttachment) -> NativeResult<Option<String>> {
    if cached.kind != "image" {
        return Ok(None);
    }
    let bytes = image_bytes(&mut cached.file, &cached.attachment)?;
    crate::extension_resources::bounded_render_image(&bytes, &cached.attachment.mime, false)
        .map(Some)
}
pub(super) fn save(
    cached: &mut CachedAttachment,
    path: &Path,
    permit: &ServicePermit,
) -> NativeResult<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent)
        .map_err(|_| io_error("Cannot resolve selected attachment destination"))?;
    let filename = path
        .file_name()
        .ok_or_else(|| invalid("Invalid attachment destination"))?;
    let target = parent.join(filename);
    let mut temp = tempfile::Builder::new()
        .prefix(".lan-save-")
        .suffix(".part")
        .tempfile_in(&parent)
        .map_err(|_| io_error("Cannot create attachment save temporary file"))?;
    cached
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|_| io_error("Cannot rewind saved attachment"))?;
    let sha = copy_body(
        &mut cached.file,
        temp.as_file_mut(),
        cached.attachment.bytes,
        Some(permit),
        None,
        false,
    )?;
    if sha != cached.attachment.sha256 {
        return Err(interrupted("LAN attachment checksum changed while saving"));
    }
    temp.as_file()
        .sync_all()
        .map_err(|_| io_error("Cannot flush saved LAN attachment"))?;
    permit.commit(|| {
        temp.persist(target)
            .map(|_| ())
            .map_err(|_| io_error("Cannot replace selected LAN attachment destination"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> tempfile::TempDir {
        tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
    }

    fn source_file(root: &Path, byte: u8) -> tempfile::NamedTempFile {
        let mut source = tempfile::Builder::new()
            .prefix("attachment-test-")
            .suffix(".bin")
            .tempfile_in(root)
            .unwrap();
        source.write_all(&[byte; 1024]).unwrap();
        source
    }

    #[test]
    fn receiving_a_new_message_reclaims_the_blob_evicted_from_history() {
        let _receivers = crate::extension_lan::binary_receiver_test_guard();
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let old_source = source_file(root.path(), 1);
        let old_cached = node
            .import_attachment(old_source.path(), "file", None, None)
            .unwrap();
        let old_path = node.attachment_root().join(&old_cached.attachment.sha256);
        let old_id = token().unwrap();
        let peer = token().unwrap();
        node.mutate(|data| {
            data.contacts.insert(
                peer.clone(),
                Contact {
                    id: peer.clone(),
                    nickname: "接收测试设备".into(),
                    address: "127.0.0.1".into(),
                    port: DEFAULT_PORT,
                    last_seen: now(),
                    unread: 0,
                },
            );
            data.messages.push_back(Message {
                id: old_id.clone(),
                peer_id: peer.clone(),
                sender: peer.clone(),
                nickname: "接收测试设备".into(),
                text: String::new(),
                at: now(),
                outgoing: false,
                delivery: "received".into(),
                kind: "file".into(),
                attachment: Some(old_cached.attachment.clone()),
            });
            for _ in 1..MAX_HISTORY {
                data.messages.push_back(Message {
                    id: token()?,
                    peer_id: peer.clone(),
                    sender: peer.clone(),
                    nickname: "接收测试设备".into(),
                    text: "保留的文字消息".into(),
                    at: now(),
                    outgoing: false,
                    delivery: "received".into(),
                    kind: "text".into(),
                    attachment: None,
                });
            }
            Ok(())
        })
        .unwrap();
        drop(old_cached);
        assert!(old_path.exists());

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let mut sender = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let connection = token().unwrap();
        {
            let mut runtime = node.runtime.lock().unwrap();
            runtime.stop = stop.clone();
            runtime.connections.insert(
                peer.clone(),
                Connection {
                    id: connection.clone(),
                    stream: Arc::new(Mutex::new(stream.try_clone().unwrap())),
                    control: stream.try_clone().unwrap(),
                    preferred: false,
                },
            );
        }
        let bytes = [2_u8; 1024];
        let incoming = Attachment {
            name: "incoming.bin".into(),
            mime: "application/octet-stream".into(),
            bytes: bytes.len(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
        };
        sender.write_all(&bytes).unwrap();
        let id = token().unwrap();
        let received = node
            .receive_attachment(
                (&peer, &connection, &id),
                "file",
                incoming,
                &mut stream,
                &stop,
            )
            .unwrap();

        let data = node.data.lock().unwrap();
        assert_eq!(data.messages.len(), MAX_HISTORY);
        assert!(data.messages.iter().all(|message| message.id != old_id));
        assert_eq!(data.messages.back().unwrap().id, id);
        assert!(!old_path.exists());
        assert!(
            node.attachment_root()
                .join(&received.attachment.sha256)
                .exists()
        );
    }

    #[test]
    fn new_blob_admission_reclaims_unsent_imports_without_removing_live_pins() {
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let abandoned_source = source_file(root.path(), 3);
        let mut abandoned = node
            .import_attachment(abandoned_source.path(), "file", None, None)
            .unwrap();
        let abandoned_path = node.attachment_root().join(&abandoned.attachment.sha256);
        let live_source = source_file(root.path(), 4);
        let live = node
            .import_attachment(live_source.path(), "file", None, None)
            .unwrap();
        let live_path = node.attachment_root().join(&live.attachment.sha256);
        // 监听仍存在但对端已经离线：导入成功，发送在登记消息之前失败。
        node.runtime.lock().unwrap().stop = Arc::new(AtomicBool::new(false));
        assert_eq!(
            node.send_cached_permitted(&token().unwrap(), &mut abandoned, None)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert!(node.data.lock().unwrap().messages.is_empty());
        drop(abandoned);
        assert!(abandoned_path.exists());

        let next_source = source_file(root.path(), 5);
        let next = node
            .import_attachment(next_source.path(), "file", None, None)
            .unwrap();

        assert!(!abandoned_path.exists());
        assert!(live_path.exists());
        assert!(
            node.attachment_root()
                .join(&next.attachment.sha256)
                .exists()
        );
        assert!(node.data.lock().unwrap().messages.is_empty());
    }

    #[test]
    fn reservations_include_inflight_bytes_and_allow_exact_quota() {
        assert!(capacity(MAX_ATTACHMENTS_DISK - 10, 4, 6).is_ok());
        assert_eq!(
            capacity(MAX_ATTACHMENTS_DISK - 10, 4, 7).unwrap_err().code,
            ErrorCode::ExtensionAttachmentCacheFull
        );
        assert!(capacity(u64::MAX, 1, 0).is_err());
    }
}
