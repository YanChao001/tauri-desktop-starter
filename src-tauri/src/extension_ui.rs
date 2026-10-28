//! Packaged, opaque-origin UI documents. The trusted host owns every capability call.
use super::*;
use std::collections::BTreeMap;
use tauri::Manager;

pub const UI_DOCUMENT_LIMIT: usize = 512 * 1024;
pub const UI_TOTAL_LIMIT: usize = 2 * 1024 * 1024;
const UI_CACHE_LIMIT: u64 = 64 * 1024 * 1024;
const MAX_LEASES: usize = 64;
const SDK: &str = include_str!("../../sdk/extension-ui.js");

pub const UI_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; sandbox allow-scripts";

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionUiDocument {
    pub id: String,
    pub sha256: String,
    pub bytes: u32,
}

pub fn valid_document_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn document_ids(manifest: &ExtensionManifest) -> HashSet<&str> {
    manifest
        .commands
        .iter()
        .filter_map(|command| command.ui.as_ref()?.document.as_deref())
        .collect()
}

pub fn validate_ui_documents(
    manifest: &ExtensionManifest,
    documents: &BTreeMap<String, String>,
) -> NativeResult<Vec<ExtensionUiDocument>> {
    let expected = document_ids(manifest);
    if documents.len() > 32 || expected.len() != documents.len() {
        return Err(invalid(
            "UI documents must exactly match declared view entries",
        ));
    }
    let mut total = 0;
    documents
        .iter()
        .map(|(id, html)| {
            if !valid_document_id(id) || !expected.contains(id.as_str()) || html.is_empty() {
                return Err(invalid("Invalid or unreferenced UI document"));
            }
            bounded_text(html, UI_DOCUMENT_LIMIT, "UI document")?;
            total += html.len();
            if total > UI_TOTAL_LIMIT {
                return Err(invalid("UI documents exceed 2 MiB"));
            }
            Ok(ExtensionUiDocument {
                id: id.clone(),
                sha256: digest(html.as_bytes()),
                bytes: html.len() as u32,
            })
        })
        .collect()
}

impl ExtensionPreview {
    pub fn validate_ui(&self) -> NativeResult<()> {
        let expected = document_ids(&self.manifest);
        let ids: HashSet<_> = self
            .ui_documents
            .iter()
            .map(|document| document.id.as_str())
            .collect();
        if ids != expected
            || ids.len() != self.ui_documents.len()
            || ids.len() > 32
            || self.ui_documents.iter().any(|document| {
                !valid_document_id(&document.id)
                    || !valid_digest(&document.sha256)
                    || document.bytes == 0
                    || document.bytes as usize > UI_DOCUMENT_LIMIT
            })
            || self
                .ui_documents
                .iter()
                .map(|document| u64::from(document.bytes))
                .sum::<u64>()
                > UI_TOTAL_LIMIT as u64
        {
            return Err(invalid("Invalid UI document preview"));
        }
        Ok(())
    }
}

impl ExtensionStore {
    fn ui_path(&self, hash: &str, create: bool) -> NativeResult<PathBuf> {
        if !valid_digest(hash) {
            return Err(invalid("Invalid UI document identity"));
        }
        directory(&self.0.root, create)?;
        let folder = self.0.root.join("ui");
        directory(&folder, create)?;
        Ok(folder.join(format!("{hash}.html")))
    }

    pub(super) fn read_ui(&self, document: &ExtensionUiDocument) -> NativeResult<String> {
        let path = self.ui_path(&document.sha256, false)?;
        if !regular(&path)? {
            return Err(NativeError::new(
                ErrorCode::NotFound,
                "UI document is missing",
            ));
        }
        let mut bytes = Vec::new();
        crate::extension_paths::open_regular(&path)?
            .take(UI_DOCUMENT_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| io("Cannot read UI document", error))?;
        if bytes.len() != document.bytes as usize || digest(&bytes) != document.sha256 {
            return Err(NativeError::new(
                ErrorCode::StorageCorrupt,
                "UI document content differs",
            ));
        }
        String::from_utf8(bytes).map_err(|_| invalid("UI document must be UTF-8"))
    }

