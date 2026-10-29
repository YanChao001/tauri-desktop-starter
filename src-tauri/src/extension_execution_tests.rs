//! 使用真实 Wasm 驱动验证 effect 顺序、持久化与 JSON 编码后的预算。
use super::*;
use crate::extension_view::{ExtensionViewRequest, MAX_VIEW_STATE_BYTES};
use serde_json::{Value, json};
use std::fmt::Write;

fn storage_run() -> (
    tempfile::TempDir,
    PreparedRun,
    ExtensionHostStore,
    crate::storage::SettingsStore,
) {
    let temp = crate::extension_paths::temporary_directory();
    let store = ExtensionStore::new(temp.path().join("extensions"), false);
    // 宿主 effect 测试独立声明所需能力，不依赖内置工作台当前提供哪些业务功能。
    let mut content: Value = serde_json::from_str(&crate::extensions::demo_package()).unwrap();
    content["manifest"] = json!({
        "formatVersion":3,"apiVersion":2,"minHostVersion":"0.1.4",
        "id":"tests.effect-driver","version":"1.0.0","name":"Effect driver",
        "author":"Tests","description":"Exercises the host effect protocol",
        "commands":[{"id":"fixture","title":"Fixture","function":"uppercase",
            "inputFormat":"json","resultFormat":"view","permissions":["storage"]}],
        "permissions":["storage"],"optionalPermissions":[],"network":[]
    });
    let content = content.to_string();
    let preview = crate::extensions::preview_package(&content).unwrap();
    let snapshot = store.install(&content, 0, false, &preview.sha256).unwrap();
    let item = &snapshot.items[0];
    let id = item.package.manifest.id.clone();
    let hash = item.package.sha256.clone();
    store
        .set_enabled(
            &id,
            true,
            vec![ExtensionPermission::Storage],
            snapshot.revision,
            true,
        )
        .unwrap();
    let prepared = store.prepare(&id, &hash).unwrap();
    let host = ExtensionHostStore::new(
        temp.path().join("host"),
        false,
        "tests.effect-driver".into(),
    );
    let settings = crate::storage::SettingsStore::open(temp.path().join("settings.json")).unwrap();
    (temp, prepared, host, settings)
}
fn request(action: Option<&str>, state: &str, fields: Value) -> Value {
    json!({"version":2,"action":action,"state":state,"fields":fields,"locale":"en","host":null,"results":[]})
}
fn storage_effect(id: &str, revision: i32, key: &str) -> Value {
    json!({"kind":"storage","id":id,"expectedRevision":revision,"changes":{(key):true}})
}
fn view(state: &str, effects: Vec<Value>) -> Value {
    json!({"version":2,"state":state,"display":"Effect fixture","description":"","fields":[],"groups":[],"effects":effects})
}

/// 每次创建独立 Wasm 实例；通过输入长度区分首次请求与包含 receipts 的下一轮。
/// 输出走 Extism 的公开分配/写入 ABI，不使用宿主专用测试入口。
fn fixed_views(first: &Value, second: &Value, first_request_bytes: usize) -> Vec<u8> {
    fn data(bytes: &[u8]) -> String {
        let mut value = String::with_capacity(bytes.len());
        for byte in bytes {
            if (0x20..=0x7e).contains(byte) && !b"\"\\".contains(byte) {
                value.push(char::from(*byte));
            } else {
                write!(value, "\\{byte:02x}").unwrap();
            }
        }
        value
    }
    let first = serde_json::to_vec(first).unwrap();
    let second = serde_json::to_vec(second).unwrap();
    let pages = (first.len() + second.len()).div_ceil(65536).max(1);
    format!(r#"(module
      (import "extism:host/env" "input_length" (func $input_length (result i64)))
      (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
      (import "extism:host/env" "store_u64" (func $store_word (param i64 i64)))
      (import "extism:host/env" "store_u8" (func $store_byte (param i64 i32)))
      (import "extism:host/env" "output_set" (func $output (param i64 i64)))
      (memory {pages})
      (data (i32.const 0) "{first_data}{second_data}")
      (func (export "fixture") (result i32)
        (local $source i32) (local $length i32) (local $index i32) (local $target i64)
        (if (i64.gt_u (call $input_length) (i64.const {threshold}))
          (then (local.set $source (i32.const {first_len})) (local.set $length (i32.const {second_len})))
          (else (local.set $source (i32.const 0)) (local.set $length (i32.const {first_len}))))
        (local.set $target (call $alloc (i64.extend_i32_u (local.get $length))))
        (block $words_done (loop $words
          (br_if $words_done (i32.gt_u (i32.add (local.get $index) (i32.const 8)) (local.get $length)))
          (call $store_word (i64.add (local.get $target) (i64.extend_i32_u (local.get $index)))
            (i64.load (i32.add (local.get $source) (local.get $index))))
          (local.set $index (i32.add (local.get $index) (i32.const 8))) (br $words)))
        (block $bytes_done (loop $bytes
          (br_if $bytes_done (i32.ge_u (local.get $index) (local.get $length)))
          (call $store_byte (i64.add (local.get $target) (i64.extend_i32_u (local.get $index)))
            (i32.load8_u (i32.add (local.get $source) (local.get $index))))
          (local.set $index (i32.add (local.get $index) (i32.const 1))) (br $bytes)))
        (call $output (local.get $target) (i64.extend_i32_u (local.get $length))) (i32.const 0)))"#,
        first_data=data(&first), second_data=data(&second), first_len=first.len(), second_len=second.len(), threshold=first_request_bytes,
    ).into_bytes()
}

