//! 明确授权的应用壁纸服务；远程内容仅来自 Commons 的公开领域 / CC0 文件。
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult},
    extension_network::is_public_ip,
    extension_services::ServicePermit,
    storage::{SETTINGS_EVENT, SettingsStore, future_settings_schema},
    wallpaper_commands::WALLPAPERS_EVENT,
    wallpapers::{Wallpaper, WallpaperInput, WallpaperStore},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader, codecs::jpeg::JpegEncoder};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    fs::File,
    io::{Cursor, Read},
    net::{SocketAddr, ToSocketAddrs},
    sync::{Arc, OnceLock},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_http::reqwest;
use tauri_plugin_opener::OpenerExt;

const IMAGE_LIMIT: usize = 16 * 1024 * 1024;
const API_LIMIT: usize = 512 * 1024;
const MAX_PIXELS: u64 = 16_000_000;
const SOURCE: &str = "wikimedia-commons";

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum NetworkMode {
    #[default]
    System,
    Direct,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum Request {
    List,
    Sources,
    Search {
        query: String,
        #[serde(default, rename = "networkMode")]
        network_mode: NetworkMode,
    },
    Preview {
        #[serde(rename = "pageId")]
        page_id: u64,
        #[serde(default, rename = "networkMode")]
        network_mode: NetworkMode,
    },
    ImportRemote {
        #[serde(rename = "pageId")]
        page_id: u64,
        #[serde(default, rename = "networkMode")]
        network_mode: NetworkMode,
    },
    DownloadOriginal {
        #[serde(rename = "pageId")]
        page_id: u64,
        #[serde(default, rename = "networkMode")]
        network_mode: NetworkMode,
    },
    OpenSource {
        #[serde(rename = "pageId")]
        page_id: u64,
    },
    Import,
    Apply {
        id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: i32,
        fit: String,
    },
    Rename {
        id: String,
        name: String,
    },
    Remove {
        id: String,
        #[serde(rename = "expectedRevision")]
        expected_revision: i32,
    },
    OpenSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteImage {
    page_id: u64,
    title: String,
    author: String,
    license: String,
    license_url: String,
    source_url: String,
    width: u64,
    height: u64,
    bytes: u64,
    #[serde(skip)]
    original_url: String,
    #[serde(skip)]
    preview_url: String,
    #[serde(skip)]
    mime: String,
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}
fn failed(message: &str) -> NativeError {
    NativeError::new(ErrorCode::ExtensionRunFailed, message)
}
fn parse_request(value: Value) -> NativeResult<Request> {
    if serde_json::to_vec(&value).map_or(true, |bytes| bytes.len() > 4096) {
        return Err(invalid("Wallpaper request exceeds its limit"));
    }
    // Serde's internally tagged unit variants can otherwise ignore extra fields.
    if matches!(
        value.get("action").and_then(Value::as_str),
        Some("list" | "sources" | "import" | "open-settings")
    ) && value.as_object().is_none_or(|object| object.len() != 1)
    {
        return Err(invalid(
            "Wallpaper service action does not accept extra fields",
        ));
    }
    let request: Request =
        serde_json::from_value(value).map_err(|_| invalid("Invalid wallpaper service request"))?;
    match &request {
        Request::Search { query, .. } => {
            if query.trim().is_empty()
                || query.chars().count() > 100
                || query.chars().any(char::is_control)
            {
                return Err(invalid("Wallpaper search must contain 1–100 characters"));
            }
        }
        Request::Preview { page_id, .. }
        | Request::ImportRemote { page_id, .. }
        | Request::DownloadOriginal { page_id, .. }
        | Request::OpenSource { page_id }
            if *page_id == 0 || *page_id > i64::MAX as u64 =>
        {
            return Err(invalid("Invalid Commons page ID"));
        }
        Request::Apply {
            id,
            expected_revision,
            fit,
        } => {
            validate_id(id)?;
            if *expected_revision < 0 || !matches!(fit.as_str(), "cover" | "contain") {
                return Err(invalid("Invalid wallpaper revision or fit"));
            }
        }
        Request::Remove {
            id,
            expected_revision,
        } => {
            validate_id(id)?;
            if *expected_revision < 0 {
                return Err(invalid("Invalid wallpaper revision"));
            }
        }
        Request::Rename { id, name } => {
            validate_id(id)?;
            if name.trim().is_empty()
                || name.chars().count() > 120
                || name.chars().any(char::is_control)
            {
                return Err(invalid("Wallpaper name must contain 1–120 characters"));
            }
        }
        _ => {}
    }
    Ok(request)
}
fn validate_id(id: &str) -> NativeResult<()> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid("Invalid wallpaper ID"));
    }
    Ok(())
}