    pub(super) fn cache_ui(&self, bundle: &Bundle) -> NativeResult<()> {
        for document in &bundle.preview.ui_documents {
            let path = self.ui_path(&document.sha256, true)?;
            if regular(&path)? {
                self.read_ui(document)?;
                continue;
            }
            let usage = fs::read_dir(self.0.root.join("ui"))
                .map_err(|error| io("Cannot inspect UI cache", error))?
                .filter_map(Result::ok)
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    name.strip_suffix(".html")
                        .filter(|hash| valid_digest(hash))?;
                    fs::symlink_metadata(entry.path())
                        .ok()
                        .map(|info| info.len())
                })
                .sum::<u64>();
            if usage + u64::from(document.bytes) > UI_CACHE_LIMIT {
                return Err(invalid("UI document cache exceeds 64 MiB"));
            }
            let html = bundle
                .ui_documents
                .get(&document.id)
                .ok_or_else(|| invalid("Missing UI document"))?;
            atomic_write(&path, html.as_bytes())?;
        }
        Ok(())
    }

    pub(super) fn cleanup_ui(&self, registry: &Registry) {
        let folder = self.0.root.join("ui");
        if directory(&self.0.root, false) != Ok(true) || directory(&folder, false) != Ok(true) {
            return;
        }
        let used: HashSet<_> = registry
            .extensions
            .iter()
            .flat_map(|item| std::iter::once(&item.package).chain(item.previous_package.iter()))
            .flat_map(|package| {
                package
                    .ui_documents
                    .iter()
                    .map(|document| document.sha256.as_str())
            })
            .collect();
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(hash) = name
                .strip_suffix(".html")
                .filter(|hash| valid_digest(hash) && !used.contains(hash))
            else {
                continue;
            };
            if let Ok(path) = self.ui_path(hash, false)
                && regular(&path) == Ok(true)
            {
                let _ = fs::remove_file(path);
            }
        }
    }

    fn ui_document(
        &self,
        id: &str,
        command_id: &str,
        hash: &str,
        generation: i32,
    ) -> NativeResult<String> {
        self.with_current_entry(id, hash, generation, |item| {
            let command = item
                .package
                .manifest
                .commands
                .iter()
                .find(|command| command.id == command_id)
                .ok_or_else(|| invalid("Unknown UI command"))?;
            if !item.enabled
                || command
                    .permissions
                    .iter()
                    .any(|permission| !item.granted_permissions.contains(permission))
            {
                return Err(NativeError::new(
                    ErrorCode::ExtensionUnavailable,
                    "UI entry is not authorized",
                ));
            }
            let id = command
                .ui
                .as_ref()
                .and_then(|ui| ui.document.as_deref())
                .ok_or_else(|| invalid("Command has no UI document"))?;
            let document = item
                .package
                .ui_documents
                .iter()
                .find(|document| document.id == id)
                .ok_or_else(|| invalid("Missing UI preview"))?;
            self.read_ui(document)
        })
    }
}

#[derive(Clone)]
struct Lease {
    owner: String,
    id: String,
    command: String,
    hash: String,
    generation: i32,
}
#[derive(Default)]
pub struct ExtensionUiStore(Mutex<HashMap<String, Lease>>);

impl ExtensionUiStore {
    fn issue(&self, lease: Lease) -> NativeResult<String> {
        let mut random = [0_u8; 32];
        getrandom::fill(&mut random).map_err(|error| io("Cannot create UI lease", error))?;
        let token = digest(&random);
        let mut leases = self
            .0
            .lock()
            .map_err(|_| io("UI leases unavailable", "lock poisoned"))?;
        // Each trusted host window has one active surface; replacing it revokes its old URL.
        leases.retain(|_, old| old.owner != lease.owner);
        if leases.len() >= MAX_LEASES || leases.contains_key(&token) {
            return Err(invalid("UI lease limit reached"));
        }
        leases.insert(token.clone(), lease);
        Ok(token)
    }

