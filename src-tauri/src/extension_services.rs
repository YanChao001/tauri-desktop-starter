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
    capacity: Arc<tokio::sync::Semaphore>,
    lan_stop_capacity: Arc<tokio::sync::Semaphore>,
}
impl Default for ExtensionServices {
    fn default() -> Self {
        Self {
            gate: Arc::new(tokio::sync::RwLock::new(())),
            extension_gates: Mutex::default(),
            identities: Mutex::default(),
            owners: Mutex::default(),
            capacity: Arc::new(tokio::sync::Semaphore::new(8)),
            lan_stop_capacity: Arc::new(tokio::sync::Semaphore::new(1)),
        }
    }
}
struct ServiceAdmission {
    token: WindowRunToken,
    lan_stop: bool,
    _capacity: tokio::sync::OwnedSemaphorePermit,
    _gate: tokio::sync::OwnedRwLockReadGuard<()>,
    _extension_gate: tokio::sync::OwnedRwLockReadGuard<()>,
}
struct ServiceIdentity {
    id: String,
    sha256: String,
    generation: i32,
}
struct AuthorizedService {
    token: WindowRunToken,
    item: ExtensionInfo,
    permit: ServicePermit,
}
struct ServiceLease {
    activity: Arc<crate::extensions::ServiceActivity>,
    _admission: Option<Arc<ServiceAdmission>>,
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

    /// 已准入的阻塞任务内完成变更、资源撤回与通知；清理失败不撤销已提交的事实。
    pub(crate) fn commit_mutation(
        &self,
        store: &ExtensionStore,
        maintenance: Arc<ServiceMutation>,
        lan: &crate::extension_lan::ExtensionLan,
        mutation: impl FnOnce() -> NativeResult<ExtensionSnapshot>,
        notify: impl FnOnce(),
    ) -> NativeResult<ExtensionSnapshot> {
        let _activity = store.begin_management()?;
        let snapshot = mutation()?;
        let cleanup = self.reconcile(&maintenance.id, &snapshot, lan);
        notify();
        cleanup?;
        Ok(snapshot)
    }

    fn reconcile(
        &self,
        id: &str,
        snapshot: &ExtensionSnapshot,
        lan: &crate::extension_lan::ExtensionLan,
    ) -> NativeResult<()> {
        let ids = {
            let mut identities = self.identities.lock().map_err(|_| {
                NativeError::new(ErrorCode::Internal, "Service identities unavailable")
            })?;
            retain_authorized_services(&mut identities, id, &snapshot.items)
        };
        let resources = crate::extension_resources::retain_authorized(id, &snapshot.items);
        // 沿用当前执行位完成清理，不在提交后重新竞争阻塞容量。
        for id in ids {
            lan.stop_extension(&id);
        }
        resources
    }

    async fn admit(
        &self,
        store: &ExtensionStore,
        owner: String,
        id: &str,
        lan_stop: bool,
    ) -> NativeResult<Arc<ServiceAdmission>> {
        // 长传输和系统对话框可占满普通容量；停止仍保留一项有界容量，
        // 后续窗口代次、维护门闩、安装身份和权限检查与普通请求相同。
        let capacity = if lan_stop {
            &self.lan_stop_capacity
        } else {
            &self.capacity
        }
        .clone()
        .try_acquire_owned()
        .map_err(|_| NativeError::new(ErrorCode::ExtensionBusy, "Desktop services are busy"))?;
        // 首次 await 前捕获，排队的旧窗口不能换成重开后的 epoch。
        let token = store.window_run_token(owner)?;
        let gate = self.gate.clone().read_owned().await;
        let extension_gate = self.extension_gate(id)?.read_owned().await;
        store.check_run_available(&token)?;
        Ok(Arc::new(ServiceAdmission {
            token,
            lan_stop,
            _capacity: capacity,
            _gate: gate,
            _extension_gate: extension_gate,
        }))
    }

