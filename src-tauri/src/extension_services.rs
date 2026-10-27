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
    sync::{Arc, Mutex, Weak},
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
    Window,
}
impl ExtensionService {
    fn permission(self) -> ExtensionPermission {
        match self {
            Self::Lan => ExtensionPermission::MessagingLan,
            Self::Wallpaper => ExtensionPermission::WallpapersManage,
            Self::Resources => ExtensionPermission::NetworkImages,
            Self::Links => ExtensionPermission::LinksOpen,
            Self::Window => ExtensionPermission::WindowControl,
        }
    }
}
pub struct ExtensionServices {
    pub gate: Arc<tokio::sync::RwLock<()>>,
    extension_gates: Mutex<HashMap<String, Weak<tokio::sync::RwLock<()>>>>,
    identities: Mutex<HashMap<(String, ExtensionService), ExtensionInfo>>,
    owners: Mutex<HashMap<String, HashSet<String>>>,
    capacity: tokio::sync::Semaphore,
    lan_stop_capacity: tokio::sync::Semaphore,
}
impl Default for ExtensionServices {
    fn default() -> Self {
        Self {
            gate: Arc::new(tokio::sync::RwLock::new(())),
            extension_gates: Mutex::default(),
            identities: Mutex::default(),
            owners: Mutex::default(),
            capacity: tokio::sync::Semaphore::new(8),
            lan_stop_capacity: tokio::sync::Semaphore::new(1),
        }
    }
}
struct ServiceAdmission<'a> {
    token: WindowRunToken,
    _capacity: tokio::sync::SemaphorePermit<'a>,
    _gate: tokio::sync::RwLockReadGuard<'a, ()>,
    _extension_gate: tokio::sync::OwnedRwLockReadGuard<()>,
}
pub(crate) struct ServiceMutation {
    id: String,
    _gate: tokio::sync::OwnedRwLockReadGuard<()>,
    _extension_gate: tokio::sync::OwnedRwLockWriteGuard<()>,
}
impl ServiceMutation {
    pub(crate) fn check_identity(&self, id: &str) -> NativeResult<()> {
        if self.id != id {
            return Err(NativeError::new(
                ErrorCode::InvalidArgument,
                "Extension maintenance identity does not match",
            ));
        }
        Ok(())
    }
}
impl ExtensionServices {
    fn extension_gate(&self, id: &str) -> NativeResult<Arc<tokio::sync::RwLock<()>>> {
        if !crate::extensions::valid_id(id) {
            return Err(NativeError::new(
                ErrorCode::InvalidArgument,
                "Invalid extension ID",
            ));
        }
        let mut gates = self
            .extension_gates
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Service gates unavailable"))?;
        gates.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = gates.get(id).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        let gate = Arc::new(tokio::sync::RwLock::new(()));
        gates.insert(id.into(), Arc::downgrade(&gate));
        Ok(gate)
    }

    pub(crate) async fn mutation(&self, id: &str) -> NativeResult<Arc<ServiceMutation>> {
        // 所有入口先取全局读锁，再取插件锁；只有归档取全局写锁。
        let gate = self.gate.clone().read_owned().await;
        let extension_gate = self.extension_gate(id)?.write_owned().await;
        Ok(Arc::new(ServiceMutation {
            id: id.into(),
            _gate: gate,
            _extension_gate: extension_gate,
        }))
    }