fn approved_url(source: &str, image: bool) -> NativeResult<url::Url> {
    let url = url::Url::parse(source).map_err(|_| invalid("Invalid wallpaper source URL"))?;
    if url.scheme() != "https"
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || if image {
            !matches!(
                url.host_str(),
                Some("upload.wikimedia.org" | "thumb.wikimedia.org")
            ) || !url.path().starts_with("/wikipedia/commons/")
        } else {
            url.host_str() != Some("commons.wikimedia.org") || url.path() != "/w/api.php"
        }
    {
        return Err(invalid(
            "Wallpaper URL is outside the approved Commons source",
        ));
    }
    Ok(url)
}

fn provider_host(host: &str) -> bool {
    matches!(
        host,
        "commons.wikimedia.org" | "upload.wikimedia.org" | "thumb.wikimedia.org"
    )
}
fn validate_resolution(
    host: &str,
    mode: NetworkMode,
    addresses: &[SocketAddr],
) -> NativeResult<()> {
    if provider_host(host) {
        validate_addresses(addresses)
    } else if matches!(mode, NetworkMode::System) && !addresses.is_empty() && addresses.len() <= 32
    {
        // This name can only be a proxy selected by reqwest from the user's system configuration.
        // Fixed request URLs and disabled redirects prevent plugin-selected destinations here.
        Ok(())
    } else {
        Err(invalid("Unexpected direct wallpaper destination"))
    }
}
struct ProviderResolver {
    mode: NetworkMode,
}
impl reqwest::dns::Resolve for ProviderResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_owned();
        let mode = self.mode;
        Box::pin(async move {
            let addresses = resolve_transport(host, mode)
                .await
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error + Send + Sync>)?;
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
}
async fn resolve_transport(host: String, mode: NetworkMode) -> NativeResult<Vec<SocketAddr>> {
    static DNS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let addresses = tokio::time::timeout(Duration::from_secs(10), async move {
        let permit = DNS
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| failed("Wallpaper resolver is unavailable"))?;
        blocking::run(move || {
            // OS DNS cannot be interrupted; capacity follows the actual thread, not its caller.
            let _permit = permit;
            let addresses = (host.as_str(), 0)
                .to_socket_addrs()
                .map_err(|_| failed("Cannot resolve Commons wallpaper source"))?
                .take(33)
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<SocketAddr>>();
            validate_resolution(&host, mode, &addresses)?;
            Ok(addresses)
        })
        .await
    })
    .await
    .map_err(|_| {
        NativeError::new(
            ErrorCode::ExtensionTimeout,
            "Commons name resolution timed out",
        )
    })??;
    Ok(addresses)
}
async fn fetch(
    source: &str,
    image: bool,
    limit: usize,
    network_mode: NetworkMode,
) -> NativeResult<(Vec<u8>, String)> {
    let url = approved_url(source, image)?;
    let mut builder = reqwest::Client::builder()
        .https_only(true).referer(false)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(20))
        .dns_resolver(Arc::new(ProviderResolver{mode:network_mode}))
        .user_agent("TauriDesktopStarterWallpaper/1.0 (https://github.com/YanChao001/tauri-desktop-starter)");
    if matches!(network_mode, NetworkMode::Direct) {
        builder = builder.no_proxy();
    }
    let client = builder
        .build()
        .map_err(|_| failed("Cannot prepare wallpaper transport"))?;
    let mut response =
        client.get(url).send().await.map_err(|_| {
            failed("Commons wallpaper request failed; check connectivity and retry")
        })?;
    if !response.status().is_success() || response.status().is_redirection() {
        return Err(failed(
            "Commons wallpaper source did not return a successful direct response",
        ));
    }
    if response
        .content_length()
        .is_some_and(|bytes| bytes > limit as u64)
    {
        return Err(invalid("Wallpaper response exceeds its download limit"));
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
    if if image {
        !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp")
    } else {
        !matches!(mime.as_str(), "application/json" | "text/json")
    } {
        return Err(invalid("Unexpected Commons response MIME type"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| failed("Cannot read Commons response"))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(invalid("Wallpaper response exceeds its download limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, mime))
}
fn validate_addresses(addresses: &[SocketAddr]) -> NativeResult<()> {
    if addresses.is_empty()
        || addresses.len() > 32
        || addresses.iter().any(|address| !is_public_ip(address.ip()))
    {
        return Err(invalid(
            "Wallpaper source must resolve entirely to public addresses",
        ));
    }
    Ok(())
}
fn api_url(query: Option<&str>, page_id: Option<u64>) -> String {
    let mut url =
        url::Url::parse("https://commons.wikimedia.org/w/api.php").expect("fixed Commons URL");
    {
        let mut params = url.query_pairs_mut();
        params.extend_pairs([
            ("action", "query"),
            ("format", "json"),
            ("prop", "imageinfo"),
            ("iiprop", "url|size|mime|extmetadata"),
            ("iiurlwidth", "480"),
            (
                "iiextmetadatafilter",
                "Artist|LicenseShortName|LicenseUrl|Copyrighted",
            ),
        ]);
        if let Some(query) = query {
            params.extend_pairs([
                ("generator", "search"),
                ("gsrnamespace", "6"),
                ("gsrlimit", "12"),
            ]);
            // Cirrus OR does not combine filter parameters; category names use its pipe union.
            params.append_pair(
                "gsrsearch",
                &format!("{query} filetype:bitmap incategory:CC-Zero|PD-user|PD_NASA"),
            );
        }
        if let Some(page_id) = page_id {
            params.append_pair("pageids", &page_id.to_string());
        }
    }
    url.into()
}
fn plain(source: &str, limit: usize) -> String {
    let mut inside = false;
    source
        .chars()
        .filter(|character| {
            if *character == '<' {
                inside = true;
                return false;
            }
            if *character == '>' {
                inside = false;
                return false;
            }
            !inside && !character.is_control()
        })
        .take(limit)
        .collect::<String>()
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .trim()
        .to_owned()
}
fn parse_images(value: &Value) -> Vec<RemoteImage> {
    let Some(pages) = value.pointer("/query/pages").and_then(Value::as_object) else {
        return vec![];
    };
    pages.values().take(12).filter_map(|page| {
        let page_id = page.get("pageid")?.as_u64()?;
        let info = page.get("imageinfo")?.as_array()?.first()?;
        let meta = info.get("extmetadata")?;
        let license = meta.pointer("/LicenseShortName/value")?.as_str()?;
        let (license, license_url) = match license {
            "Public domain" => ("Public domain", "https://commons.wikimedia.org/wiki/Commons:Copyright_tags/General_public_domain"),
            "CC0" | "CC0 1.0" => ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
            _ => return None,
        };
        let original_url = info.get("url")?.as_str()?.to_owned();
        let preview_url = info.get("thumburl").and_then(Value::as_str).unwrap_or(&original_url).to_owned();
        approved_url(&original_url, true).ok()?;
        approved_url(&preview_url, true).ok()?;
        let mime = info.get("mime")?.as_str()?.to_owned();
        if !matches!(mime.as_str(), "image/jpeg" | "image/png" | "image/webp") { return None; }
        let width = info.get("width")?.as_u64()?;
        let height = info.get("height")?.as_u64()?;
        if width == 0 || height == 0 || width > 30_000 || height > 30_000 { return None; }
        Some(RemoteImage {
            page_id, title: plain(page.get("title")?.as_str()?.strip_prefix("File:")?, 120),
            author: plain(meta.pointer("/Artist/value").and_then(Value::as_str).unwrap_or("See source page"), 180),
            license: license.into(), license_url: license_url.into(),
            source_url: format!("https://commons.wikimedia.org/?curid={page_id}"),
            width, height, bytes: info.get("size")?.as_u64()?, original_url, preview_url, mime,
        })
    }).collect()
}
async fn lookup(page_id: u64, network_mode: NetworkMode) -> NativeResult<RemoteImage> {
    let (bytes, _) = fetch(
        &api_url(None, Some(page_id)),
        false,
        API_LIMIT,
        network_mode,
    )
    .await?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| failed("Invalid Commons API response"))?;
    parse_images(&value)
        .into_iter()
        .find(|entry| entry.page_id == page_id)
        .ok_or_else(|| {
            invalid("Commons file is missing or no longer explicitly Public domain / CC0")
        })
}

fn decode_image(bytes: &[u8], mime: &str) -> NativeResult<image::DynamicImage> {
    if bytes.is_empty() || bytes.len() > IMAGE_LIMIT {
        return Err(invalid("Wallpaper exceeds 16 MiB"));
    }
    let format = image::guess_format(bytes).map_err(|_| invalid("Invalid wallpaper image"))?;
    let expected = match format {
        ImageFormat::Jpeg => "image/jpeg",
        ImageFormat::Png => "image/png",
        ImageFormat::WebP => "image/webp",
        _ => return Err(invalid("Unsupported wallpaper image format")),
    };
    if !mime.is_empty() && mime != expected {
        return Err(invalid("Wallpaper MIME does not match its image content"));
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    let mut metadata_reader = ImageReader::with_format(Cursor::new(bytes), format);
    metadata_reader.limits(limits.clone());
    let dimensions = metadata_reader
        .into_dimensions()
        .map_err(|_| invalid("Cannot read wallpaper dimensions within limits"))?;
    if dimensions.0 == 0
        || dimensions.1 == 0
        || dimensions.0 > 8192
        || dimensions.1 > 8192
        || u64::from(dimensions.0) * u64::from(dimensions.1) > MAX_PIXELS
    {
        return Err(invalid(
            "Wallpaper exceeds 8192 pixels per side or 16 million pixels",
        ));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| invalid("Wallpaper image cannot be decoded within resource limits"))
}
fn render_image(bytes: &[u8], mime: &str, thumbnail: bool) -> NativeResult<String> {
    let decoded = decode_image(bytes, mime)?;
    for edge in if thumbnail {
        &[320, 240, 160][..]
    } else {
        &[1600, 1280, 960, 720, 480][..]
    } {
        let resized = decoded.thumbnail(*edge, *edge).to_rgb8();
        let mut output = Vec::new();
        JpegEncoder::new_with_quality(&mut output, if thumbnail { 65 } else { 76 })
            .encode_image(&resized)
            .map_err(|_| failed("Cannot encode wallpaper preview"))?;
        let data = format!("data:image/jpeg;base64,{}", STANDARD.encode(output));
        if data.len() <= if thumbnail { 24 * 1024 } else { 94 * 1024 } {
            return Ok(data);
        }
    }
    Err(invalid(
        "Wallpaper cannot fit the host gallery image budget",
    ))
}
fn legacy(settings: &Value) -> Option<WallpaperInput> {
    let value = settings.get("customBackground")?;
    Some(WallpaperInput {
        name: value.get("name")?.as_str()?.to_owned(),
        data_url: value.get("dataUrl")?.as_str()?.to_owned(),
    })
}
fn list(app: &tauri::AppHandle) -> NativeResult<Value> {
    let snapshot = app.state::<SettingsStore>().snapshot()?;
    let images = app
        .state::<WallpaperStore>()
        .list(legacy(&snapshot.settings))?;
    let current = snapshot
        .settings
        .pointer("/customBackground/dataUrl")
        .and_then(Value::as_str);
    Ok(
        json!({"revision": snapshot.revision, "items": images.iter().map(|entry| json!({
        "id":entry.id,"name":entry.name,"dataUrl":gallery_preview(&entry.data_url),
        "active":snapshot.settings.get("background").and_then(Value::as_str)==Some("custom") && current == Some(entry.data_url.as_str())
    })).collect::<Vec<_>>(),"limit":24}),
    )
}
fn gallery_preview(data_url: &str) -> Option<String> {
    let (header, encoded) = data_url.split_once(',')?;
    let mime = match header {
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/webp;base64" => "image/webp",
        _ => return None,
    };
    let bytes = STANDARD.decode(encoded).ok()?;
    render_image(&bytes, mime, true).ok()
}
fn next_settings(settings: &Value, image: Option<&Wallpaper>, fit: &str) -> NativeResult<Value> {
    if future_settings_schema(settings) {
        return Err(invalid("Future settings schema is read-only"));
    }
    let mut value = settings.clone();
    let object = value
        .as_object_mut()
        .ok_or_else(|| invalid("Invalid settings snapshot"))?;
    object.insert("schemaVersion".into(), json!(3));
    object.insert(
        "background".into(),
        json!(if image.is_some() { "custom" } else { "plain" }),
    );
    object.insert(
        "customBackground".into(),
        image.map_or(
            Value::Null,
            |image| json!({"name":image.name,"dataUrl":image.data_url,"fit":fit}),
        ),
    );
    Ok(value)
}
fn apply_settings(
    settings: &SettingsStore,
    library: &WallpaperStore,
    id: &str,
    expected_revision: i32,
    fit: &str,
) -> NativeResult<crate::storage::SettingsSnapshot> {
    let snapshot = settings.snapshot()?;
    let entry = library
        .list(legacy(&snapshot.settings))?
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Wallpaper no longer exists"))?;
    settings.save(
        next_settings(&snapshot.settings, Some(&entry), fit)?,
        expected_revision,
    )
}
fn broadcast_settings(app: &tauri::AppHandle, snapshot: &crate::storage::SettingsSnapshot) {
    if let Err(error) = app.emit(SETTINGS_EVENT, snapshot) {
        log::warn!("Cannot broadcast wallpaper settings: {error}");
    }
}

pub(crate) async fn request(
    app: tauri::AppHandle,
    owner: &str,
    extension_id: &str,
    request: Value,
    permit: ServicePermit,
) -> NativeResult<Value> {
    if owner.is_empty() || owner.len() > 160 || extension_id.is_empty() || extension_id.len() > 80 {
        return Err(invalid("Invalid wallpaper service owner"));
    }
    let request = parse_request(request)?;
    permit.check()?;
    static ACTIVE: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let _permit = ACTIVE
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "Wallpaper service is busy"))?;
    match request {
        Request::Sources => Ok(
            json!({"items":[{"id":SOURCE,"name":"Wikimedia Commons","url":"https://commons.wikimedia.org/","licenses":["Public domain","CC0 1.0"]}]}),
        ),
        Request::Search {
            query,
            network_mode,
        } => {
            let (bytes, _) = fetch(
                &api_url(Some(query.trim()), None),
                false,
                API_LIMIT,
                network_mode,
            )
            .await?;
            permit.check()?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| failed("Invalid Commons API response"))?;
            if value.get("error").is_some() {
                return Err(failed("Commons search could not be completed"));
            }
            Ok(json!({"source":SOURCE,"items":parse_images(&value)}))
        }
        Request::Preview {
            page_id,
            network_mode,
        } => {
            let image = lookup(page_id, network_mode).await?;
            let (bytes, mime) =
                fetch(&image.preview_url, true, 2 * 1024 * 1024, network_mode).await?;
            permit.check()?;
            let data_url = blocking::run(move || render_image(&bytes, &mime, true)).await?;
            Ok(json!({"image":image,"dataUrl":data_url}))
        }
        Request::OpenSource { page_id } => {
            blocking::run(move || {
                permit.commit(|| {
                    app.opener()
                        .open_url(
                            format!("https://commons.wikimedia.org/?curid={page_id}"),
                            None::<String>,
                        )
                        .map_err(|_| failed("Cannot open Commons source page"))?;
                    Ok(json!({"opened":true}))
                })
            })
            .await
        }
        Request::ImportRemote {
            page_id,
            network_mode,
        } => {
            let image = lookup(page_id, network_mode).await?;
            let (bytes, mime) =
                fetch(&image.preview_url, true, 2 * 1024 * 1024, network_mode).await?;
            permit.check()?;
            blocking::run(move || {
                let data_url = render_image(&bytes, &mime, false)?;
                let name = format!("{} · {}", plain(&image.title, 80), image.license);
                permit.commit(|| {
                    let entry = app
                        .state::<WallpaperStore>()
                        .add(WallpaperInput { name, data_url })?;
                    let _ = app.emit(WALLPAPERS_EVENT, ());
                    Ok(json!({"item":entry,"source":image,"library":list(&app)?}))
                })
            })
            .await
        }
        Request::DownloadOriginal {
            page_id,
            network_mode,
        } => {
            let image = lookup(page_id, network_mode).await?;
            if image.bytes > IMAGE_LIMIT as u64 {
                return Err(invalid(
                    "Original image exceeds 16 MiB; import its resized gallery version instead",
                ));
            }
            let (bytes, mime) = fetch(&image.original_url, true, IMAGE_LIMIT, network_mode).await?;
            if mime != image.mime || bytes.len() as u64 != image.bytes {
                return Err(failed(
                    "Commons original changed during download; preview it again",
                ));
            }
            blocking::run(move || {
                drop(decode_image(&bytes, &mime)?);
                let extension = match image.mime.as_str() {
                    "image/png" => "png",
                    "image/webp" => "webp",
                    _ => "jpg",
                };
                let filename = format!("commons-{}.{}", image.page_id, extension);
                permit.check()?;
                let Some(path) = app
                    .dialog()
                    .file()
                    .set_file_name(&filename)
                    .add_filter("Wallpaper image", &[extension])
                    .blocking_save_file()
                else {
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| invalid("Invalid selected wallpaper save path"))?;
                permit.commit(|| crate::storage::atomic_write(&path, &bytes))?;
                Ok(json!({"cancelled":false,"name":filename,"source":image}))
            })
            .await
        }
        Request::Import => {
            blocking::run(move || {
                permit.check()?;
                let Some(path) = app
                    .dialog()
                    .file()
                    .add_filter("Images", &["jpg", "jpeg", "png", "webp"])
                    .blocking_pick_file()
                else {
                    return Ok(json!({"cancelled":true}));
                };
                let path = path
                    .into_path()
                    .map_err(|_| invalid("Invalid selected wallpaper path"))?;
                let file =
                    File::open(&path).map_err(|_| failed("Cannot open selected wallpaper"))?;
                if !file
                    .metadata()
                    .map_err(|_| failed("Cannot inspect selected wallpaper"))?
                    .is_file()
                {
                    return Err(invalid("Select a regular wallpaper image"));
                }
                let mut bytes = Vec::new();
                file.take(IMAGE_LIMIT as u64 + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| failed("Cannot read selected wallpaper"))?;
                let data_url = render_image(&bytes, "", false)?;
                let name = plain(
                    path.file_stem()
                        .and_then(|name| name.to_str())
                        .unwrap_or("Imported wallpaper"),
                    110,
                );
                permit.commit(|| {
                    let entry = app
                        .state::<WallpaperStore>()
                        .add(WallpaperInput { name, data_url })?;
                    let _ = app.emit(WALLPAPERS_EVENT, ());
                    Ok(json!({"cancelled":false,"item":entry,"library":list(&app)?}))
                })
            })
            .await
        }
        Request::List => blocking::run(move || permit.commit(|| list(&app))).await,
        Request::Apply {
            id,
            expected_revision,
            fit,
        } => {
            blocking::run(move || {
                permit.commit(|| {
                    let snapshot = apply_settings(
                        &app.state::<SettingsStore>(),
                        &app.state::<WallpaperStore>(),
                        &id,
                        expected_revision,
                        &fit,
                    )?;
                    broadcast_settings(&app, &snapshot);
                    list(&app)
                })
            })
            .await
        }
        Request::Rename { id, name } => {
            blocking::run(move || {
                permit.commit(|| {
                    app.state::<WallpaperStore>().rename(&id, name)?;
                    let _ = app.emit(WALLPAPERS_EVENT, ());
                    list(&app)
                })
            })
            .await
        }
        Request::Remove {
            id,
            expected_revision,
        } => {
            blocking::run(move || {
                permit.commit(|| {
                    let snapshot = app.state::<SettingsStore>().snapshot()?;
                    let entry = app
                        .state::<WallpaperStore>()
                        .list(legacy(&snapshot.settings))?
                        .into_iter()
                        .find(|entry| entry.id == id);
                    if snapshot.revision != expected_revision {
                        return Err(NativeError::new(
                            ErrorCode::SettingsConflict,
                            "Settings changed; refresh the gallery before removing",
                        ));
                    }
                    if let Some(entry) = entry
                        && snapshot
                            .settings
                            .pointer("/customBackground/dataUrl")
                            .and_then(Value::as_str)
                            == Some(&entry.data_url)
                    {
                        let snapshot = app.state::<SettingsStore>().save(
                            next_settings(&snapshot.settings, None, "cover")?,
                            expected_revision,
                        )?;
                        broadcast_settings(&app, &snapshot);
                    }
                    app.state::<WallpaperStore>().remove(&id)?;
                    let _ = app.emit(WALLPAPERS_EVENT, ());
                    list(&app)
                })
            })
            .await
        }
        Request::OpenSettings => permit.commit(|| {
            app.emit_to("main", "app://workspace-route", "/settings")
                .map_err(|_| failed("Cannot open host wallpaper settings"))?;
            crate::desktop::request_show_main(&app);
            Ok(json!({"opened":true}))
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_boundary_refuses_paths_extra_fields_and_invalid_identifiers() {
        for value in [
            json!({"action":"search","query":""}),
            json!({"action":"preview","pageId":0}),
            json!({"action":"import","path":"C:/private"}),
            json!({"action":"apply","id":"../x","expectedRevision":0,"fit":"cover"}),
            json!({"action":"remove","id":"a".repeat(64),"expectedRevision":-1}),
        ] {
            assert!(parse_request(value).is_err());
        }
        assert!(parse_request(json!({"action":"search","query":"mountains"})).is_ok());
    }
    #[test]
    fn remote_urls_and_all_dns_addresses_remain_on_the_approved_source() {
        assert!(
            approved_url(
                "https://upload.wikimedia.org/wikipedia/commons/a/ab/Test.jpg",
                true
            )
            .is_ok()
        );
        for value in [
            "http://upload.wikimedia.org/wikipedia/commons/x.jpg",
            "https://upload.wikimedia.org.evil.test/wikipedia/commons/x.jpg",
            "https://upload.wikimedia.org/private/x.jpg",
            "https://user@upload.wikimedia.org/wikipedia/commons/x.jpg",
            "https://127.0.0.1/wikipedia/commons/x.jpg",
        ] {
            assert!(approved_url(value, true).is_err());
        }
        assert!(
            validate_addresses(&[
                "8.8.8.8:443".parse().unwrap(),
                "127.0.0.1:443".parse().unwrap()
            ])
            .is_err()
        );
        assert!(validate_addresses(&[]).is_err());
    }
    #[test]
    fn system_proxy_configuration_cannot_disable_direct_provider_dns_checks() {
        let synthetic = ["198.19.2.163:0".parse().unwrap()];
        for mode in [NetworkMode::System, NetworkMode::Direct] {
            assert!(validate_resolution("commons.wikimedia.org", mode, &synthetic).is_err());
        }
        let local_proxy = ["127.0.0.1:0".parse().unwrap()];
        assert!(validate_resolution("localhost", NetworkMode::System, &local_proxy).is_ok());
        assert!(validate_resolution("localhost", NetworkMode::Direct, &local_proxy).is_err());
        assert!(matches!(
            parse_request(json!({"action":"search","query":"landscape"})).unwrap(),
            Request::Search {
                network_mode: NetworkMode::System,
                ..
            }
        ));
        assert!(
            parse_request(json!({"action":"search","query":"landscape","networkMode":"direct"}))
                .is_ok()
        );
        for request in [
            json!({"action":"search","query":"landscape","proxyUrl":"http://127.0.0.1:1234"}),
            json!({"action":"preview","pageId":123,"networkMode":"insecure"}),
            json!({"action":"search","query":"landscape","networkMode":"system","dangerAcceptInvalidCerts":true}),
        ] {
            assert!(parse_request(request).is_err());
        }
    }
    #[test]
    fn license_selection_refuses_unknown_and_attribution_required_sources() {
        let mut source = json!({"query":{"pages":{"12":{"pageid":12,"title":"File:Example.jpg","imageinfo":[{"url":"https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg","mime":"image/jpeg","width":1200,"height":800,"size":1000,"extmetadata":{"LicenseShortName":{"value":"Public domain"},"Artist":{"value":"<b>Example</b> author"}}}]}}}});
        let parsed = parse_images(&source);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].author, "Example author");
        source["query"]["pages"]["12"]["imageinfo"][0]["extmetadata"]["LicenseShortName"]["value"] =
            json!("CC BY-SA 4.0");
        assert!(parse_images(&source).is_empty());
    }
    #[test]
    fn images_are_decoded_redrawn_and_connected_to_existing_library() {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(640, 360)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        let data_url = render_image(&bytes, "image/png", false).unwrap();
        assert!(data_url.starts_with("data:image/jpeg;base64,"));
        assert!(data_url.len() < 96 * 1024);
        assert!(decode_image(&bytes, "image/jpeg").is_err());
        assert!(render_image(b"RIFF0000WEBPbad", "image/webp", false).is_err());
        let directory = tempfile::tempdir().unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let entry = library
            .add(WallpaperInput {
                name: "Wallpaper".into(),
                data_url,
            })
            .unwrap();
        let settings = next_settings(
            &json!({"schemaVersion":3,"accent":"rose"}),
            Some(&entry),
            "contain",
        )
        .unwrap();
        assert_eq!(settings["accent"], "rose");
        assert_eq!(settings["customBackground"]["fit"], "contain");
        assert_eq!(library.list(None).unwrap()[0].id, entry.id);
        assert!(next_settings(&json!({"schemaVersion":99}), Some(&entry), "cover").is_err());
    }
    #[test]
    fn excessive_dimensions_and_corrupt_gallery_previews_are_rejected() {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgb8(8193, 1)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        assert!(decode_image(&bytes, "image/png").is_err());
        assert!(gallery_preview("data:image/jpeg;base64,YmFk").is_none());
        assert!(gallery_preview("https://untrusted.test/x.jpg").is_none());
    }
    #[test]
    fn applying_gallery_image_uses_real_settings_cas_without_overwriting_other_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        let settings = SettingsStore::open(settings_path.clone()).unwrap();
        let first = settings
            .save(
                json!({"schemaVersion":3,"accent":"rose","language":"en"}),
                0,
            )
            .unwrap();
        let library = WallpaperStore::new(directory.path().join("wallpapers.json"));
        let mut png = Vec::new();
        image::DynamicImage::new_rgb8(64, 36)
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .unwrap();
        let entry = library
            .add(WallpaperInput {
                name: "Test wallpaper".into(),
                data_url: render_image(&png, "image/png", false).unwrap(),
            })
            .unwrap();
        let updated =
            apply_settings(&settings, &library, &entry.id, first.revision, "contain").unwrap();
        assert_eq!(updated.settings["accent"], "rose");
        assert_eq!(updated.settings["language"], "en");
        assert_eq!(updated.settings["background"], "custom");
        let persisted = std::fs::read(&settings_path).unwrap();
        assert_eq!(
            apply_settings(&settings, &library, &entry.id, first.revision, "cover")
                .unwrap_err()
                .code,
            ErrorCode::SettingsConflict
        );
        assert_eq!(std::fs::read(&settings_path).unwrap(), persisted);
        assert_eq!(
            SettingsStore::open(settings_path)
                .unwrap()
                .snapshot()
                .unwrap(),
            updated
        );
    }
    #[test]
    #[ignore = "requires the official Commons network service"]
    fn live_commons_search_download_and_redraw_use_only_approved_sources() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let (bytes, _) = fetch(
                    &api_url(Some("landscape"), None),
                    false,
                    API_LIMIT,
                    NetworkMode::System,
                )
                .await
                .unwrap();
                let value: Value = serde_json::from_slice(&bytes).unwrap();
                let images = parse_images(&value);
                assert!(!images.is_empty());
                let image = lookup(images[0].page_id, NetworkMode::System)
                    .await
                    .unwrap();
                let (bytes, mime) = fetch(
                    &image.preview_url,
                    true,
                    2 * 1024 * 1024,
                    NetworkMode::System,
                )
                .await
                .unwrap();
                assert!(
                    render_image(&bytes, &mime, true)
                        .unwrap()
                        .starts_with("data:image/jpeg;base64,")
                );
            });
    }
    #[test]
    #[ignore = "requires checking the current machine's public or synthetic DNS"]
    fn live_direct_mode_refuses_the_current_synthetic_provider_dns() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let addresses = ("commons.wikimedia.org", 0)
                    .to_socket_addrs()
                    .unwrap()
                    .collect::<Vec<_>>();
                if addresses.iter().any(|address| !is_public_ip(address.ip())) {
                    assert_eq!(
                        resolve_transport("commons.wikimedia.org".into(), NetworkMode::Direct)
                            .await
                            .unwrap_err()
                            .code,
                        ErrorCode::InvalidArgument
                    );
                    assert!(
                        fetch(
                            &api_url(Some("landscape"), None),
                            false,
                            API_LIMIT,
                            NetworkMode::Direct
                        )
                        .await
                        .is_err()
                    );
                } else {
                    assert!(validate_addresses(&addresses).is_ok());
                }
            });
    }
}