    fn lease(&self, owner: &str, token: &str) -> NativeResult<Lease> {
        if !valid_digest(token) {
            return Err(invalid("Invalid UI lease"));
        }
        self.0
            .lock()
            .map_err(|_| io("UI leases unavailable", "lock poisoned"))?
            .get(token)
            .cloned()
            .filter(|lease| lease.owner == owner)
            .ok_or_else(|| invalid("UI lease is not available to this window"))
    }

    fn document(&self, store: &ExtensionStore, owner: &str, token: &str) -> NativeResult<String> {
        let lease = self.lease(owner, token)?;
        store.ui_document(&lease.id, &lease.command, &lease.hash, lease.generation)
    }

    pub fn close_window(&self, owner: &str) {
        if let Ok(mut leases) = self.0.lock() {
            leases.retain(|_, lease| lease.owner != owner);
        }
    }
}

#[tauri::command]
#[specta::specta]
pub fn open_extension_ui(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    command_id: String,
    expected_sha256: String,
    expected_generation: i32,
) -> NativeResult<String> {
    bounded_text(&id, 80, "Extension ID")?;
    bounded_text(&command_id, 80, "Extension command")?;
    if !valid_digest(&expected_sha256) || expected_generation <= 0 {
        return Err(invalid("Invalid UI identity"));
    }
    // Reservation is synchronous and contains no file I/O. Requests retain IPC order;
    // the asynchronous protocol validates authorization and bytes before serving code.
    app.state::<ExtensionUiStore>().issue(Lease {
        owner: window.label().to_owned(),
        id,
        command: command_id,
        hash: expected_sha256,
        generation: expected_generation,
    })
}

#[tauri::command]
#[specta::specta]
pub fn close_extension_ui(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    token: String,
) -> NativeResult<()> {
    let state = app.state::<ExtensionUiStore>();
    let mut leases = state
        .0
        .lock()
        .map_err(|_| io("UI leases unavailable", "lock poisoned"))?;
    if leases
        .get(&token)
        .is_some_and(|lease| lease.owner == window.label())
    {
        leases.remove(&token);
    }
    Ok(())
}

pub fn document_response(document: NativeResult<String>) -> tauri::http::Response<Vec<u8>> {
    let (status, body) = match document {
        Ok(html) => (200, html),
        Err(_) => (403, "UI unavailable".to_owned()),
    };
    response(status, "text/html; charset=utf-8", body)
}
fn response(status: u16, content_type: &str, body: String) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Content-Security-Policy", UI_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("X-DNS-Prefetch-Control", "off")
        .header("Cache-Control", "no-store")
        .body(body.into_bytes())
        .expect("Static UI response headers")
}

fn sdk_initialization_script() -> String {
    SDK.replacen("__STARTER_NATIVE_CONTEXT_MENU__", "true", 1)
}