#[test]
fn real_wasm_driver_finishes_storage_effects_and_persists_across_host_reopen() {
    tauri::async_runtime::block_on(async {
        let (temp, mut prepared, host, settings) = storage_run();
        assert_eq!(prepared.grants, vec![ExtensionPermission::Storage]);
        let document = json!({"title":"persisted","body":"保留 Unicode 原文"});
        let first = view(
            "saving",
            vec![
                json!({"kind":"storage","id":"save-document","expectedRevision":0,
                "changes":{"document":document}}),
            ],
        );
        let second = view("complete", vec![]);
        let mut initial = request(None, "", json!({}));
        initial["host"] = serde_json::to_value(
            host.context(&prepared.package.manifest, &prepared.grants)
                .unwrap(),
        )
        .unwrap();
        prepared.module = fixed_views(&first, &second, encode(&initial).unwrap().len());
        let completed = drive_view(
            &host,
            &settings,
            &prepared,
            "fixture",
            ExtensionExecutionBudget::Standard,
            initial,
            "en",
        )
        .await
        .unwrap();
        assert!(completed.effects.is_empty());
        assert_eq!(completed.state, "complete");
        let snapshot = host
            .storage_snapshot(&prepared.package.manifest.id)
            .unwrap();
        assert_eq!(snapshot.revision, 1);
        assert_eq!(snapshot.values["document"], document);
        assert_eq!(snapshot.values.len(), 1);
        drop(host);
        let reopened = ExtensionHostStore::new(
            temp.path().join("host"),
            false,
            "tests.effect-driver".into(),
        );
        assert_eq!(
            reopened
                .storage_snapshot(&prepared.package.manifest.id)
                .unwrap(),
            snapshot
        );
    });
}

#[test]
fn repeated_effect_in_a_later_batch_prevents_every_write_in_that_batch() {
    tauri::async_runtime::block_on(async {
        let (_temp, mut prepared, host, settings) = storage_run();
        let first = view("first complete", vec![storage_effect("old", 0, "old")]);
        let second = view(
            "second pending",
            vec![
                storage_effect("new", 1, "new"),
                storage_effect("old", 2, "old"),
            ],
        );
        let mut initial = request(None, "", json!({}));
        initial["host"] = serde_json::to_value(
            host.context(&prepared.package.manifest, &prepared.grants)
                .unwrap(),
        )
        .unwrap();
        prepared.module = fixed_views(&first, &second, encode(&initial).unwrap().len());
        let error = drive_view(
            &host,
            &settings,
            &prepared,
            "fixture",
            ExtensionExecutionBudget::Standard,
            initial,
            "en",
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ExtensionRunFailed);
        let snapshot = host
            .storage_snapshot(&prepared.package.manifest.id)
            .unwrap();
        assert_eq!(
            snapshot.revision, 1,
            "the new write must be rejected before it is executed"
        );
        assert_eq!(snapshot.values.get("old"), Some(&Value::Bool(true)));
        assert!(!snapshot.values.contains_key("new"));
    });
}