    async fn admit(
        &self,
        store: &ExtensionStore,
        owner: String,
        id: &str,
        lan_stop: bool,
    ) -> NativeResult<ServiceAdmission<'_>> {
        // 长传输和系统对话框可占满普通容量；停止仍保留一项有界容量，
        // 后续窗口代次、维护门闩、安装身份和权限检查与普通请求相同。
        let capacity = if lan_stop {
            &self.lan_stop_capacity
        } else {
            &self.capacity
        }
        .try_acquire()
        .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "Desktop services are busy"))?;
        // Capture before the first await: a queued old window must not acquire a reopened epoch.
        let token = store.window_run_token(owner)?;
        let gate = self.gate.read().await;
        let extension_gate = self.extension_gate(id)?.read_owned().await;
        store.check_run_available(&token)?;
        Ok(ServiceAdmission {
            token,
            _capacity: capacity,
            _gate: gate,
            _extension_gate: extension_gate,
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
fn is_lan_stop(service: ExtensionService, request: &serde_json::Value) -> bool {
    service == ExtensionService::Lan
        && request.as_object().is_some_and(|object| {
            object.len() == 1
                && object.get("action").and_then(serde_json::Value::as_str) == Some("stop")
        })
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
    changed_id: &str,
    items: &[ExtensionInfo],
) -> Vec<String> {
    let mut retired_lan = Vec::new();
    identities.retain(|(id, service), old| {
        if id != changed_id {
            return true;
        }
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
    let admission = services
        .admit(
            &store,
            window.label().into(),
            &id,
            is_lan_stop(service, &request),
        )
        .await?;
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
                item.clone(),
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
        ExtensionService::Window => {
            crate::extension_windows::request(window.clone(), item, request, permit).await?
        }
    };
    store.check_run_available(&token)?;
    let result = serde_json::to_string(&result)
        .map_err(|_| NativeError::new(ErrorCode::Internal, "Cannot encode service result"))?;
    bounded_text(&result, 12 * 1024 * 1024, "Service response")?;
    Ok(result)
}

/// 在对应插件的写门闩内，只撤回本次变更的身份，避免旧快照影响其他插件。
pub async fn reconcile(
    app: &tauri::AppHandle,
    id: &str,
    snapshot: &ExtensionSnapshot,
) -> NativeResult<()> {
    let ids = {
        let state = app.state::<ExtensionServices>();
        let mut identities = state
            .identities
            .lock()
            .map_err(|_| NativeError::new(ErrorCode::Internal, "Service identities unavailable"))?;
        retain_authorized_services(&mut identities, id, &snapshot.items)
    };
    let resources = crate::extension_resources::retain_authorized(id, &snapshot.items);
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
    // 调用方已使旧窗口 epoch 失效；按 owner 清理不会触及重开后的窗口。
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
            "optionalPermissions": ["messaging:lan", "wallpapers:manage", "network:images", "network:system-proxy", "links:open", "window:control"], "network": [],
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
    fn own_window_control_requires_its_declared_grant_and_an_enabled_installation() {
        use ExtensionPermission::{
            LinksOpen, MessagingLan, Storage, WallpapersManage, WindowControl,
        };
        for grants in [
            vec![],
            vec![Storage],
            vec![MessagingLan, WallpapersManage, LinksOpen],
        ] {
            assert!(authorized(&item("test.window", &grants), ExtensionService::Window).is_err());
        }
        let mut current = item("test.window", &[WindowControl]);
        authorized(&current, ExtensionService::Window).unwrap();
        assert!(authorized(&current, ExtensionService::Links).is_err());
        current.enabled = false;
        assert!(authorized(&current, ExtensionService::Window).is_err());
        current.enabled = true;
        current.package.manifest.optional_permissions.clear();
        assert!(authorized(&current, ExtensionService::Window).is_err());
    }

    #[test]
    fn resource_links_and_gallery_grants_do_not_substitute_each_other() {
        use ExtensionPermission::{LinksOpen, NetworkImages, NetworkSystemProxy, WallpapersManage};
        let fetch = json!({"action":"fetch-image", "url":"https://images.site.org/picture.jpg"});
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
        authorized_request(&combined, ExtensionService::Resources, &fetch).unwrap();
        authorized_request(&combined, ExtensionService::Wallpaper, &import).unwrap();
        authorized_request(&combined, ExtensionService::Links, &link).unwrap();
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
            retain_authorized_services(
                &mut identities,
                "test.services",
                std::slice::from_ref(&current)
            )
            .is_empty()
        );
        assert_eq!(identities.len(), 1);
        assert!(identities.contains_key(&("test.services".into(), ExtensionService::Lan)));
        assert!(
            retain_authorized_services(&mut identities, "test.services", &[current]).is_empty()
        );
    }

    #[test]
    fn revoking_lan_stops_only_its_listener_and_keeps_wallpaper_identity() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        let old = item("test.services", &[MessagingLan, WallpapersManage]);
        let mut identities = tracked(&old);
        let mut current = old.clone();
        current.granted_permissions = vec![WallpapersManage];
        assert_eq!(
            retain_authorized_services(
                &mut identities,
                "test.services",
                std::slice::from_ref(&current)
            ),
            ["test.services"]
        );
        assert_eq!(identities.len(), 1);
        assert!(identities.contains_key(&("test.services".into(), ExtensionService::Wallpaper)));
        assert!(
            retain_authorized_services(&mut identities, "test.services", &[current]).is_empty()
        );
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
                retain_authorized_services(&mut identities, "test.services", &items),
                ["test.services"]
            );
            assert!(identities.is_empty());
            assert!(
                retain_authorized_services(&mut identities, "test.services", &items).is_empty()
            );
        }
    }

    #[test]
    fn unrelated_registry_changes_keep_both_authorized_services() {
        use ExtensionPermission::{MessagingLan, WallpapersManage};
        let old = item("test.services", &[MessagingLan, WallpapersManage]);
        let unrelated = item("test.unrelated", &[]);
        let mut identities = tracked(&old);
        assert!(
            retain_authorized_services(&mut identities, "test.unrelated", &[unrelated]).is_empty()
        );
        assert_eq!(identities.len(), 2);
    }

    #[test]
    fn only_the_exact_lan_stop_request_uses_the_control_capacity() {
        assert!(is_lan_stop(
            ExtensionService::Lan,
            &json!({"action":"stop"})
        ));
        for service in [
            ExtensionService::Wallpaper,
            ExtensionService::Resources,
            ExtensionService::Links,
            ExtensionService::Window,
        ] {
            assert!(!is_lan_stop(service, &json!({"action":"stop"})));
        }
        for request in [
            json!({"action":"status"}),
            json!({"action":"sendAttachment"}),
            json!({"action":"stop", "peerId":"other"}),
            json!({"action":null}),
            json!(["stop"]),
        ] {
            assert!(!is_lan_stop(ExtensionService::Lan, &request));
        }
    }

    #[tokio::test]
    async fn saturated_desktop_services_leave_bounded_capacity_for_lan_stop() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionStore::new(directory.path().join("extensions"), false);
        let services = ExtensionServices::default();
        let mut normal = Vec::new();
        for _ in 0..8 {
            normal.push(
                services
                    .admit(&store, "main".into(), "test.services", false)
                    .await
                    .unwrap(),
            );
        }
        assert_eq!(
            services
                .admit(&store, "main".into(), "test.services", false)
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        let stop = services
            .admit(&store, "main".into(), "test.services", true)
            .await
            .unwrap();
        assert_eq!(services.capacity.available_permits(), 0);
        assert_eq!(services.lan_stop_capacity.available_permits(), 0);
        assert_eq!(
            services
                .admit(&store, "main".into(), "test.services", true)
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        drop(stop);
        store.begin_window_close("main").unwrap();
        assert_eq!(
            services
                .admit(&store, "main".into(), "test.services", true)
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_eq!(services.lan_stop_capacity.available_permits(), 1);
        drop(normal);
        assert_eq!(services.capacity.available_permits(), 8);
    }

    #[tokio::test]
    async fn queued_service_admission_cannot_switch_to_a_reopened_window_epoch() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionStore::new(directory.path().join("extensions"), false);
        let services = Arc::new(ExtensionServices::default());
        let gate = services.gate.write().await;
        let queued = services.clone();
        let queued_store = store.clone();
        let pending = tokio::spawn(async move {
            queued
                .admit(&queued_store, "main".into(), "test.services", false)
                .await
                .map(|_| ())
        });
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
        assert!(
            services
                .admit(&store, "main".into(), "test.services", false)
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn active_services_only_block_mutations_of_the_same_extension() {
        let directory = tempfile::tempdir().unwrap();
        let store = ExtensionStore::new(directory.path().join("extensions"), false);
        let services = Arc::new(ExtensionServices::default());
        let active = services
            .admit(&store, "main".into(), "test.first", false)
            .await
            .unwrap();
        // 模拟仍在等待用户的保存服务；其他插件管理无需等待这个读租约。
        let unrelated = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            services.mutation("test.second"),
        )
        .await
        .expect("Unrelated extension mutation waited for an active service")
        .unwrap();
        let queued = services.clone();
        let same_extension = tokio::spawn(async move {
            let _mutation = queued.mutation("test.first").await.unwrap();
        });
        tokio::task::yield_now().await;
        assert!(!same_extension.is_finished());
        drop(unrelated);
        drop(active);
        same_extension.await.unwrap();
    }

    #[tokio::test]
    async fn maintenance_remains_exclusive_until_the_actual_blocking_operation_finishes() {
        let services = Arc::new(ExtensionServices::default());
        let maintenance = services.mutation("test.first").await.unwrap();
        assert!(maintenance.check_identity("test.second").is_err());
        let (entered_send, entered_recv) = std::sync::mpsc::channel();
        let (release_send, release_recv) = std::sync::mpsc::channel();
        let actual = maintenance.clone();
        let worker = std::thread::spawn(move || {
            let _maintenance = actual;
            entered_send.send(()).unwrap();
            let _ = release_recv.recv();
        });
        entered_recv
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        // 代表前端已停止等待；原生实际工作仍持有 owned 门闩。
        drop(maintenance);
        let queued = services.clone();
        let same_plugin = tokio::spawn(async move { queued.mutation("test.first").await });
        tokio::task::yield_now().await;
        assert!(!same_plugin.is_finished());
        let other = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            services.mutation("test.second"),
        )
        .await
        .unwrap()
        .unwrap();
        drop(other);
        release_send.send(()).unwrap();
        worker.join().unwrap();
        same_plugin.await.unwrap().unwrap();
    }
}