pub fn register_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    // Tauri documents main-frame-only initialization as unsupported on WebView2.
    // Use its supported custom transport hook to withhold the invoke key from all
    // subframes, while retaining upstream serialization and both IPC transports.
    let ipc = include_str!("native-ipc.js").replace(
        "__STARTER_OS_NAME__",
        &serde_json::to_string(std::env::consts::OS).expect("Static OS name"),
    );
    builder
        .invoke_system(ipc)
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("extension-ui")
                .js_init_script_on_all_frames(sdk_initialization_script())
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol("extension-ui", |context, request, responder| {
            let app = context.app_handle().clone();
            let owner = context.webview_label().to_owned();
            let path = request.uri().path().trim_start_matches('/');
            let token = path.to_owned();
            if request.method() != tauri::http::Method::GET
                || request.uri().query().is_some()
                || app
                    .state::<ExtensionUiStore>()
                    .lease(&owner, &token)
                    .is_err()
            {
                responder.respond(document_response(Err(invalid("Unsupported UI request"))));
                return;
            }
            tauri::async_runtime::spawn(async move {
                let document = crate::blocking::run(move || {
                    app.state::<ExtensionUiStore>().document(
                        &app.state::<ExtensionStore>(),
                        &owner,
                        &token,
                    )
                })
                .await;
                responder.respond(document_response(document));
            });
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_ui_initialization_enables_document_policy_before_the_bridge_url_guard() {
        let marker = "__STARTER_NATIVE_CONTEXT_MENU__";
        assert_eq!(SDK.matches(marker).count(), 1);
        assert!(SDK.contains(
            "const nativeContextMenu = \"__STARTER_NATIVE_CONTEXT_MENU__\" === \"true\";"
        ));
        let initialized = sdk_initialization_script();
        assert!(!initialized.contains(marker));
        assert!(initialized.contains("const nativeContextMenu = \"true\" === \"true\";"));
        assert!(initialized.contains("if (window === window.top) return;"));
        let policy = initialized.find("installDesktopContextMenu();").unwrap();
        let bridge_guard = initialized
            .find("location.protocol !== \"extension-ui:\"")
            .unwrap();
        assert!(policy < bridge_guard);
        assert!(initialized.contains("location.hostname !== \"extension-ui.localhost\""));
    }

    fn fixture() -> (tempfile::TempDir, ExtensionStore, ExtensionInfo, String) {
        let dir = crate::extension_paths::temporary_directory();
        let store = ExtensionStore::new(dir.path().join("extensions"), false);
        let mut content: serde_json::Value = serde_json::from_str(&demo_package()).unwrap();
        content["manifest"]["commands"] = serde_json::json!([{
            "id":"open", "title":"Open", "function":"uppercase", "inputFormat":"json", "resultFormat":"view", "permissions":[],
            "ui":{"sidebar":true,"window":true,"document":"main"}
        }]);
        content["uiDocuments"] = serde_json::json!({"main":"<main><h1>My UI</h1><script>window.example=true</script></main>"});
        let content = content.to_string();
        let preview = preview_package(&content).unwrap();
        let installed = store
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
                    granted_permissions: vec![ExtensionPermission::TextRead],
                },
                |_, _| Ok(()),
            )
            .unwrap();
        (dir, store, installed.items[0].clone(), content)
    }
    fn lease(item: &ExtensionInfo) -> Lease {
        Lease {
            owner: "main".into(),
            id: item.package.manifest.id.clone(),
            command: "open".into(),
            hash: item.package.sha256.clone(),
            generation: item.generation,
        }
    }
    #[test]
    fn documents_are_bounded_referenced_utf8_and_hash_bound() {
        let (_, _, item, content) = fixture();
        let document = &item.package.ui_documents[0];
        assert_eq!(
            document.sha256,
            digest("<main><h1>My UI</h1><script>window.example=true</script></main>".as_bytes())
        );
        for documents in [
            serde_json::json!({}),
            serde_json::json!({"main":"ok","unused":"no"}),
            serde_json::json!({"main":"x".repeat(UI_DOCUMENT_LIMIT + 1)}),
            serde_json::json!({"main":"\0"}),
        ] {
            let mut value: serde_json::Value = serde_json::from_str(&content).unwrap();
            value["uiDocuments"] = documents;
            assert!(preview_package(&value.to_string()).is_err());
        }
        for id in ["../main", "main.html", "MAIN", "", "x/y"] {
            assert!(!valid_document_id(id));
        }
        let mut preview = item.package;
        preview.ui_documents[0].sha256 = "not a hash".into();
        assert!(preview.validate_ui().is_err());
    }
    #[test]
    fn leases_are_window_bound_replaced_and_revoked_on_disable_or_generation_change() {
        let (_dir, store, item, content) = fixture();
        let ui = ExtensionUiStore::default();
        let first = ui.issue(lease(&item)).unwrap();
        assert!(
            ui.document(&store, "main", &first)
                .unwrap()
                .contains("My UI")
        );
        assert!(ui.document(&store, "secondary", &first).is_err());
        let current = ui.issue(lease(&item)).unwrap();
        assert_ne!(first, current);
        assert!(ui.document(&store, "main", &first).is_err());
        store
            .set_enabled(&item.package.manifest.id, false, vec![], 1, false)
            .unwrap();
        assert!(ui.document(&store, "main", &current).is_err());
        let mut update: serde_json::Value = serde_json::from_str(&content).unwrap();
        update["manifest"]["version"] = "1.0.1".into();
        store
            .install_reviewed(
                &update.to_string(),
                InstallCondition {
                    revision: 2,
                    replace: true,
                    sha256: &item.package.sha256,
                },
                ExtensionOrigin::Local,
                ExtensionConsent {
                    trusted: true,
                    granted_permissions: vec![ExtensionPermission::TextRead],
                },
                |_, _| Ok(()),
            )
            .unwrap();
        assert!(ui.document(&store, "main", &current).is_err());
        ui.close_window("main");
        assert!(ui.0.lock().unwrap().is_empty());
    }
    #[test]
    fn tampered_ui_and_rollback_resources_are_refused_without_replacing_the_registry() {
        let (dir, store, item, content) = fixture();
        let original = item.package.ui_documents[0].sha256.clone();
        let mut update: serde_json::Value = serde_json::from_str(&content).unwrap();
        update["manifest"]["version"] = "1.0.1".into();
        update["uiDocuments"]["main"] = "<main>Updated</main>".into();
        let next = store
            .install_reviewed(
                &update.to_string(),
                InstallCondition {
                    revision: 1,
                    replace: true,
                    sha256: &item.package.sha256,
                },
                ExtensionOrigin::Local,
                ExtensionConsent {
                    trusted: true,
                    granted_permissions: vec![ExtensionPermission::TextRead],
                },
                |_, _| Ok(()),
            )
            .unwrap();
        fs::write(
            dir.path()
                .join("extensions/ui")
                .join(format!("{original}.html")),
            "tampered",
        )
        .unwrap();
        assert!(
            store
                .rollback(&item.package.manifest.id, next.revision)
                .is_err()
        );
        assert_eq!(store.snapshot().unwrap().revision, next.revision);
        assert_eq!(
            store.snapshot().unwrap().items[0].package.manifest.version,
            "1.0.1"
        );
        let hash = &next.items[0].package.ui_documents[0].sha256;
        fs::write(
            dir.path()
                .join("extensions/ui")
                .join(format!("{hash}.html")),
            "tampered",
        )
        .unwrap();
        let ui = ExtensionUiStore::default();
        let token = ui.issue(lease(&next.items[0])).unwrap();
        assert!(ui.document(&store, "main", &token).is_err());
    }
    #[test]
    fn ui_responses_deny_external_resources_and_expose_no_native_bootstrap() {
        let response = document_response(Ok("<!doctype html><main>hello</main>".into()));
        assert_eq!(response.headers()["X-DNS-Prefetch-Control"], "off");
        let csp = response.headers()["Content-Security-Policy"]
            .to_str()
            .unwrap();
        for rule in [
            "default-src 'none'",
            "connect-src 'none'",
            "sandbox allow-scripts",
            "frame-src 'none'",
            "base-uri 'none'",
        ] {
            assert!(csp.contains(rule));
        }
        let body = String::from_utf8(response.into_body()).unwrap();
        assert!(body.starts_with("<!doctype html>"));
        assert!(body.contains("<main>hello</main>"));
        assert!(!body.contains("__TAURI_INVOKE_KEY__"));
        assert_eq!(document_response(Err(invalid("no"))).status(), 403);
    }
}
