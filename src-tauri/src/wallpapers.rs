//! 有界的本机壁纸图库；当前背景仍由设置快照持有，图库不暴露文件路径。
use std::{fs::File, io::Read, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;

use crate::{
    error::{ErrorCode, NativeError, NativeResult},
    storage::{atomic_write, validate_custom_background},
};

const MAX_IMAGES: usize = 24;
const MAX_LIBRARY_BYTES: u64 = 24 * 100 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperInput {
    pub name: String,
    pub data_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<WallpaperVideo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WallpaperVideo {
    pub id: String,
    pub mime: WallpaperVideoMime,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq)]
pub enum WallpaperVideoMime {
    #[serde(rename = "video/mp4")]
    Mp4,
    #[serde(rename = "video/webm")]
    Webm,
}

impl WallpaperVideoMime {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Mp4 => "video/mp4",
            Self::Webm => "video/webm",
        }
    }
}

impl WallpaperVideo {
    pub(crate) fn valid(&self) -> bool {
        self.id.len() == 64
            && self
                .id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }

    pub(crate) fn filename(&self) -> String {
        format!(
            "{}.{}",
            self.id,
            if self.mime == WallpaperVideoMime::Mp4 {
                "mp4"
            } else {
                "webm"
            }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::{fs, sync::Arc};

    fn input(index: usize) -> WallpaperInput {
        WallpaperInput {
            name: format!("image-{index}.webp"),
            video: None,
            data_url: format!(
                "data:image/webp;base64,{}",
                STANDARD.encode(format!("RIFF0000WEBP{index}"))
            ),
        }
    }

    #[test]
    fn legacy_deduplication_rename_delete_and_restart_preserve_current_format() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("wallpapers.json");
        let store = WallpaperStore::new(path.clone());
        let legacy = store.list(Some(input(0))).unwrap().remove(0);
        assert_eq!(store.add(input(0)).unwrap(), legacy);
        assert_eq!(store.list(None).unwrap().len(), 1);
        let renamed = store.rename(&legacy.id, "旅行照片".into()).unwrap();
        assert_eq!(
            WallpaperStore::new(path.clone()).list(None).unwrap(),
            vec![renamed]
        );
        store.remove(&legacy.id).unwrap();
        store.remove(&legacy.id).unwrap();
        assert!(
            WallpaperStore::new(path)
                .list(Some(input(0)))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rejects_unsafe_images_and_over_capacity_without_changing_saved_library() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("wallpapers.json");
        let store = WallpaperStore::new(path.clone());
        for index in 0..MAX_IMAGES {
            store.add(input(index)).unwrap();
        }
        let original = fs::read(&path).unwrap();
        assert_eq!(
            store.add(input(MAX_IMAGES)).unwrap_err().code,
            ErrorCode::InputTooLong
        );
        for data_url in [
            "https://example.test/image.webp",
            "data:image/svg+xml;base64,AAAA",
            "data:image/webp;base64,AAAA",
        ] {
            let mut invalid = input(100);
            invalid.data_url = data_url.into();
            assert!(store.add(invalid).is_err());
        }
        assert!(
            store
                .rename(&store.list(None).unwrap()[0].id, "bad\0name".into())
                .is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(store.add(input(0)).unwrap().name, "image-0.webp");
    }

    #[test]
    fn corrupt_and_future_libraries_are_never_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("wallpapers.json");
        let store = WallpaperStore::new(path.clone());
        for source in ["{broken", r#"{"version":3,"images":[],"future":true}"#] {
            fs::write(&path, source).unwrap();
            assert!(store.list(Some(input(1))).is_err());
            assert!(store.add(input(1)).is_err());
            assert!(store.remove("id").is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), source);
        }
    }

    #[test]
    fn legacy_media_validation_precedes_initial_write_and_does_not_block_an_existing_library() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("wallpapers.json");
        let store = WallpaperStore::new(path.clone());
        assert!(
            store
                .list_with_validation(Some(input(0)), |_| Err(NativeError::new(
                    ErrorCode::NotFound,
                    "Media unavailable"
                )))
                .is_err()
        );
        assert!(!path.exists());
        let entry = store.add(input(1)).unwrap();
        assert_eq!(
            store
                .list_with_validation(Some(input(0)), |_| panic!(
                    "Existing libraries do not initialize legacy media"
                ))
                .unwrap(),
            vec![entry]
        );
    }

