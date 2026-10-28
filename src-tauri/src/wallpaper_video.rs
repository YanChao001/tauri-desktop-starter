//! 视频由用户选择后流式复制到专用目录；播放只接受内容 ID，不暴露任意路径。
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use tauri::{
    Manager,
    http::{Request, Response, StatusCode},
};

use crate::{
    error::{ErrorCode, NativeError, NativeResult},
    wallpapers::{WallpaperVideo, WallpaperVideoMime},
};

pub(crate) const MAX_VIDEO_BYTES: u64 = 128 * 1024 * 1024;
const MAX_MEDIA_BYTES: u64 = 512 * 1024 * 1024;
const RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const PENDING_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperVideoChoice {
    pub name: String,
    pub video: WallpaperVideo,
}

pub struct WallpaperVideoStore {
    root: PathBuf,
    importing: Mutex<HashMap<String, Instant>>,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn io_error(error: std::io::Error) -> NativeError {
    NativeError::operation(ErrorCode::StorageIo, "Cannot access wallpaper video", error)
}

fn video_from_filename(name: &str) -> Option<WallpaperVideo> {
    let (id, extension) = name.split_once('.')?;
    let mime = match extension {
        "mp4" => WallpaperVideoMime::Mp4,
        "webm" => WallpaperVideoMime::Webm,
        _ => return None,
    };
    let video = WallpaperVideo {
        id: id.into(),
        mime,
    };
    video.valid().then_some(video)
}

fn media_type(header: &[u8], total: u64) -> NativeResult<WallpaperVideoMime> {
    if header.len() >= 12 && header.get(4..8) == Some(b"ftyp") {
        let size = u32::from_be_bytes(header[..4].try_into().expect("Four bytes"));
        if size >= 12 && u64::from(size) <= total {
            return Ok(WallpaperVideoMime::Mp4);
        }
    }
    if header.starts_with(&[0x1a, 0x45, 0xdf, 0xa3])
        && header.windows(4).any(|part| part == b"webm")
    {
        return Ok(WallpaperVideoMime::Webm);
    }
    Err(invalid("Choose a valid MP4 or WebM video"))
}

impl WallpaperVideoStore {
    pub fn new(library_path: &Path) -> Self {
        Self {
            root: library_path.with_file_name("wallpaper-media"),
            importing: Mutex::new(HashMap::new()),
        }
    }

    fn open(&self, video: &WallpaperVideo) -> NativeResult<File> {
        if !video.valid() {
            return Err(invalid("Invalid wallpaper video reference"));
        }
        let path = self.root.join(video.filename());
        let root_metadata = fs::symlink_metadata(&self.root).map_err(io_error)?;
        if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
            return Err(invalid("Invalid wallpaper media directory"));
        }
        let metadata = fs::symlink_metadata(&path).map_err(io_error)?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_VIDEO_BYTES
        {
            return Err(invalid("Invalid wallpaper video file"));
        }
        File::open(path).map_err(io_error)
    }

    pub(crate) fn exists(&self, video: &WallpaperVideo) -> bool {
        self.open(video).is_ok()
    }

    pub(crate) fn with_video<T>(
        &self,
        video: Option<&WallpaperVideo>,
        operation: impl FnOnce() -> NativeResult<T>,
    ) -> NativeResult<T> {
        let Some(video) = video else {
            return operation();
        };
        let mut pending = self
            .importing
            .lock()
            .map_err(|_| invalid("Video import is unavailable"))?;
        if self.exists(video) {
            pending.insert(video.id.clone(), Instant::now());
        }
        operation()
    }