    // 命令与回归共用完整准入；分类只从精确请求得出，不接受调用方优先级。
    async fn authorize(
        &self,
        store: &ExtensionStore,
        owner: String,
        identity: ServiceIdentity,
        service: ExtensionService,
        request: &serde_json::Value,
    ) -> NativeResult<AuthorizedService> {
        let admission = self
            .admit(store, owner, &identity.id, is_lan_stop(service, request))
            .await?;
        let token = admission.token.clone();
        let item = admission.current_entry(store.clone(), identity).await?;
        store.check_run_available(&token)?;
        authorized_request(&item, service, request)?;
        let activity = if admission.lan_stop {
            store.begin_lan_stop_service(token.clone())?
        } else {
            store.begin_service(token.clone())?
        };
        Ok(AuthorizedService {
            token,
            item,
            permit: ServicePermit(Arc::new(ServiceLease {
                activity,
                _admission: Some(admission),
            })),
        })
    }
}
impl ServiceAdmission {
    async fn current_entry(
        self: &Arc<Self>,
        store: ExtensionStore,
        identity: ServiceIdentity,
    ) -> NativeResult<ExtensionInfo> {
        // 同步身份读取持有准入直到真实完成；取消 async 等待不能提前归还容量或维护门闩。
        let admission = self.clone();
        let read = move || {
            let _admission = admission;
            store.current_entry(&identity.id, &identity.sha256, identity.generation)
        };
        if self.lan_stop {
            // 仅一个精确 stop 可到达这里，不竞争通用 blocking::run 的 16 项容量，
            // 注册表文件 I/O 仍在阻塞池；维护、身份与授权检查保持不变。
            tauri::async_runtime::spawn_blocking(read)
                .await
                .map_err(|error| {
                    NativeError::operation(
                        ErrorCode::Internal,
                        "Cannot read LAN stop installation identity",
                        error,
                    )
                })?
        } else {
            blocking::run(read).await
        }
    }
}
#[derive(Clone)]
pub(crate) struct ServicePermit(Arc<ServiceLease>);
impl ServicePermit {
    #[cfg(test)]
    pub(crate) fn for_test(activity: Arc<crate::extensions::ServiceActivity>) -> Self {
        Self(Arc::new(ServiceLease {
            activity,
            _admission: None,
        }))
    }
    pub(crate) fn check(&self) -> NativeResult<()> {
        self.0.activity.check()
    }
    pub(crate) fn commit<T>(&self, operation: impl FnOnce() -> NativeResult<T>) -> NativeResult<T> {
        self.0.activity.commit(operation)
    }
    fn owner(&self) -> String {
        self.0.activity.owner()
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
    let AuthorizedService {
        token,
        item,
        permit,
    } = services
        .authorize(
            &store,
            window.label().into(),
            ServiceIdentity {
                id,
                sha256: expected_sha256,
                generation: expected_generation,
            },
            service,
            &request,
        )
        .await?;
    let owner = permit.owner();
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
    if let Err(error) = blocking::run_cleanup(move || {
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
    use std::{future::Future, pin::Pin, sync::mpsc, time::Duration};

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

    fn installed_lan() -> (tempfile::TempDir, ExtensionStore, ExtensionInfo) {
        use crate::extensions::{ExtensionConsent, InstallCondition, preview_package};
        let directory = crate::extension_paths::temporary_directory();
        let store = ExtensionStore::new(directory.path().join("extensions"), false);
        let mut content: serde_json::Value =
            serde_json::from_str(&crate::extension_test_support::package()).unwrap();
        content["manifest"]["id"] = "test.services".into();
        content["manifest"]["minHostVersion"] = "0.1.7".into();
        content["manifest"]["optionalPermissions"] = json!(["messaging:lan"]);
        let content = content.to_string();
        let preview = preview_package(&content).unwrap();
        let current = store
            .install_reviewed(
                &content,
                InstallCondition {
                    revision: 0,
                    replace: false,
                    sha256: &preview.sha256,
                },
                ExtensionOrigin::Local,
                ExtensionConsent {
                    trusted: true,
                    granted_permissions: vec![
                        ExtensionPermission::TextRead,
                        ExtensionPermission::MessagingLan,
                    ],
                },
                |_, _| Ok(()),
            )
            .unwrap()
            .items
            .remove(0);
        assert!(current.enabled);
        (directory, store, current)
    }

    fn identity(item: &ExtensionInfo) -> ServiceIdentity {
        ServiceIdentity {
            id: item.package.manifest.id.clone(),
            sha256: item.package.sha256.clone(),
            generation: item.generation,
        }
    }

    async fn authorize_lan(
        services: &ExtensionServices,
        store: &ExtensionStore,
        item: &ExtensionInfo,
        owner: &str,
        action: &str,
    ) -> NativeResult<AuthorizedService> {
        let request = json!({"action":action});
        services
            .authorize(
                store,
                owner.into(),
                identity(item),
                ExtensionService::Lan,
                &request,
            )
            .await
    }

    async fn assert_pending(future: &mut Pin<Box<impl Future>>) {
        std::future::poll_fn(|context| {
            assert!(future.as_mut().poll(context).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
    }

    fn assert_idle(services: &ExtensionServices, store: &ExtensionStore) {
        assert_eq!(services.capacity.available_permits(), 8);
        assert_eq!(services.lan_stop_capacity.available_permits(), 1);
        assert!(!store.is_running());
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
    async fn two_saturated_windows_leave_exactly_one_global_lan_stop_slot() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        let mut normal = Vec::new();
        for owner in ["main", "secondary"] {
            for _ in 0..4 {
                normal.push(
                    authorize_lan(&services, &store, &item, owner, "status")
                        .await
                        .unwrap(),
                );
            }
        }
        assert_eq!(
            authorize_lan(&services, &store, &item, "third", "status")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        let stop = authorize_lan(&services, &store, &item, "main", "stop")
            .await
            .unwrap();
        stop.permit.check().unwrap();
        stop.permit.commit(|| Ok(())).unwrap();
        assert_eq!(services.capacity.available_permits(), 0);
        assert_eq!(services.lan_stop_capacity.available_permits(), 0);
        for owner in ["main", "secondary"] {
            assert_eq!(
                authorize_lan(&services, &store, &item, owner, "stop")
                    .await
                    .err()
                    .unwrap()
                    .code,
                ErrorCode::ExtensionBusy
            );
        }
        drop(stop);
        // 两个窗口的普通租约仍然占满，另一个窗口也能使用归还后的唯一停止容量。
        drop(
            authorize_lan(&services, &store, &item, "secondary", "stop")
                .await
                .unwrap(),
        );
        assert_eq!(services.lan_stop_capacity.available_permits(), 1);
        assert!(store.is_running());
        drop(normal);
        assert_idle(&services, &store);
    }

    #[tokio::test]
    async fn lan_stop_started_first_does_not_consume_any_of_the_four_window_slots() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        let stop = authorize_lan(&services, &store, &item, "main", "stop")
            .await
            .unwrap();
        let mut normal = Vec::new();
        for _ in 0..4 {
            normal.push(
                authorize_lan(&services, &store, &item, "main", "status")
                    .await
                    .unwrap(),
            );
        }
        assert_eq!(
            authorize_lan(&services, &store, &item, "main", "status")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        assert_eq!(services.capacity.available_permits(), 4);
        drop(normal);
        assert!(store.is_running());
        drop(stop);
        assert_idle(&services, &store);
    }

    #[tokio::test]
    async fn queued_service_authorization_cannot_switch_to_a_reopened_window_epoch() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        for action in ["status", "stop"] {
            let gate = services.gate.write().await;
            let mut pending = Box::pin(authorize_lan(&services, &store, &item, "main", action));
            assert_pending(&mut pending).await;
            assert_eq!(
                services.lan_stop_capacity.available_permits(),
                usize::from(action != "stop")
            );
            store.begin_window_close("main").unwrap();
            store.reopen_window("main").unwrap();
            drop(gate);
            assert_eq!(
                pending.await.err().unwrap().code,
                ErrorCode::ExtensionUnavailable
            );
            assert_idle(&services, &store);
            drop(
                authorize_lan(&services, &store, &item, "main", action)
                    .await
                    .unwrap(),
            );
            assert_idle(&services, &store);
        }
    }

    #[tokio::test]
    async fn lan_stop_authorization_rejects_identity_grant_and_lifecycle_changes_without_leaking() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        let request = json!({"action":"stop"});
        for forged in [
            ServiceIdentity {
                id: "test.other".into(),
                ..identity(&item)
            },
            ServiceIdentity {
                sha256: "b".repeat(64),
                ..identity(&item)
            },
            ServiceIdentity {
                generation: item.generation + 1,
                ..identity(&item)
            },
        ] {
            assert_eq!(
                services
                    .authorize(
                        &store,
                        "main".into(),
                        forged,
                        ExtensionService::Lan,
                        &request
                    )
                    .await
                    .err()
                    .unwrap()
                    .code,
                ErrorCode::Conflict
            );
            assert_idle(&services, &store);
        }
        for (enabled, grants, allowed) in [
            (true, vec![ExtensionPermission::TextRead], false),
            (false, vec![], false),
            (true, item.granted_permissions.clone(), true),
        ] {
            let maintenance = services.mutation(&item.package.manifest.id).await.unwrap();
            store
                .set_enabled(
                    &item.package.manifest.id,
                    enabled,
                    grants,
                    store.snapshot().unwrap().revision,
                    true,
                )
                .unwrap();
            drop(maintenance);
            let result = authorize_lan(&services, &store, &item, "main", "stop").await;
            if allowed {
                drop(result.unwrap());
            } else {
                assert_eq!(result.err().unwrap().code, ErrorCode::ExtensionUnavailable);
            }
            assert_idle(&services, &store);
        }
        let pause = store.pause();
        assert_eq!(
            authorize_lan(&services, &store, &item, "main", "stop")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_idle(&services, &store);
        drop(pause);
        store.begin_window_close("main").unwrap();
        assert_eq!(
            authorize_lan(&services, &store, &item, "main", "stop")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_idle(&services, &store);
        store.reopen_window("main").unwrap();
        drop(
            authorize_lan(&services, &store, &item, "main", "stop")
                .await
                .unwrap(),
        );
        assert_idle(&services, &store);
        store.begin_shutdown();
        assert_eq!(
            authorize_lan(&services, &store, &item, "main", "stop")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionUnavailable
        );
        assert_idle(&services, &store);
    }

    #[tokio::test]
    async fn lan_stop_waits_for_both_maintenance_gates_and_cancelled_admission_recovers() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        for global in [false, true] {
            let global_gate = if global {
                Some(services.gate.write().await)
            } else {
                None
            };
            let plugin_gate = if global {
                None
            } else {
                Some(services.mutation(&item.package.manifest.id).await.unwrap())
            };
            let mut cancelled = Box::pin(authorize_lan(&services, &store, &item, "main", "stop"));
            assert_pending(&mut cancelled).await;
            assert_eq!(services.lan_stop_capacity.available_permits(), 0);
            drop(cancelled);
            assert_idle(&services, &store);
            let mut waiting = Box::pin(authorize_lan(&services, &store, &item, "main", "stop"));
            assert_pending(&mut waiting).await;
            drop(plugin_gate);
            drop(global_gate);
            drop(
                tokio::time::timeout(Duration::from_secs(2), waiting)
                    .await
                    .unwrap()
                    .unwrap(),
            );
            assert_idle(&services, &store);
        }
    }

    #[tokio::test]
    async fn cancelled_identity_read_retains_stop_capacity_and_gates_until_the_worker_finishes() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        let (entered_send, entered_recv) = tokio::sync::oneshot::channel();
        let (release_send, release_recv) = mpsc::channel();
        let reading_store = store.clone();
        let current = item.clone();
        let registry = std::thread::spawn(move || {
            reading_store
                .with_current_entry(
                    &current.package.manifest.id,
                    &current.package.sha256,
                    current.generation,
                    |_| {
                        entered_send.send(()).unwrap();
                        release_recv.recv_timeout(Duration::from_secs(5)).unwrap();
                        Ok(())
                    },
                )
                .unwrap();
        });
        entered_recv.await.unwrap();
        let mut reading = Box::pin(authorize_lan(&services, &store, &item, "main", "stop"));
        assert_pending(&mut reading).await;
        drop(reading);
        assert_eq!(services.lan_stop_capacity.available_permits(), 0);
        assert_eq!(
            authorize_lan(&services, &store, &item, "secondary", "stop")
                .await
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        let mut maintenance = Box::pin(services.mutation(&item.package.manifest.id));
        assert_pending(&mut maintenance).await;
        let mut archive = Box::pin(services.gate.clone().write_owned());
        assert_pending(&mut archive).await;
        release_send.send(()).unwrap();
        registry.join().unwrap();
        let maintenance = tokio::time::timeout(Duration::from_secs(2), maintenance)
            .await
            .unwrap()
            .unwrap();
        drop(maintenance);
        drop(
            tokio::time::timeout(Duration::from_secs(2), archive)
                .await
                .unwrap(),
        );
        assert_idle(&services, &store);
    }

    #[tokio::test]
    async fn cancelled_stop_waiter_keeps_the_cloned_lease_until_real_blocking_work_ends() {
        let (_directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        let active = authorize_lan(&services, &store, &item, "main", "stop")
            .await
            .unwrap();
        let permit = active.permit.clone();
        drop(active);
        let (entered_send, entered_recv) = tokio::sync::oneshot::channel();
        let (release_send, release_recv) = mpsc::channel();
        let (done_send, done_recv) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async move {
            tauri::async_runtime::spawn_blocking(move || {
                entered_send.send(()).unwrap();
                release_recv.recv_timeout(Duration::from_secs(5)).unwrap();
                let mut committed = false;
                let result = permit.commit(|| {
                    committed = true;
                    Ok(())
                });
                drop(permit);
                done_send.send((result, committed)).unwrap();
            })
            .await
        });
        entered_recv.await.unwrap();
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        assert!(store.is_running());
        assert_eq!(services.lan_stop_capacity.available_permits(), 0);
        let mut maintenance = Box::pin(services.mutation(&item.package.manifest.id));
        assert_pending(&mut maintenance).await;
        let mut archive = Box::pin(services.gate.clone().write_owned());
        assert_pending(&mut archive).await;
        let pause = store.pause();
        release_send.send(()).unwrap();
        let (result, committed) = done_recv.await.unwrap();
        assert_eq!(result.unwrap_err().code, ErrorCode::ExtensionUnavailable);
        assert!(!committed);
        assert_idle(&services, &store);
        store.wait_window_stopped("main");
        pause.wait_stopped();
        drop(pause);
        drop(
            tokio::time::timeout(Duration::from_secs(2), maintenance)
                .await
                .unwrap()
                .unwrap(),
        );
        drop(
            tokio::time::timeout(Duration::from_secs(2), archive)
                .await
                .unwrap(),
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
        let unrelated =
            tokio::time::timeout(Duration::from_secs(2), services.mutation("test.second"))
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
    async fn failed_mutation_keeps_service_identities_and_does_not_notify() {
        let (directory, store, item) = installed_lan();
        let services = ExtensionServices::default();
        *services.identities.lock().unwrap() = tracked(&item);
        let lan = crate::extension_lan::ExtensionLan::new(directory.path().join("lan"), false);
        let id = &item.package.manifest.id;
        let before = store.snapshot().unwrap();
        let maintenance = services.mutation(id).await.unwrap();
        let mut notified = false;

        let result = services.commit_mutation(
            &store,
            maintenance,
            &lan,
            || store.set_enabled(id, false, vec![], before.revision + 1, false),
            || notified = true,
        );

        assert_eq!(result.unwrap_err().code, ErrorCode::Conflict);
        assert!(!notified);
        let current = store.snapshot().unwrap();
        assert_eq!(current.revision, before.revision);
        assert!(current.items[0].enabled);
        assert_eq!(services.identities.lock().unwrap().len(), 2);
        assert_idle(&services, &store);
    }

    #[tokio::test]
    async fn cleanup_failure_still_notifies_the_committed_snapshot() {
        let (directory, store, item) = installed_lan();
        let services = Arc::new(ExtensionServices::default());
        let poisoned = services.clone();
        assert!(
            std::thread::spawn(move || {
                let _guard = poisoned.identities.lock().unwrap();
                panic!("Service identity failure injection");
            })
            .join()
            .is_err()
        );
        let lan = crate::extension_lan::ExtensionLan::new(directory.path().join("lan"), false);
        let id = &item.package.manifest.id;
        let revision = store.snapshot().unwrap().revision;
        let maintenance = services.mutation(id).await.unwrap();
        let mut notification = None;

        let result = services.commit_mutation(
            &store,
            maintenance,
            &lan,
            || store.set_enabled(id, false, vec![], revision, false),
            || notification = Some(store.snapshot().unwrap()),
        );

        assert_eq!(result.unwrap_err().code, ErrorCode::Internal);
        let notified =
            notification.expect("A committed mutation must notify despite cleanup failure");
        assert_eq!(notified.revision, revision + 1);
        assert!(!notified.items[0].enabled);
        assert_idle(&services, &store);
    }

    #[tokio::test]
    async fn registry_management_cannot_start_after_pause_or_shutdown() {
        for shutdown in [false, true] {
            let (directory, store, item) = installed_lan();
            let services = ExtensionServices::default();
            let lan = crate::extension_lan::ExtensionLan::new(directory.path().join("lan"), false);
            let before = store.snapshot().unwrap();
            let id = &item.package.manifest.id;
            let maintenance = services.mutation(id).await.unwrap();
            let pause = if shutdown {
                assert!(store.begin_shutdown());
                None
            } else {
                Some(store.pause())
            };
            let mut invoked = false;
            let mut notified = false;
            let result = services.commit_mutation(
                &store,
                maintenance,
                &lan,
                || {
                    invoked = true;
                    store.set_enabled(id, false, vec![], before.revision, false)
                },
                || notified = true,
            );
            assert_eq!(result.unwrap_err().code, ErrorCode::ExtensionUnavailable);
            assert!(!invoked);
            assert!(!notified);
            assert_eq!(store.snapshot().unwrap().revision, before.revision);
            assert_idle(&services, &store);
            drop(pause);
        }
    }

    #[tokio::test]
    async fn external_credential_management_remains_active_until_the_system_call_finishes() {
        for shutdown in [false, true] {
            let (_directory, store, item) = installed_lan();
            let services = ExtensionServices::default();
            let maintenance = services.mutation(&item.package.manifest.id).await.unwrap();
            let worker_store = store.clone();
            let worker_item = item.clone();
            let worker_maintenance = maintenance.clone();
            let (entered_send, entered_recv) = tokio::sync::oneshot::channel();
            let (release_send, release_recv) = mpsc::channel();
            let worker = tokio::task::spawn_blocking(move || {
                worker_store.with_current_entry_external(
                    &worker_maintenance,
                    &worker_item.package.manifest.id,
                    &worker_item.package.sha256,
                    worker_item.generation,
                    |_| {
                        entered_send.send(()).unwrap();
                        release_recv.recv_timeout(Duration::from_secs(5)).unwrap();
                        Ok(())
                    },
                )
            });
            entered_recv.await.unwrap();
            assert!(
                store.is_running(),
                "A pending system credential call must participate in extension lifecycle waits"
            );
            assert!(store.run_status().unwrap().is_empty());
            let pause = if shutdown {
                assert!(store.begin_shutdown());
                None
            } else {
                Some(store.pause())
            };
            let waiting_store = store.clone();
            let (stopped_send, stopped_recv) = mpsc::channel();
            let waiting = std::thread::spawn(move || {
                waiting_store.wait_stopped();
                stopped_send.send(()).unwrap();
            });
            let waited = stopped_recv
                .recv_timeout(Duration::from_millis(30))
                .is_err();
            let mut invoked = false;
            let rejected = store.with_current_entry_external(
                &maintenance,
                &item.package.manifest.id,
                &item.package.sha256,
                item.generation,
                |_| {
                    invoked = true;
                    Ok(())
                },
            );
            release_send.send(()).unwrap();
            worker.await.unwrap().unwrap();
            waiting.join().unwrap();
            assert!(
                waited,
                "Lifecycle wait returned while credential management was still active"
            );
            assert_eq!(rejected.unwrap_err().code, ErrorCode::ExtensionUnavailable);
            assert!(!invoked);
            assert_idle(&services, &store);
            drop(pause);
        }
    }

    #[tokio::test]
    async fn committed_mutation_finishes_cleanup_and_notification_after_waiter_cancellation() {
        let (directory, store, item) = installed_lan();
        let services = Arc::new(ExtensionServices::default());
        *services.identities.lock().unwrap() = tracked(&item);
        let lan = crate::extension_lan::ExtensionLan::new(directory.path().join("lan"), false);
        let id = item.package.manifest.id.clone();
        let revision = store.snapshot().unwrap().revision;
        let maintenance = services.mutation(&id).await.unwrap();
        let tasks = Arc::new(tokio::sync::Semaphore::new(1));
        let worker_tasks = tasks.clone();
        let worker_services = services.clone();
        let worker_store = store.clone();
        let worker_id = id.clone();
        let (committed_send, committed_recv) = tokio::sync::oneshot::channel();
        let (cleanup_send, cleanup_recv) = mpsc::channel();
        let (notified_send, notified_recv) = tokio::sync::oneshot::channel();
        let (finish_send, finish_recv) = mpsc::channel();
        let (done_send, done_recv) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async move {
            blocking::run_limited(&worker_tasks, move || {
                let result = worker_services.commit_mutation(
                    &worker_store,
                    maintenance,
                    &lan,
                    || {
                        let snapshot =
                            worker_store.set_enabled(&worker_id, false, vec![], revision, false)?;
                        committed_send.send(()).unwrap();
                        cleanup_recv.recv_timeout(Duration::from_secs(5)).unwrap();
                        Ok(snapshot)
                    },
                    || {
                        assert!(worker_services.identities.lock().unwrap().is_empty());
                        notified_send.send(()).unwrap();
                        finish_recv.recv_timeout(Duration::from_secs(5)).unwrap();
                    },
                );
                done_send.send(result).unwrap();
                Ok(())
            })
            .await
        });

        tokio::time::timeout(Duration::from_secs(5), committed_recv)
            .await
            .unwrap()
            .unwrap();
        assert!(
            store.is_running(),
            "Committed maintenance must remain active until cleanup and notification finish"
        );
        assert_eq!(
            blocking::run_limited(&tasks, || Ok(()))
                .await
                .unwrap_err()
                .code,
            ErrorCode::NativeBusy
        );
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        assert!(!store.snapshot().unwrap().items[0].enabled);
        let pause = store.pause();
        let waiting_store = store.clone();
        let (stopped_send, stopped_recv) = mpsc::channel();
        let waiting = std::thread::spawn(move || {
            waiting_store.wait_stopped();
            stopped_send.send(()).unwrap();
        });
        let mut queued = Box::pin(services.mutation(&id));
        assert_pending(&mut queued).await;

        cleanup_send.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), notified_recv)
            .await
            .unwrap()
            .unwrap();
        assert_pending(&mut queued).await;
        assert_eq!(tasks.available_permits(), 0);
        assert!(store.is_running());
        assert!(
            stopped_recv
                .recv_timeout(Duration::from_millis(30))
                .is_err()
        );
        finish_send.send(()).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), done_recv)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result.revision, revision + 1);
        stopped_recv.recv_timeout(Duration::from_secs(2)).unwrap();
        waiting.join().unwrap();
        assert_idle(&services, &store);
        drop(pause);
        drop(
            tokio::time::timeout(Duration::from_secs(2), queued)
                .await
                .unwrap()
                .unwrap(),
        );
    }

    #[tokio::test]
    async fn maintenance_remains_exclusive_until_the_actual_blocking_operation_finishes() {
        let services = Arc::new(ExtensionServices::default());
        let maintenance = services.mutation("test.first").await.unwrap();
        assert!(maintenance.check_identity("test.second").is_err());
        let (entered_send, entered_recv) = mpsc::channel();
        let (release_send, release_recv) = mpsc::channel();
        let actual = maintenance.clone();
        let worker = std::thread::spawn(move || {
            let _maintenance = actual;
            entered_send.send(()).unwrap();
            let _ = release_recv.recv();
        });
        entered_recv.recv_timeout(Duration::from_secs(2)).unwrap();
        // 代表前端已停止等待；原生实际工作仍持有 owned 门闩。
        drop(maintenance);
        let queued = services.clone();
        let same_plugin = tokio::spawn(async move { queued.mutation("test.first").await });
        tokio::task::yield_now().await;
        assert!(!same_plugin.is_finished());
        let other = tokio::time::timeout(Duration::from_secs(2), services.mutation("test.second"))
            .await
            .unwrap()
            .unwrap();
        drop(other);
        release_send.send(()).unwrap();
        worker.join().unwrap();
        same_plugin.await.unwrap().unwrap();
    }
}