#[test]
fn escaped_state_and_fields_are_preflighted_before_the_first_effect_commits() {
    tauri::async_runtime::block_on(async {
        let (_temp, mut prepared, host, settings) = storage_run();
        let mut output = view(
            &"\u{1}".repeat(MAX_VIEW_STATE_BYTES),
            vec![
                storage_effect("first", 0, "first"),
                storage_effect("second", 1, "second"),
            ],
        );
        output["fields"] = json!([
            {"id":"large","label":"Large","value":"\u{2}".repeat(256*1024),"maxBytes":256*1024},
            {"id":"extra","label":"Extra","value":"\u{3}".repeat(32*1024),"maxBytes":64*1024},
        ]);
        let serialized = serde_json::to_string(&output).unwrap();
        assert!(serialized.len() < MAX_VIEW_BYTES);
        let parsed = ExtensionView::parse(&serialized).unwrap();
        assert_eq!(
            effect_reply(&parsed, "en").unwrap_err().code,
            ErrorCode::InputTooLong
        );
        prepared.module = fixed_views(&output, &output, MAX_VIEW_BYTES);
        let error = drive_view(
            &host,
            &settings,
            &prepared,
            "fixture",
            ExtensionExecutionBudget::Standard,
            request(None, "", json!({})),
            "en",
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InputTooLong);
        let snapshot = host
            .storage_snapshot(&prepared.package.manifest.id)
            .unwrap();
        assert_eq!(snapshot.revision, 0);
        assert!(snapshot.values.is_empty());
    });
}

#[test]
fn large_completed_http_receipt_is_explicit_and_preserves_other_results_and_context() {
    let (_temp, prepared, host, _settings) = storage_run();
    let mut output = view(
        &"\u{1}".repeat(MAX_VIEW_STATE_BYTES),
        vec![
            json!({"kind":"http","id":"large-http","request":{"url":"https://jsonplaceholder.typicode.com/todos/1","method":"GET","headers":{},"body":null,"credential":null}}),
            storage_effect("small-storage", 0, "ok"),
        ],
    );
    output["fields"] = json!([{ "id":"escaped","label":"Escaped","value":"\u{2}".repeat(128*1024),"maxBytes":256*1024 }]);
    let parsed = ExtensionView::parse(&serde_json::to_string(&output).unwrap()).unwrap();
    let (mut reply, budget) = effect_reply(&parsed, "en").unwrap();
    let large = bounded_receipt(
        ExtensionEffectResult {
            id: "large-http".into(),
            value: Some(
                json!({"url":"https://jsonplaceholder.typicode.com/todos/1","status":200,"headers":{},"body":"\"".repeat(2*1024*1024)}),
            ),
            error: None,
        },
        budget - EFFECT_RECEIPT_RESERVE,
    );
    assert_eq!(large.id, "large-http");
    assert!(large.value.is_none());
    let error = large.error.as_ref().unwrap();
    assert_eq!(error.code, ErrorCode::InputTooLong);
    assert!(error.message.contains("completed") && error.message.contains("Do not retry"));
    let used = serde_json::to_vec(&large).unwrap().len() + 1;
    assert!(used < EFFECT_RECEIPT_RESERVE);
    let small = ExtensionEffectResult {
        id: "small-storage".into(),
        value: Some(json!({"revision":1,"values":{"ok":true}})),
        error: None,
    };
    let expected_small = serde_json::to_value(&small).unwrap();
    let small = bounded_receipt(small, budget - used);
    assert_eq!(serde_json::to_value(&small).unwrap(), expected_small);
    host.storage_patch(
        &prepared.package.manifest.id,
        0,
        BTreeMap::from([(
            "maximum".into(),
            Some(Value::String("\"".repeat((1024 * 1024 - 4096) / 2))),
        )]),
    )
    .unwrap();
    let context = serde_json::to_value(
        host.context(&prepared.package.manifest, &prepared.grants)
            .unwrap(),
    )
    .unwrap();
    let context_bytes = serde_json::to_vec(&context).unwrap().len();
    assert!(context_bytes > 1024 * 1024 - 8192 && context_bytes < HOST_CONTEXT_RESERVE);
    reply["host"] = context;
    reply["results"] = serde_json::to_value(vec![large, small]).unwrap();
    assert!(encode(&reply).unwrap().len() < MAX_VIEW_BYTES);
    serde_json::from_value::<ExtensionViewRequest>(reply)
        .unwrap()
        .validate()
        .unwrap();
}