    /// 仅在新的导入前回收旧孤儿；图库或设置无法确认时不清理任何已有媒体。
    pub(crate) fn import(
        &self,
        path: &Path,
        references: impl FnOnce() -> NativeResult<Option<HashSet<String>>>,
    ) -> NativeResult<WallpaperVideoChoice> {
        let mut pending = self
            .importing
            .lock()
            .map_err(|_| invalid("Video import is unavailable"))?;
        pending.retain(|_, started| started.elapsed() < PENDING_TTL);
        let referenced = references()?;
        let mut source = File::open(path).map_err(io_error)?;
        let metadata = source.metadata().map_err(io_error)?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_VIDEO_BYTES {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Choose a video up to 128 MiB",
            ));
        }
        let mut header = [0_u8; 4096];
        let count = source.read(&mut header).map_err(io_error)?;
        let mime = media_type(&header[..count], metadata.len())?;
        source.rewind().map_err(io_error)?;
        fs::create_dir_all(&self.root).map_err(io_error)?;
        let root_metadata = fs::symlink_metadata(&self.root).map_err(io_error)?;
        if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
            return Err(invalid("Invalid wallpaper media directory"));
        }
        let mut total = 0_u64;
        for entry in fs::read_dir(&self.root).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let filename = entry.file_name();
            let video = video_from_filename(&filename.to_string_lossy());
            let metadata = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                continue;
            }
            let recent = metadata
                .modified()
                .ok()
                .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                .is_none_or(|age| age < PENDING_TTL);
            let unused = referenced.as_ref().is_some_and(|ids| {
                video.as_ref().is_some_and(|video| {
                    !ids.contains(&video.id) && !pending.contains_key(&video.id)
                })
            });
            let abandoned = filename.to_string_lossy().starts_with(".wallpaper-import-");
            if referenced.is_some() && !recent && (unused || abandoned) {
                fs::remove_file(entry.path()).map_err(io_error)?;
            } else {
                total = total
                    .checked_add(metadata.len())
                    .ok_or_else(|| invalid("Wallpaper media size overflow"))?;
            }
        }
        // 空间不足时先只计算哈希，重复选择仍可复用已有媒体，不产生超预算临时副本。
        if total.saturating_add(metadata.len()) > MAX_MEDIA_BYTES {
            let mut hash = Sha256::new();
            let mut bytes = 0_u64;
            let mut block = [0_u8; 64 * 1024];
            loop {
                let read = source.read(&mut block).map_err(io_error)?;
                if read == 0 {
                    break;
                }
                bytes += read as u64;
                if bytes > MAX_VIDEO_BYTES {
                    return Err(NativeError::new(
                        ErrorCode::InputTooLong,
                        "Choose a video up to 128 MiB",
                    ));
                }
                hash.update(&block[..read]);
            }
            let video = WallpaperVideo {
                id: format!("{:x}", hash.finalize()),
                mime,
            };
            if !self.exists(&video) {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Wallpaper videos exceed the 512 MiB library budget",
                ));
            }
            pending.insert(video.id.clone(), Instant::now());
            return Ok(WallpaperVideoChoice {
                name: display_name(path),
                video,
            });
        }
        // 临时副本和哈希按固定块处理，不把视频送入 JSON 或常驻内存。
        let mut temporary = tempfile::Builder::new()
            .prefix(".wallpaper-import-")
            .tempfile_in(&self.root)
            .map_err(io_error)?;
        let mut hash = Sha256::new();
        let mut bytes = 0_u64;
        let mut block = [0_u8; 64 * 1024];
        loop {
            let read = source.read(&mut block).map_err(io_error)?;
            if read == 0 {
                break;
            }
            bytes += read as u64;
            if bytes > MAX_VIDEO_BYTES {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Choose a video up to 128 MiB",
                ));
            }
            hash.update(&block[..read]);
            temporary.write_all(&block[..read]).map_err(io_error)?;
        }
        if bytes != metadata.len() {
            return Err(invalid(
                "The selected video changed during import. Try again",
            ));
        }
        temporary.as_file_mut().rewind().map_err(io_error)?;
        let count = temporary
            .as_file_mut()
            .read(&mut header)
            .map_err(io_error)?;
        if media_type(&header[..count], bytes)? != mime {
            return Err(invalid(
                "The selected video changed during import. Try again",
            ));
        }
        let video = WallpaperVideo {
            id: format!("{:x}", hash.finalize()),
            mime,
        };
        if !self.exists(&video) {
            if total.saturating_add(bytes) > MAX_MEDIA_BYTES {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Wallpaper videos exceed the 512 MiB library budget",
                ));
            }
            temporary.as_file().sync_all().map_err(io_error)?;
            temporary
                .persist(self.root.join(video.filename()))
                .map_err(|error| io_error(error.error))?;
        }
        pending.insert(video.id.clone(), Instant::now());
        Ok(WallpaperVideoChoice {
            name: display_name(path),
            video,
        })
    }

    fn response(&self, request: &Request<Vec<u8>>) -> NativeResult<Response<Vec<u8>>> {
        if !matches!(
            *request.method(),
            tauri::http::Method::GET | tauri::http::Method::HEAD
        ) || request.uri().query().is_some()
        {
            return Err(invalid("Unsupported video request"));
        }
        let video = video_from_filename(request.uri().path().strip_prefix('/').unwrap_or_default())
            .ok_or_else(|| invalid("Invalid video path"))?;
        let mut file = self.open(&video)?;
        let length = file.metadata().map_err(io_error)?.len();
        let range = request
            .headers()
            .get("range")
            .map(|value| value.to_str().map_err(|_| invalid("Invalid video range")))
            .transpose()?;
        let requested =
            if request.method() == tauri::http::Method::HEAD && range.is_none() && length > 0 {
                Some((0, length - 1))
            } else {
                byte_range(range, length)
            };
        let Some((start, end)) = requested else {
            return Ok(response_builder(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("Content-Range", format!("bytes */{length}"))
                .body(vec![])
                .expect("Static video response"));
        };
        let count = end - start + 1;
        let partial = range.is_some() || count != length;
        let mut response = response_builder(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header("Content-Type", video.mime.as_str())
        .header("Content-Length", count)
        .header("Accept-Ranges", "bytes");
        if partial {
            response = response.header("Content-Range", format!("bytes {start}-{end}/{length}"));
        }
        let mut body = vec![];
        if request.method() != tauri::http::Method::HEAD {
            file.seek(SeekFrom::Start(start)).map_err(io_error)?;
            file.take(count).read_to_end(&mut body).map_err(io_error)?;
        }
        Ok(response.body(body).expect("Static video response"))
    }
}

fn display_name(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Video wallpaper")
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect::<String>();
    if name.trim().is_empty() {
        "Video wallpaper".into()
    } else {
        name.trim().into()
    }
}

fn byte_range(range: Option<&str>, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (start, end) = match range {
        None => (0, length - 1),
        Some(range) => {
            let (first, last) = range.strip_prefix("bytes=")?.split_once('-')?;
            if first.is_empty() {
                let suffix = last.parse::<u64>().ok()?;
                if suffix == 0 {
                    return None;
                }
                (length.saturating_sub(suffix), length - 1)
            } else {
                let start = first.parse::<u64>().ok()?;
                let end = if last.is_empty() {
                    length - 1
                } else {
                    last.parse::<u64>().ok()?.min(length - 1)
                };
                (start, end)
            }
        }
    };
    if start >= length || end < start {
        return None;
    }
    Some((start, end.min(start.saturating_add(RESPONSE_BYTES - 1))))
}

fn response_builder(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header("Vary", "Origin")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Accept-Ranges, Content-Length",
        )
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
}

