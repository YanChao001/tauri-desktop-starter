//! LAN 附件的有界磁盘与流式 I/O；不向插件提供文件路径。
use super::*;
use std::io::{Seek, SeekFrom};

pub(super) const CHUNK: usize = 64 * 1024;
const IDLE_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
static RECEIVERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);
const MAX_THUMBNAILS: usize = 48;
const MAX_THUMBNAIL_BYTES: usize = 24 * 1024;

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
    progress: Option<&TransferGuard>,
) -> NativeResult<String> {
    let mut clock = Clock::new();
    let mut hash = Sha256::new();
    let mut remaining = length;
    let mut chunk = [0_u8; CHUNK];
    while remaining != 0 {
        clock.check(permit, stop)?;
        if let Some(progress) = progress {
            progress.check()?;
        }
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
                if let Some(progress) = progress {
                    progress.advance(count);
                }
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
    if let Some(progress) = progress {
        progress.check()?;
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn verify_file(
    file: &mut fs::File,
    attachment: &Attachment,
    permit: Option<&ServicePermit>,
    stop: Option<&AtomicBool>,
    progress: Option<&TransferGuard>,
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
        progress,
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
    thumbnails: VecDeque<Thumbnail>,
}
struct Thumbnail {
    sha256: String,
    mime: String,
    data_url: String,
}
impl AttachmentCache {
    fn thumbnail(&self, attachment: &Attachment) -> Option<String> {
        self.thumbnails
            .iter()
            .find(|entry| entry.sha256 == attachment.sha256 && entry.mime == attachment.mime)
            .map(|entry| entry.data_url.clone())
    }
    fn remember_thumbnail(&mut self, attachment: &Attachment, data_url: String) {
        if data_url.len() > MAX_THUMBNAIL_BYTES {
            return;
        }
        self.thumbnails
            .retain(|entry| entry.sha256 != attachment.sha256 || entry.mime != attachment.mime);
        self.thumbnails.push_back(Thumbnail {
            sha256: attachment.sha256.clone(),
            mime: attachment.mime.clone(),
            data_url,
        });
        while self.thumbnails.len() > MAX_THUMBNAILS {
            self.thumbnails.pop_front();
        }
    }
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
    thumbnail: Option<String>,
}
pub(super) struct CachedAttachment {
    pub(super) attachment: Attachment,
    pub(super) kind: String,
    pub(super) file: fs::File,
    _pin: Pin,
    pub(super) progress: Option<TransferGuard>,
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
        progress: Option<&TransferGuard>,
    ) -> NativeResult<()> {
        if let StageFile::Temporary(file) = &self.file {
            file.as_file()
                .sync_all()
                .map_err(|_| io_error("Cannot flush LAN attachment"))?;
        }
        let attachment = self.attachment.clone();
        if let Some(progress) = progress {
            progress.phase("verifying");
        }
        verify_file(self.file(), &attachment, permit, stop, progress)?;
        if self.kind == "image" {
            let bytes = image_bytes(self.file(), &attachment)?;
            self.thumbnail = Some(crate::extension_resources::bounded_render_image(
                &bytes,
                &attachment.mime,
                true,
            )?);
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
        if let Some(thumbnail) = self.thumbnail {
            cache.remember_thumbnail(&self.attachment, thumbnail);
        }
        cache.reserved = cache.reserved.saturating_sub(self.pin.reserved);
        self.pin.reserved = 0;
        Ok(CachedAttachment {
            attachment: self.attachment,
            kind: self.kind,
            file,
            _pin: self.pin,
            progress: None,
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
            thumbnail: None,
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
        let referenced: BTreeSet<_> = data
            .messages
            .iter()
            .filter_map(|m| m.attachment.as_ref().map(|a| a.sha256.as_str()))
            .collect();
        cache
            .thumbnails
            .retain(|entry| referenced.contains(entry.sha256.as_str()));
        let root = self.path.with_extension("attachments");
        if !root.exists() || checked_root(&root).is_err() {
            return;
        }
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
    #[cfg(test)]
    pub(super) fn import_attachment(
        &self,
        path: &Path,
        kind: &str,
        permit: Option<&ServicePermit>,
        stop: Option<&AtomicBool>,
    ) -> NativeResult<CachedAttachment> {
        self.import_attachment_tracked(path, kind, permit, stop, None)
    }
    pub(super) fn import_outgoing_attachment(
        &self,
        path: &Path,
        kind: &str,
        permit: Option<&ServicePermit>,
        stop: &AtomicBool,
        peer: &str,
    ) -> NativeResult<CachedAttachment> {
        self.import_attachment_tracked(path, kind, permit, Some(stop), Some(peer))
    }
    fn import_attachment_tracked(
        &self,
        path: &Path,
        kind: &str,
        permit: Option<&ServicePermit>,
        stop: Option<&AtomicBool>,
        peer: Option<&str>,
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
        let progress = peer
            .map(|peer| {
                self.transfers.begin(
                    peer,
                    "outgoing",
                    kind,
                    &Attachment {
                        name: name.clone(),
                        mime: String::new(),
                        bytes: metadata.len() as usize,
                        sha256: String::new(),
                    },
                    token()?,
                    stop,
                )
            })
            .transpose()?;
        let mut source =
            fs::File::open(path).map_err(|_| io_error("Cannot open selected LAN attachment"))?;
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
        // 先为未知散列的私有临时副本预留额度，准备阶段只复制并散列一次。
        // 缓存接近上限时回退只散列，已有同内容附件仍可复用而不额外占磁盘。
        let root = self.cache_root()?;
        let reservation = self.reserve_import(&root, metadata.len());
        let mut staged = match reservation {
            Ok(pin) => Some((
                tempfile::Builder::new()
                    .prefix(".lan-")
                    .suffix(".part")
                    .tempfile_in(&root)
                    .map_err(|_| io_error("Cannot create LAN attachment temporary file"))?,
                pin,
            )),
            Err(error) if error.code == ErrorCode::ExtensionAttachmentCacheFull => {
                if let Some(progress) = &progress {
                    progress.phase("verifying");
                }
                None
            }
            Err(error) => return Err(error),
        };
        let sha256 = if let Some((file, _)) = staged.as_mut() {
            copy_body(
                &mut source,
                file.as_file_mut(),
                metadata.len() as usize,
                permit,
                stop,
                false,
                progress.as_ref(),
            )?
        } else {
            copy_body(
                &mut source,
                &mut std::io::sink(),
                metadata.len() as usize,
                permit,
                stop,
                false,
                progress.as_ref(),
            )?
        };
        let after = source
            .metadata()
            .map_err(|_| io_error("Cannot inspect selected LAN attachment"))?;
        if after.len() != metadata.len() || after.modified().ok() != metadata.modified().ok() {
            return Err(interrupted("Selected attachment changed during import"));
        }
        let attachment = Attachment {
            name,
            mime: mime.into(),
            bytes: metadata.len() as usize,
            sha256,
        };
        let mut stage = if let Some((file, pin)) = staged {
            self.stage_import(attachment, kind, root, file, pin)?
        } else {
            // 确定散列后才回收无引用的旧 blob，不能提前删掉需拒写保护的同名坏缓存。
            let mut stage = self.stage(attachment.clone(), kind)?;
            if let StageFile::Temporary(file) = &mut stage.file {
                if let Some(progress) = &progress {
                    progress.phase("preparing");
                }
                source
                    .seek(SeekFrom::Start(0))
                    .map_err(|_| io_error("Cannot rewind selected LAN attachment"))?;
                if copy_body(
                    &mut source,
                    file.as_file_mut(),
                    attachment.bytes,
                    permit,
                    stop,
                    false,
                    progress.as_ref(),
                )? != attachment.sha256
                {
                    return Err(interrupted("Selected attachment changed during import"));
                }
            }
            stage
        };
        stage.validate(permit, stop, progress.as_ref())?;
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
            if let Some(progress) = &progress {
                progress.check()?;
            }
            let mut cached = stage.publish(&mut cache)?;
            cached.progress = progress;
            Ok(cached)
        })
    }
    fn reserve_import(&self, root: &Path, bytes: u64) -> NativeResult<Pin> {
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        let mut used = 0_u64;
        for entry in
            fs::read_dir(root).map_err(|_| io_error("Cannot inspect LAN attachment cache"))?
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
        capacity(used, cache.reserved, bytes)?;
        cache.reserved += bytes;
        Ok(Pin {
            releases: cache.releases.clone(),
            sha: String::new(),
            reserved: bytes,
        })
    }
    fn stage_import(
        &self,
        attachment: Attachment,
        kind: &str,
        root: PathBuf,
        file: tempfile::NamedTempFile,
        mut pin: Pin,
    ) -> NativeResult<Stage> {
        attachment.validate(kind)?;
        let path = root.join(&attachment.sha256);
        if matches!(fs::symlink_metadata(&path), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
        {
            self.reclaim_attachments();
        }
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        let file = match fs::symlink_metadata(&path) {
            Ok(metadata)
                if metadata.is_file()
                    && !linked(&metadata)
                    && metadata.len() == attachment.bytes as u64 =>
            {
                let existing = fs::File::open(path)
                    .map_err(|_| io_error("Cannot open cached LAN attachment"))?;
                cache.reserved = cache.reserved.saturating_sub(pin.reserved);
                pin.reserved = 0;
                StageFile::Existing(existing)
            }
            Ok(_) => {
                return Err(interrupted(
                    "Existing LAN attachment is invalid; original data was preserved",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                StageFile::Temporary(file)
            }
            Err(_) => return Err(io_error("Cannot inspect LAN attachment cache")),
        };
        pin.sha = attachment.sha256.clone();
        *cache.pins.entry(pin.sha.clone()).or_default() += 1;
        Ok(Stage {
            attachment,
            kind: kind.into(),
            file,
            root,
            pin,
            thumbnail: None,
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
        let progress =
            self.transfers
                .begin(peer, "incoming", kind, &attachment, id.into(), Some(stop))?;
        let mut stage = self.stage(attachment.clone(), kind)?;
        let hash = match &mut stage.file {
            StageFile::Temporary(file) => copy_body(
                stream,
                file.as_file_mut(),
                attachment.bytes,
                None,
                Some(stop),
                true,
                Some(&progress),
            )?,
            StageFile::Existing(_) => copy_body(
                stream,
                &mut std::io::sink(),
                attachment.bytes,
                None,
                Some(stop),
                true,
                Some(&progress),
            )?,
        };
        if hash != attachment.sha256 {
            return Err(interrupted("LAN attachment checksum is invalid"));
        }
        stage.validate(None, Some(stop), Some(&progress))?;
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
        if result.is_ok() {
            progress.complete();
        }
        result
    }
    pub(super) fn cached_attachment(
        &self,
        id: &str,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<CachedAttachment> {
        self.open_attachment(id, permit, true)
    }
    fn open_attachment(
        &self,
        id: &str,
        permit: Option<&ServicePermit>,
        validate_image: bool,
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
        if validate_image {
            stage.validate(permit, None, None)?;
        } else {
            // 预览随后会解码所需尺寸；此处只核对文件，不先生成并丢弃另一份缩略图。
            let attachment = stage.attachment.clone();
            verify_file(stage.file(), &attachment, permit, None, None)?;
        }
        let mut cache = self
            .cache
            .lock()
            .map_err(|_| unavailable("LAN attachment cache is unavailable"))?;
        cache.drain_releases();
        stage.publish(&mut cache)
    }
    pub(super) fn attachment_preview(
        &self,
        id: &str,
        thumbnail: bool,
        permit: Option<&ServicePermit>,
    ) -> NativeResult<Option<String>> {
        let mut cached = self.open_attachment(id, permit, false)?;
        if cached.kind != "image" {
            return Ok(None);
        }
        if thumbnail {
            let data_url = self
                .cache
                .lock()
                .map_err(|_| unavailable("LAN attachment cache is unavailable"))?
                .thumbnail(&cached.attachment);
            if let Some(data_url) = data_url {
                check_permit(permit)?;
                return Ok(Some(data_url));
            }
        }
        let bytes = image_bytes(&mut cached.file, &cached.attachment)?;
        let data_url = crate::extension_resources::bounded_render_image(
            &bytes,
            &cached.attachment.mime,
            thumbnail,
        )?;
        check_permit(permit)?;
        if thumbnail {
            self.cache
                .lock()
                .map_err(|_| unavailable("LAN attachment cache is unavailable"))?
                .remember_thumbnail(&cached.attachment, data_url.clone());
        }
        Ok(Some(data_url))
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
    progress: &TransferGuard,
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
        progress.check()?;
        let count = remaining.min(CHUNK);
        cached
            .file
            .read_exact(&mut chunk[..count])
            .map_err(|_| interrupted("Cached attachment changed while sending"))?;
        hash.update(&chunk[..count]);
        let mut offset = 0;
        while offset != count {
            clock.check(permit, Some(stop))?;
            progress.check()?;
            match commit_permit(permit, || Ok(stream.write(&chunk[offset..count])))? {
                Ok(0) => return Err(interrupted("LAN peer disconnected during file transfer")),
                Ok(written) => {
                    offset += written;
                    clock.progress();
                    progress.advance(written);
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
        None,
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
    use base64::{Engine, engine::general_purpose::STANDARD};

    fn directory() -> tempfile::TempDir {
        crate::extension_paths::temporary_directory()
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

    fn image_message(node: &Node, attachment: &Attachment) -> String {
        let id = token().unwrap();
        node.mutate(|data| {
            let peer = token()?;
            data.contacts.insert(
                peer.clone(),
                Contact {
                    id: peer.clone(),
                    nickname: "图片测试设备".into(),
                    address: "127.0.0.1".into(),
                    port: DEFAULT_PORT,
                    last_seen: now(),
                    unread: 0,
                },
            );
            data.messages.push_back(Message {
                id: id.clone(),
                peer_id: peer.clone(),
                sender: peer,
                nickname: "图片测试设备".into(),
                text: String::new(),
                at: now(),
                outgoing: false,
                delivery: "received".into(),
                kind: "image".into(),
                attachment: Some(attachment.clone()),
            });
            Ok(())
        })
        .unwrap();
        id
    }

    fn image_source(root: &Path) -> tempfile::NamedTempFile {
        let mut source = tempfile::Builder::new()
            .prefix("attachment-image-")
            .suffix(".png")
            .tempfile_in(root)
            .unwrap();
        image::DynamicImage::new_rgb8(640, 480)
            .write_to(source.as_file_mut(), image::ImageFormat::Png)
            .unwrap();
        source
    }

    fn preview_dimensions(data_url: &str) -> (u32, u32) {
        let (_, encoded) = data_url.split_once(',').unwrap();
        let decoded = crate::extension_resources::decode_image(
            &STANDARD.decode(encoded).unwrap(),
            "image/jpeg",
        )
        .unwrap();
        (decoded.width(), decoded.height())
    }

    #[test]
    fn image_import_keeps_a_small_thumbnail_separate_from_the_large_preview() {
        let _attachments = crate::extension_lan::binary_receiver_test_guard();
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let source = image_source(root.path());
        let cached = node
            .import_attachment(source.path(), "image", None, None)
            .unwrap();
        let id = image_message(&node, &cached.attachment);
        let duplicate = image_message(&node, &cached.attachment);
        let thumbnail = node
            .cache
            .lock()
            .unwrap()
            .thumbnail(&cached.attachment)
            .expect("the import already decoded the image and should retain its thumbnail");
        assert!(thumbnail.len() <= 24 * 1024);
        assert_eq!(preview_dimensions(&thumbnail), (320, 240));
        assert_eq!(
            node.attachment_preview(&id, true, None).unwrap(),
            Some(thumbnail.clone())
        );
        assert_eq!(
            node.attachment_preview(&duplicate, true, None).unwrap(),
            Some(thumbnail)
        );
        assert_eq!(node.cache.lock().unwrap().thumbnails.len(), 1);

        let preview = node.attachment_preview(&id, false, None).unwrap().unwrap();
        assert!(preview.len() <= 96 * 1024);
        assert_eq!(preview_dimensions(&preview), (640, 480));
    }

    #[test]
    fn reopened_image_thumbnails_are_cached_but_still_reject_changed_files() {
        let _attachments = crate::extension_lan::binary_receiver_test_guard();
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let source = image_source(root.path());
        let cached = node
            .import_attachment(source.path(), "image", None, None)
            .unwrap();
        let id = image_message(&node, &cached.attachment);
        let path = node.attachment_root().join(&cached.attachment.sha256);
        drop(cached);
        drop(node);

        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        assert!(node.cache.lock().unwrap().thumbnails.is_empty());
        let thumbnail = node.attachment_preview(&id, true, None).unwrap().unwrap();
        assert_eq!(preview_dimensions(&thumbnail), (320, 240));
        assert_eq!(node.cache.lock().unwrap().thumbnails.len(), 1);

        let mut corrupted = fs::read(&path).unwrap();
        corrupted[0] ^= 1;
        fs::write(&path, &corrupted).unwrap();
        assert_eq!(
            node.attachment_preview(&id, true, None).unwrap_err().code,
            ErrorCode::ExtensionTransferInterrupted
        );
        assert_eq!(fs::read(&path).unwrap(), corrupted);
    }

    #[test]
    fn thumbnail_cache_has_a_fixed_bound_and_does_not_reuse_different_mime_types() {
        let mut cache = AttachmentCache::default();
        let attachment = |index| Attachment {
            name: "image.png".into(),
            mime: "image/png".into(),
            bytes: 80,
            sha256: format!("{index:064x}"),
        };
        for index in 0..49 {
            cache.remember_thumbnail(&attachment(index), "thumbnail".into());
        }
        assert_eq!(cache.thumbnails.len(), 48);
        assert!(cache.thumbnail(&attachment(0)).is_none());
        assert!(cache.thumbnail(&attachment(48)).is_some());
        cache.remember_thumbnail(&attachment(49), "x".repeat(24 * 1024 + 1));
        assert_eq!(cache.thumbnails.len(), 48);
        assert!(cache.thumbnail(&attachment(49)).is_none());
        let mut mismatched = attachment(48);
        mismatched.mime = "image/jpeg".into();
        assert!(cache.thumbnail(&mismatched).is_none());
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
    #[test]
    fn duplicate_import_near_quota_reuses_verified_cache_without_a_second_reservation() {
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let source = source_file(root.path(), 9);
        let cached = node
            .import_attachment(source.path(), "file", None, None)
            .unwrap();
        let reserved = MAX_ATTACHMENTS_DISK - cached.attachment.bytes as u64;
        node.cache.lock().unwrap().reserved = reserved;
        let duplicate = node
            .import_attachment(source.path(), "file", None, None)
            .unwrap();
        assert_eq!(cached.attachment.sha256, duplicate.attachment.sha256);
        assert_eq!(node.cache.lock().unwrap().reserved, reserved);
        assert!(
            fs::read_dir(node.attachment_root())
                .unwrap()
                .all(|entry| !part_name(&entry.unwrap().file_name().to_string_lossy()))
        );
    }
    #[test]
    fn window_cancellation_during_preparation_removes_parts_and_finishes_progress() {
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let source = tempfile::NamedTempFile::new_in(root.path()).unwrap();
        source.as_file().set_len(64 * 1024 * 1024).unwrap();
        let path = source.path().to_owned();
        let store = crate::extensions::ExtensionStore::new(root.path().join("store"), false);
        let activity = store
            .begin_service(store.window_run_token("sending".into()).unwrap())
            .unwrap();
        let permit = ServicePermit::for_test(activity);
        let importing = node.clone();
        let worker = thread::spawn(move || {
            importing.import_outgoing_attachment(
                &path,
                "file",
                Some(&permit),
                &AtomicBool::new(false),
                &"a".repeat(32),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let snapshot = node.transfers.snapshot().unwrap();
            if snapshot["transfers"][0]["completedBytes"]
                .as_u64()
                .is_some_and(|bytes| bytes > 0)
            {
                break;
            }
            assert!(Instant::now() < deadline, "preparation did not start");
            thread::sleep(Duration::from_millis(1));
        }
        store.begin_window_close("sending").unwrap();
        assert_eq!(
            worker.join().unwrap().err().unwrap().code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(
            node.transfers.snapshot().unwrap()["transfers"][0]["phase"],
            "failed"
        );
        assert!(node.data.lock().unwrap().messages.is_empty());
        assert!(source.path().exists());
        assert!(
            fs::read_dir(node.attachment_root())
                .unwrap()
                .all(|entry| !part_name(&entry.unwrap().file_name().to_string_lossy()))
        );
        store.wait_stopped();
    }
    #[test]
    fn source_changes_during_single_pass_preparation_preserve_the_source_and_reject_the_snapshot() {
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        let source = tempfile::NamedTempFile::new_in(root.path()).unwrap();
        source.as_file().set_len(64 * 1024 * 1024).unwrap();
        let path = source.path().to_owned();
        let importing = node.clone();
        let worker = thread::spawn(move || {
            importing.import_outgoing_attachment(
                &path,
                "file",
                None,
                &AtomicBool::new(false),
                &"a".repeat(32),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let snapshot = node.transfers.snapshot().unwrap();
            if snapshot["transfers"][0]["completedBytes"]
                .as_u64()
                .is_some_and(|bytes| bytes > 0)
            {
                break;
            }
            assert!(Instant::now() < deadline, "preparation did not start");
            thread::sleep(Duration::from_millis(1));
        }
        source
            .as_file()
            .set_modified(SystemTime::now() + Duration::from_secs(3))
            .unwrap();
        assert_eq!(
            worker.join().unwrap().err().unwrap().code,
            ErrorCode::ExtensionTransferInterrupted
        );
        assert_eq!(
            node.transfers.snapshot().unwrap()["transfers"][0]["phase"],
            "failed"
        );
        assert!(node.data.lock().unwrap().messages.is_empty());
        assert!(source.path().exists());
        assert!(
            fs::read_dir(node.attachment_root())
                .unwrap()
                .all(|entry| !part_name(&entry.unwrap().file_name().to_string_lossy()))
        );
    }
    #[test]
    fn old_file_picker_selection_after_stop_cannot_register_progress_or_create_cache_files() {
        let root = directory();
        let node = Node::open(root.path(), "market.lan-chat").unwrap();
        node.start("旧选择器", Ipv4Addr::LOCALHOST.into(), 0)
            .unwrap();
        let old_stop = node.runtime.lock().unwrap().stop.clone();
        let source = source_file(root.path(), 7);
        node.stop();
        assert!(
            node.import_outgoing_attachment(
                source.path(),
                "file",
                None,
                &old_stop,
                &"a".repeat(32)
            )
            .is_err()
        );
        assert_eq!(node.transfers.snapshot().unwrap(), json!({"transfers":[]}));
        assert!(!node.attachment_root().exists());
        assert!(source.path().exists());
    }
}
