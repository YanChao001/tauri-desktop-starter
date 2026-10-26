//! Fixed desktop capabilities for opaque UI documents; never a general IPC router.
use crate::{
    blocking,
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extensions::{
        ExtensionInfo, ExtensionPermission, ExtensionSnapshot, ExtensionStore, WindowRunToken,
    },
};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionService {
    Lan,
    Wallpaper,
    Resources,
    Links,
}
impl ExtensionService {
    fn permission(self) -> ExtensionPermission {
        match self {
            Self::Lan => ExtensionPermission::MessagingLan,
            Self::Wallpaper => ExtensionPermission::WallpapersManage,
            Self::Resources => ExtensionPermission::NetworkImages,
            Self::Links => ExtensionPermission::LinksOpen,
        }
    }
}
pub struct ExtensionServices {
    pub gate: tokio::sync::RwLock<()>,
    identities: Mutex<HashMap<(String, ExtensionService), ExtensionInfo>>,
    owners: Mutex<HashMap<String, HashSet<String>>>,
    capacity: tokio::sync::Semaphore,
}
impl Default for ExtensionServices {
    fn default() -> Self {
        Self {
            gate: tokio::sync::RwLock::new(()),
            identities: Mutex::default(),
            owners: Mutex::default(),
            capacity: tokio::sync::Semaphore::new(8),
        }
    }
}
struct ServiceAdmission<'a> {
    token: WindowRunToken,
    _capacity: tokio::sync::SemaphorePermit<'a>,
    _gate: tokio::sync::RwLockReadGuard<'a, ()>,
}
impl ExtensionServices {
    async fn admit(
        &self,
        store: &ExtensionStore,
        owner: String,
    ) -> NativeResult<ServiceAdmission<'_>> {
        let capacity = self
            .capacity
            .try_acquire()
            .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "Desktop services are busy"))?;
        // Capture before the first await: a queued old window must not acquire a reopened epoch.
        let token = store.window_run_token(owner)?;
        let gate = self.gate.read().await;
        store.check_run_available(&token)?;
        Ok(ServiceAdmission {
            token,
            _capacity: capacity,
            _gate: gate,
        })
    }
}
#[derive(Clone)]
pub(crate) struct ServicePermit(Arc<crate::extensions::ServiceActivity>);
impl ServicePermit {
    #[cfg(test)]
    pub(crate) fn for_test(activity: Arc<crate::extensions::ServiceActivity>) -> Self {
        Self(activity)
    }
    pub(crate) fn check(&self) -> NativeResult<()> {
        self.0.check()
    }
    pub(crate) fn commit<T>(&self, operation: impl FnOnce() -> NativeResult<T>) -> NativeResult<T> {
        self.0.commit(operation)
    }
}
fn authorized(item: &ExtensionInfo, service: ExtensionService) -> NativeResult<()> {
    require_permission(item, service.permission())
}
fn require_permission(item: &ExtensionInfo, permission: ExtensionPermission) -> NativeResult<()> {
    if !item.enabled
        || !item.package.manifest.has_permission(permission)
        || !item.granted_permissions.contains(&permission)
    {
        return Err(NativeError::new(
            ErrorCode::ExtensionUnavailable,
            "Desktop service permission is not granted",
        ));
    }
    Ok(())
}

// 服务权限不能隐式授予其他网络范围；按具体动作再检查组合能力。
fn authorized_request(
    item: &ExtensionInfo,
    service: ExtensionService,
    request: &serde_json::Value,
) -> NativeResult<()> {
    authorized(item, service)?;
    if service == ExtensionService::Resources
        && request
            .get("networkMode")
            .and_then(serde_json::Value::as_str)
            == Some("system")
    {
        require_permission(item, ExtensionPermission::NetworkSystemProxy)?;
    }
    if service == ExtensionService::Wallpaper
        && request.get("action").and_then(serde_json::Value::as_str) == Some("import-resource")
    {
        require_permission(item, ExtensionPermission::NetworkImages)?;
    }
    Ok(())
}