fn allowed_origin(origin: &str, development_origin: Option<&str>) -> bool {
    matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) || development_origin == Some(origin)
}

pub fn register_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol(
        "wallpaper-media",
        |context, request, responder| {
            let app = context.app_handle().clone();
            let origin = request.headers().get("origin").cloned();
            let development_origin = if cfg!(debug_assertions) {
                app.config()
                    .build
                    .dev_url
                    .as_ref()
                    .map(|url| url.origin().ascii_serialization())
            } else {
                None
            };
            let denied_origin = origin.as_ref().is_some_and(|value| {
                value.to_str().map_or(true, |value| {
                    !allowed_origin(value, development_origin.as_deref())
                })
            });
            if crate::commands::require_host_window(context.webview_label()).is_err()
                || denied_origin
            {
                responder.respond(
                    response_builder(StatusCode::FORBIDDEN)
                        .body(vec![])
                        .expect("Static video response"),
                );
                return;
            }
            tauri::async_runtime::spawn(async move {
                let response = crate::blocking::run(move || {
                    app.state::<WallpaperVideoStore>().response(&request)
                })
                .await;
                let mut response = response.unwrap_or_else(|_| {
                    response_builder(StatusCode::NOT_FOUND)
                        .body(vec![])
                        .expect("Static video response")
                });
                if let Some(origin) = origin {
                    response
                        .headers_mut()
                        .insert(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
                }
                responder.respond(response);
            });
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mp4() -> Vec<u8> {
        [
            0_u8, 0, 0, 20, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm', 0, 0, 0, 0, b'm', b'p',
            b'4', b'2',
        ]
        .to_vec()
    }
    #[test]
    fn media_cors_accepts_only_host_and_explicit_development_origins() {
        for origin in [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ] {
            assert!(allowed_origin(origin, None));
        }
        for origin in [
            "null",
            "https://example.test",
            "http://extension-ui.localhost",
            "http://localhost:1420",
            "http://tauri.localhost.example.test",
        ] {
            assert!(!allowed_origin(origin, None));
        }
        assert!(allowed_origin(
            "http://localhost:1420",
            Some("http://localhost:1420")
        ));
    }
    #[test]
    fn imports_deduplicates_and_reopens_only_managed_video_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("source.mp4");
        fs::write(&path, mp4()).unwrap();
        let store = WallpaperVideoStore::new(&directory.path().join("wallpapers.json"));
        let selected = store.import(&path, || Ok(Some(HashSet::new()))).unwrap();
        assert_eq!(selected.video.mime, WallpaperVideoMime::Mp4);
        assert!(store.exists(&selected.video));
        assert_eq!(
            store.import(&path, || Ok(None)).unwrap().video,
            selected.video
        );
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 1);
        assert!(
            WallpaperVideoStore::new(&directory.path().join("wallpapers.json"))
                .exists(&selected.video)
        );
        assert!(!store.exists(&WallpaperVideo {
            id: "../source".into(),
            mime: WallpaperVideoMime::Mp4
        }));
        assert!(path.exists());
    }
    #[test]
    fn rejects_fake_headers_empty_and_oversized_files_without_persisting_partial_media() {
        let directory = tempfile::tempdir().unwrap();
        let store = WallpaperVideoStore::new(&directory.path().join("wallpapers.json"));
        let path = directory.path().join("invalid.mp4");
        for bytes in [vec![], b"not a video".to_vec()] {
            fs::write(&path, bytes).unwrap();
            assert!(store.import(&path, || Ok(None)).is_err());
        }
        let source = File::create(&path).unwrap();
        source.set_len(MAX_VIDEO_BYTES + 1).unwrap();
        assert_eq!(
            store.import(&path, || Ok(None)).unwrap_err().code,
            ErrorCode::InputTooLong
        );
        assert!(!store.root.exists());
    }
    #[test]
    fn cleanup_protects_pending_current_and_unreadable_references_and_only_reclaims_old_orphans() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("first.mp4");
        fs::write(&source, mp4()).unwrap();
        let store = WallpaperVideoStore::new(&directory.path().join("wallpapers.json"));
        let first = store.import(&source, || Ok(None)).unwrap();
        let managed = store.root.join(first.video.filename());
        fs::OpenOptions::new()
            .write(true)
            .open(&managed)
            .unwrap()
            .set_modified(SystemTime::now() - PENDING_TTL * 2)
            .unwrap();
        let other = directory.path().join("second.mp4");
        let mut bytes = mp4();
        bytes.push(1);
        fs::write(&other, bytes).unwrap();
        store.import(&other, || Ok(Some(HashSet::new()))).unwrap();
        assert!(
            managed.exists(),
            "An in-flight poster still owns its imported media"
        );
        store.importing.lock().unwrap().remove(&first.video.id);
        store.import(&other, || Ok(None)).unwrap();
        assert!(
            managed.exists(),
            "Unreadable or future references must disable cleanup"
        );
        store
            .import(&other, || Ok(Some(HashSet::from([first.video.id.clone()]))))
            .unwrap();
        assert!(
            managed.exists(),
            "The independent settings copy keeps media alive"
        );
        store.import(&other, || Ok(Some(HashSet::new()))).unwrap();
        assert!(!managed.exists());
        assert!(
            source.exists(),
            "Cleanup never removes the user's original file"
        );
    }
    #[test]
    fn unknown_files_count_toward_budget_and_abandoned_imports_are_reclaimed_before_copying() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("video.mp4");
        fs::write(&source, mp4()).unwrap();
        let store = WallpaperVideoStore::new(&directory.path().join("wallpapers.json"));
        fs::create_dir_all(&store.root).unwrap();
        let unknown = store.root.join("future-media.bin");
        File::create(&unknown)
            .unwrap()
            .set_len(MAX_MEDIA_BYTES)
            .unwrap();
        assert_eq!(
            store
                .import(&source, || Ok(Some(HashSet::new())))
                .unwrap_err()
                .code,
            ErrorCode::InputTooLong
        );
        assert_eq!(fs::read_dir(&store.root).unwrap().count(), 1);
        assert!(unknown.exists());
        fs::remove_file(unknown).unwrap();
        let abandoned = store.root.join(".wallpaper-import-stale");
        let file = File::create(&abandoned).unwrap();
        file.set_len(MAX_VIDEO_BYTES).unwrap();
        file.set_modified(SystemTime::now() - PENDING_TTL * 2)
            .unwrap();
        drop(file);
        let selected = store.import(&source, || Ok(Some(HashSet::new()))).unwrap();
        assert!(!abandoned.exists());
        assert!(store.exists(&selected.video));
    }
    #[test]
    fn ranges_are_bounded_and_invalid_paths_or_methods_do_not_read_files() {
        assert_eq!(byte_range(Some("bytes=2-4"), 10), Some((2, 4)));
        assert_eq!(byte_range(Some("bytes=-2"), 10), Some((8, 9)));
        assert_eq!(byte_range(Some("bytes=2-"), 10), Some((2, 9)));
        for range in [
            "bytes=10-",
            "bytes=5-2",
            "bytes=-0",
            "bytes=0-1,3-4",
            "bytes=18446744073709551616-",
        ] {
            assert_eq!(byte_range(Some(range), 10), None);
        }
        assert_eq!(
            byte_range(None, MAX_VIDEO_BYTES),
            Some((0, RESPONSE_BYTES - 1))
        );
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("video.mp4");
        fs::write(&path, mp4()).unwrap();
        let store = WallpaperVideoStore::new(&directory.path().join("wallpapers.json"));
        let selected = store.import(&path, || Ok(None)).unwrap();
        let url = format!(
            "http://wallpaper-media.localhost/{}",
            selected.video.filename()
        );
        let request = Request::builder()
            .uri(&url)
            .header("Range", "bytes=0-3")
            .body(vec![])
            .unwrap();
        let response = store.response(&request).unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body().len(), 4);
        let request = Request::builder()
            .method("HEAD")
            .uri(&url)
            .body(vec![])
            .unwrap();
        let response = store.response(&request).unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["Content-Length"], "20");
        assert!(response.body().is_empty());
        let request = Request::builder()
            .uri(&url)
            .header("Range", "bytes=999-")
            .body(vec![])
            .unwrap();
        assert_eq!(
            store.response(&request).unwrap().status(),
            StatusCode::RANGE_NOT_SATISFIABLE
        );
        for url in [
            "http://wallpaper-media.localhost/../source.mp4",
            "http://wallpaper-media.localhost/%2fsource.mp4",
            "http://wallpaper-media.localhost/source.mp4",
        ] {
            assert!(
                store
                    .response(&Request::builder().uri(url).body(vec![]).unwrap())
                    .is_err()
            );
        }
        assert!(
            store
                .response(
                    &Request::builder()
                        .method("POST")
                        .uri(&url)
                        .body(vec![])
                        .unwrap()
                )
                .is_err()
        );
        assert!(
            store
                .response(
                    &Request::builder()
                        .uri(format!("{url}?download=1"))
                        .body(vec![])
                        .unwrap()
                )
                .is_err()
        );
    }
}