    #[test]
    fn concurrent_windows_do_not_lose_independent_images() {
        let directory = tempfile::tempdir().unwrap();
        let store = Arc::new(WallpaperStore::new(
            directory.path().join("wallpapers.json"),
        ));
        let threads: Vec<_> = (0..12)
            .map(|index| {
                let store = Arc::clone(&store);
                std::thread::spawn(move || {
                    let added = store.add(input(index)).unwrap();
                    store.rename(&added.id, format!("Renamed {index}")).unwrap();
                    if index % 2 == 0 {
                        store.remove(&added.id).unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let entries = store.list(None).unwrap();
        assert_eq!(entries.len(), 6);
        assert!(
            entries
                .iter()
                .all(|entry| entry.name.starts_with("Renamed "))
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Wallpaper {
    pub id: String,
    pub name: String,
    pub data_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<WallpaperVideo>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Library {
    version: u32,
    images: Vec<Wallpaper>,
}

pub struct WallpaperStore {
    path: PathBuf,
    writing: Mutex<()>,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::StorageCorrupt, message)
}

fn image(input: WallpaperInput) -> NativeResult<Wallpaper> {
    validate_custom_background(&serde_json::json!({
        "name": input.name, "dataUrl": input.data_url, "fit": "cover", "video": input.video
    }))?;
    Ok(Wallpaper {
        id: input.video.as_ref().map_or_else(
            || format!("{:x}", Sha256::digest(input.data_url.as_bytes())),
            |video| {
                format!(
                    "{:x}",
                    Sha256::digest(
                        format!("video:{}:{}", video.id, video.mime.as_str()).as_bytes()
                    )
                )
            },
        ),
        name: input.name,
        data_url: input.data_url,
        video: input.video,
    })
}

impl WallpaperStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            writing: Mutex::new(()),
        }
    }

    fn read(&self) -> NativeResult<Option<Library>> {
        let file = match File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(NativeError::operation(
                    ErrorCode::StorageIo,
                    "Cannot read wallpaper library",
                    error,
                ));
            }
        };
        let mut bytes = Vec::new();
        file.take(MAX_LIBRARY_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                NativeError::operation(ErrorCode::StorageIo, "Cannot read wallpaper library", error)
            })?;
        if bytes.len() as u64 > MAX_LIBRARY_BYTES {
            return Err(invalid("Wallpaper library exceeds its limit"));
        }
        let library: Library = serde_json::from_slice(&bytes)
            .map_err(|_| invalid("Cannot decode wallpaper library"))?;
        if !matches!(library.version, 1 | 2) || library.images.len() > MAX_IMAGES {
            return Err(invalid("Unsupported wallpaper library format"));
        }
        let mut ids = std::collections::HashSet::new();
        for entry in &library.images {
            let checked = image(WallpaperInput {
                name: entry.name.clone(),
                data_url: entry.data_url.clone(),
                video: entry.video.clone(),
            })?;
            if checked.id != entry.id || !ids.insert(&entry.id) {
                return Err(invalid("Invalid wallpaper identity"));
            }
        }
        Ok(Some(library))
    }

    fn write(&self, library: &Library) -> NativeResult<()> {
        let bytes = serde_json::to_vec(&Library {
            version: 2,
            images: library.images.clone(),
        })
        .map_err(|_| invalid("Cannot encode wallpaper library"))?;
        if bytes.len() as u64 > MAX_LIBRARY_BYTES {
            return Err(invalid("Wallpaper library exceeds its limit"));
        }
        atomic_write(&self.path, &bytes)
    }

    pub fn list(&self, legacy: Option<WallpaperInput>) -> NativeResult<Vec<Wallpaper>> {
        self.list_with_validation(legacy, |_| Ok(()))
    }

    pub(crate) fn list_with_validation(
        &self,
        legacy: Option<WallpaperInput>,
        validate: impl FnOnce(&WallpaperInput) -> NativeResult<()>,
    ) -> NativeResult<Vec<Wallpaper>> {
        let _guard = self
            .writing
            .lock()
            .map_err(|_| invalid("Wallpaper library is unavailable"))?;
        if let Some(library) = self.read()? {
            return Ok(library.images);
        }
        if let Some(input) = &legacy {
            validate(input)?;
        }
        let library = Library {
            version: 1,
            images: legacy.map(image).transpose()?.into_iter().collect(),
        };
        self.write(&library)?;
        Ok(library.images)
    }

    pub fn add(&self, input: WallpaperInput) -> NativeResult<Wallpaper> {
        let entry = image(input)?;
        let _guard = self
            .writing
            .lock()
            .map_err(|_| invalid("Wallpaper library is unavailable"))?;
        let mut library = self.read()?.unwrap_or(Library {
            version: 1,
            images: vec![],
        });
        if let Some(existing) = library.images.iter().find(|item| item.id == entry.id) {
            return Ok(existing.clone());
        }
        if library.images.len() >= MAX_IMAGES {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Wallpaper library is full",
            ));
        }
        library.images.push(entry.clone());
        self.write(&library)?;
        Ok(entry)
    }

    pub fn rename(&self, id: &str, name: String) -> NativeResult<Wallpaper> {
        let _guard = self
            .writing
            .lock()
            .map_err(|_| invalid("Wallpaper library is unavailable"))?;
        let mut library = self
            .read()?
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper not found"))?;
        let entry = library
            .images
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper not found"))?;
        let renamed = image(WallpaperInput {
            name,
            data_url: entry.data_url.clone(),
            video: entry.video.clone(),
        })?;
        *entry = renamed.clone();
        self.write(&library)?;
        Ok(renamed)
    }

    pub fn remove(&self, id: &str) -> NativeResult<()> {
        let _guard = self
            .writing
            .lock()
            .map_err(|_| invalid("Wallpaper library is unavailable"))?;
        let Some(mut library) = self.read()? else {
            return Ok(());
        };
        let previous = library.images.len();
        library.images.retain(|item| item.id != id);
        if library.images.len() != previous {
            self.write(&library)?;
        }
        Ok(())
    }
}