fn external_url(request: serde_json::Value) -> NativeResult<String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct LinkRequest {
        url: String,
    }
    let request: LinkRequest = serde_json::from_value(request).map_err(|_| {
        NativeError::new(ErrorCode::InvalidArgument, "Invalid external link request")
    })?;
    bounded_text(
        &request.url,
        crate::extension_network::HTTP_URL_LIMIT,
        "External link",
    )?;
    if request.url.chars().any(char::is_control) {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Invalid external link URL",
        ));
    }
    // 浏览器负责最终连接；这里只校验公共 HTTPS 名称，不声称控制浏览器的 DNS。
    let (source, fragment) = request
        .url
        .split_once('#')
        .map_or((request.url.as_str(), None), |(source, fragment)| {
            (source, Some(fragment))
        });
    let mut parsed = crate::extension_network::approved_public_url(source)?;
    parsed.set_fragment(fragment);
    Ok(parsed.into())
}

/// Registry identities and granted capabilities are independent of native window epochs.
/// Only retiring a LAN record requests LAN cleanup; wallpaper has no retained listener.
fn retain_authorized_services(
    identities: &mut HashMap<(String, ExtensionService), ExtensionInfo>,
    items: &[ExtensionInfo],
) -> Vec<String> {
    let mut retired_lan = Vec::new();
    identities.retain(|(id, service), old| {
        let valid = items.iter().any(|item| {
            item.package.manifest.id == *id
                && item.generation == old.generation
                && item.package.sha256 == old.package.sha256
                && authorized(item, *service).is_ok()
        });
        if !valid && *service == ExtensionService::Lan {
            retired_lan.push(id.clone());
        }
        valid
    });
    retired_lan
}
#[tauri::command]
#[specta::specta]
pub async fn request_extension_service(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    expected_sha256: String,
    expected_generation: i32,
    service: ExtensionService,
    request: String,
) -> NativeResult<String> {
    bounded_text(&id, 80, "Extension ID")?;
    bounded_text(&request, 512 * 1024, "Service request")?;
    let request: serde_json::Value = serde_json::from_str(&request)
        .map_err(|_| NativeError::new(ErrorCode::InvalidArgument, "Invalid service JSON"))?;
    if !request.is_object() {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            "Service request must be an object",
        ));
    }
    let services = app.state::<ExtensionServices>();
    let store = app.state::<ExtensionStore>().inner().clone();
    let admission = services.admit(&store, window.label().into()).await?;
    let token = admission.token.clone();
    let current_store = store.clone();
    let item = blocking::run(move || {
        current_store.current_entry(&id, &expected_sha256, expected_generation)
    })
    .await?;
    store.check_run_available(&token)?;
    authorized_request(&item, service, &request)?;
    let permit = ServicePermit(store.begin_service(token.clone())?);
    let owner = permit.0.owner();
    {
        let mut owners = services
            .owners
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Service owners unavailable"))?;
        permit.check()?;
        owners
            .entry(window.label().into())
            .or_default()
            .insert(owner.clone());
    }
    services
        .identities
        .lock()
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Service identities unavailable"))?
        .insert((item.package.manifest.id.clone(), service), item.clone());
    let result = match service {
        ExtensionService::Lan => {
            crate::extension_lan::request(
                app.clone(),
                &owner,
                &item.package.manifest.id,
                request,
                permit.clone(),
            )
            .await?
        }
        ExtensionService::Wallpaper => {
            crate::extension_wallpaper::request(
                app.clone(),
                &owner,
                crate::extension_resources::ResourceIdentity::from(&item),
                request,
                permit.clone(),
            )
            .await?
        }
        ExtensionService::Resources => {
            crate::extension_resources::request(
                app.clone(),
                &owner,
                crate::extension_resources::ResourceIdentity::from(&item),
                request,
                permit.clone(),
            )
            .await?
        }
        ExtensionService::Links => {
            let url = external_url(request)?;
            let app = app.clone();
            blocking::run(move || {
                permit.commit(|| {
                    app.opener().open_url(url, None::<&str>).map_err(|_| {
                        NativeError::new(ErrorCode::ExtensionRunFailed, "Cannot open external link")
                    })?;
                    Ok(serde_json::Value::Null)
                })
            })
            .await?
        }
    };
    store.check_run_available(&token)?;
    let result = serde_json::to_string(&result)
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Cannot encode service result"))?;
    bounded_text(&result, 12 * 1024 * 1024, "Service response")?;
    Ok(result)
}

