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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionService {
    Lan,
    Wallpaper,
}
impl ExtensionService {
    fn permission(self) -> ExtensionPermission {
        match self {
            Self::Lan => ExtensionPermission::MessagingLan,
            Self::Wallpaper => ExtensionPermission::WallpapersManage,
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
    let permission = service.permission();
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
    authorized(&item, service)?;
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
                &item.package.manifest.id,
                request,
                permit.clone(),
            )
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
    let app = app.clone();
    blocking::run(move || {
        for id in ids {
            crate::extension_lan::stop_extension(&app, &id);
        }
        Ok(())
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
        for owner in owners {
            crate::extension_lan::close_window(&handle, &owner);
        }
        Ok(())
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
            "optionalPermissions": ["messaging:lan", "wallpapers:manage"], "network": [],
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