/// Called under the write gate only after a successful registry mutation.
pub async fn reconcile(app: &tauri::AppHandle, snapshot: &ExtensionSnapshot) -> NativeResult<()> {
    let ids = {
        let state = app.state::<ExtensionServices>();
        let mut identities = state
            .identities
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Service identities unavailable"))?;
        retain_authorized_services(&mut identities, &snapshot.items)
    };
    let resources = crate::extension_resources::retain_authorized(&snapshot.items);
    let app = app.clone();
    blocking::run(move || {
        for id in ids {
            crate::extension_lan::stop_extension(&app, &id);
        }
        resources
    })
    .await
}
pub fn take_window_owners(app: &tauri::AppHandle, owner: &str) -> Vec<String> {
    app.state::<ExtensionServices>()
        .owners
        .lock()
        .map(|mut owners| {
            owners
                .remove(owner)
                .unwrap_or_default()
                .into_iter()
                .collect()
        })
        .unwrap_or_default()
}
pub async fn close_window(app: tauri::AppHandle, owners: Vec<String>) {
    let services = app.state::<ExtensionServices>();
    let _guard = services.gate.write().await;
    let handle = app.clone();
    if let Err(error) = blocking::run(move || {
        let resources = crate::extension_resources::close_owners(&owners);
        for owner in owners {
            crate::extension_lan::close_window(&handle, &owner);
        }
        resources
    })
    .await
    {
        log::warn!("Cannot close extension services: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::{ExtensionManifest, ExtensionOrigin, ExtensionPreview};
    use serde_json::json;

    fn item(id: &str, grants: &[ExtensionPermission]) -> ExtensionInfo {
        let manifest: ExtensionManifest = serde_json::from_value(json!({
            "formatVersion": 3, "apiVersion": 2, "minHostVersion": "0.1.4",
            "id": id, "version": "1.0.0", "name": "Service fixture", "author": "Test",
            "description": "Service boundary regression", "permissions": [],
            "optionalPermissions": ["messaging:lan", "wallpapers:manage", "network:images", "network:system-proxy", "links:open"], "network": [],
            "commands": [{"id":"open", "title":"Open", "function":"open", "inputFormat":"json", "resultFormat":"view", "permissions":[]}]
        })).unwrap();
        ExtensionInfo {
            package: ExtensionPreview {
                manifest,
                sha256: "a".repeat(64),
                bytes: 100,
                ui_documents: vec![],
            },
            generation: 1,
            enabled: true,
            granted_permissions: grants.to_vec(),
            origin: ExtensionOrigin::Local,
            previous_package: None,
            previous_origin: None,
        }
    }

    fn tracked(item: &ExtensionInfo) -> HashMap<(String, ExtensionService), ExtensionInfo> {
        [ExtensionService::Lan, ExtensionService::Wallpaper]
            .map(|service| ((item.package.manifest.id.clone(), service), item.clone()))
            .into_iter()
            .collect()
    }

    #[test]
    fn resource_network_proxy_links_and_gallery_grants_do_not_substitute_each_other() {
        use ExtensionPermission::{LinksOpen, NetworkImages, NetworkSystemProxy, WallpapersManage};
        let fetch = json!({"action":"fetch-image", "url":"https://images.site.org/picture.jpg"});
        let system = json!({"action":"fetch-image", "url":"https://images.site.org/picture.jpg", "networkMode":"system"});
        let import =
            json!({"action":"import-resource", "resourceId":"a".repeat(64), "name":"Image"});
        let link = json!({"url":"https://images.site.org/source"});
        for grant in [WallpapersManage, LinksOpen, NetworkSystemProxy] {
            assert!(
                authorized_request(
                    &item("test.services", &[grant]),
                    ExtensionService::Resources,
                    &fetch
                )
                .is_err()
            );
        }
        let images = item("test.services", &[NetworkImages]);
        authorized_request(&images, ExtensionService::Resources, &fetch).unwrap();
        assert!(authorized_request(&images, ExtensionService::Resources, &system).is_err());
        assert!(authorized_request(&images, ExtensionService::Links, &link).is_err());
        assert!(authorized_request(&images, ExtensionService::Wallpaper, &import).is_err());
        let gallery = item("test.services", &[WallpapersManage]);
        assert!(authorized_request(&gallery, ExtensionService::Wallpaper, &import).is_err());
        authorized_request(
            &gallery,
            ExtensionService::Wallpaper,
            &json!({"action":"list"}),
        )
        .unwrap();
        let combined = item(
            "test.services",
            &[
                NetworkImages,
                NetworkSystemProxy,
                WallpapersManage,
                LinksOpen,
            ],
        );
        authorized_request(&combined, ExtensionService::Resources, &system).unwrap();
        authorized_request(&combined, ExtensionService::Wallpaper, &import).unwrap();
        authorized_request(&combined, ExtensionService::Links, &link).unwrap();
        let mut undeclared = combined.clone();
        undeclared
            .package
            .manifest
            .optional_permissions
            .retain(|permission| *permission != NetworkSystemProxy);
        assert!(authorized_request(&undeclared, ExtensionService::Resources, &system).is_err());
        let mut disabled = combined;
        disabled.enabled = false;
        assert!(authorized_request(&disabled, ExtensionService::Resources, &fetch).is_err());
    }

    #[test]
    fn external_links_are_bounded_public_https_and_not_native_routes_or_paths() {
        assert_eq!(
            external_url(json!({"url":"https://www.wikimedia.org/wiki/File#Licensing"})).unwrap(),
            "https://www.wikimedia.org/wiki/File#Licensing"
        );
        for url in [
            "http://www.wikimedia.org/image",
            "file:///C:/secret.txt",
            "tauri://localhost/",
            "javascript:alert(1)",
            "https://user:secret@www.wikimedia.org/",
            "https://@www.wikimedia.org/",
            "https://127.0.0.1/",
            "https://192.168.0.1/",
            "https://machine.local/",
            "https://www.wikimedia.org:8080/",
            "https://www.wikimedia.org/\nsecret",
            "https://example.org/",
        ] {
            assert!(external_url(json!({"url":url})).is_err(), "{url}");
        }
        assert!(
            external_url(json!({"url":format!("https://www.wikimedia.org/{}", "x".repeat(4096))}))
                .is_err()
        );
        assert!(
            external_url(json!({"url":"https://www.wikimedia.org/", "path":"C:/secret"})).is_err()
        );
        assert!(
            external_url(json!({"url":"https://www.wikimedia.org/", "identity":"other.plugin"}))
                .is_err()
        );
    }

    #[test]
    fn service_grants_are_explicit_declared_and_do_not_authorize_each_other() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        for (grants, lan, wallpaper) in [
            (vec![], false, false),
            (vec![MessagingLan], true, false),
            (vec![WallpapersManage], false, true),
            (vec![MessagingLan, WallpapersManage], true, true),
            (
                vec![
                    ExtensionPermission::NetworkLocal,
                    ExtensionPermission::Storage,
                ],
                false,
                false,
            ),
        ] {
            let current = item("test.services", &grants);
            assert_eq!(authorized(&current, ExtensionService::Lan).is_ok(), lan);
            assert_eq!(
                authorized(&current, ExtensionService::Wallpaper).is_ok(),
                wallpaper
            );
        }
        let mut undeclared = item("test.services", &[MessagingLan]);
        undeclared.package.manifest.optional_permissions.clear();
        assert!(matches!(
            authorized(&undeclared, ExtensionService::Lan)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionUnavailable
        ));
        let mut disabled = item("test.services", &[MessagingLan, WallpapersManage]);
        disabled.enabled = false;
        assert!(authorized(&disabled, ExtensionService::Lan).is_err());
        assert!(authorized(&disabled, ExtensionService::Wallpaper).is_err());
    }

    #[test]
    fn revoking_wallpaper_keeps_an_authorized_lan_listener() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        let old = item("test.services", &[MessagingLan, WallpapersManage]);
        let mut identities = tracked(&old);
        let mut current = old.clone();
        current.granted_permissions = vec![MessagingLan];
        assert!(
            retain_authorized_services(&mut identities, std::slice::from_ref(&current)).is_empty()
        );
        assert_eq!(identities.len(), 1);
        assert!(identities.contains_key(&("test.services".into(), ExtensionService::Lan)));
        assert!(retain_authorized_services(&mut identities, &[current]).is_empty());
    }

    #[test]
    fn revoking_lan_stops_only_its_listener_and_keeps_wallpaper_identity() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        let old = item("test.services", &[MessagingLan, WallpapersManage]);
        let mut identities = tracked(&old);
        let mut current = old.clone();
        current.granted_permissions = vec![WallpapersManage];
        assert_eq!(
            retain_authorized_services(&mut identities, std::slice::from_ref(&current)),
            ["test.services"]
        );
        assert_eq!(identities.len(), 1);
        assert!(identities.contains_key(&("test.services".into(), ExtensionService::Wallpaper)));
        assert!(retain_authorized_services(&mut identities, &[current]).is_empty());
    }

    #[test]
    fn uninstall_disable_hash_and_generation_changes_retire_stale_service_identities() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        let old = item("test.services", &[MessagingLan, WallpapersManage]);
        let mut disabled = old.clone();
        disabled.enabled = false;
        let mut reinstalled = old.clone();
        reinstalled.generation += 1;
        let mut replaced = old.clone();
        replaced.package.sha256 = "b".repeat(64);
        let mut different_id = old.clone();
        different_id.package.manifest.id = "test.other".into();
        for items in [
            vec![],
            vec![disabled],
            vec![reinstalled],
            vec![replaced],
            vec![different_id],
        ] {
            let mut identities = tracked(&old);
            assert_eq!(
                retain_authorized_services(&mut identities, &items),
                ["test.services"]
            );
            assert!(identities.is_empty());
            assert!(retain_authorized_services(&mut identities, &items).is_empty());
        }
    }

    #[test]
    fn unrelated_registry_changes_keep_both_authorized_services() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        let old = item("test.services", &[MessagingLan, WallpapersManage]);
        let unrelated = item("test.unrelated", &[]);
        let mut identities = tracked(&old);
        assert!(retain_authorized_services(&mut identities, &[unrelated, old]).is_empty());
        assert_eq!(identities.len(), 2);
    }

    #[tokio::test]
    async fn queued_service_admission_cannot_switch_to_a_reopened_window_epoch() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionStore::new(directory.path().join("extensions"), false);
        let services = Arc::new(ExtensionServices::default());
        let gate = services.gate.write().await;
        let queued = services.clone();
        let queued_store = store.clone();
        let pending =
            tokio::spawn(
                async move { queued.admit(&queued_store, "main".into()).await.map(|_| ()) },
            );
        // The current-thread runtime runs the task up to its first await at the write gate.
        tokio::task::yield_now().await;
        assert_eq!(services.capacity.available_permits(), 7);
        store.begin_window_close("main").unwrap();
        store.reopen_window("main").unwrap();
        drop(gate);
        assert!(matches!(
            pending.await.unwrap().unwrap_err().code,
            ErrorCode::ExtensionUnavailable
        ));
        assert_eq!(services.capacity.available_permits(), 8);
        assert!(services.admit(&store, "main".into()).await.is_ok());
    }
}
