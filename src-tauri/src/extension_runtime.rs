//! 复用 Extism 的 ABI、Wasm 隔离和资源限制，不加载原生动态库或脚本解释器。
use crate::{
    error::{ErrorCode, NativeError, NativeResult, bounded_text},
    extensions::TEXT_LIMIT,
};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

pub const DEMO_WASM: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/text-tools.wasm"));
const TIMEOUT: Duration = Duration::from_secs(5);
const FUEL: u64 = 100_000_000;
const MEMORY_PAGES: u32 = 4096; // 256 MiB of linear memory.
struct Compilation {
    hash: [u8; 32],
    timeout: Duration,
    fuel: u64,
    plugin: extism::CompiledPlugin,
}
// 只保留最近一个不可变编译模块，不复用实例、内存、WASI 或插件变量。
static COMPILED: Mutex<Option<Compilation>> = Mutex::new(None);

pub fn run(
    module: &[u8],
    function: &str,
    input: &[u8],
    stop: Arc<AtomicBool>,
) -> NativeResult<String> {
    execute(module, function, input, stop, TIMEOUT, FUEL)
}

fn execute(
    module: &[u8],
    function: &str,
    input: &[u8],
    stop: Arc<AtomicBool>,
    timeout: Duration,
    fuel: u64,
) -> NativeResult<String> {
    let stopped = || NativeError::new(ErrorCode::UserCancelled, "Extension stopped");
    let failed = || {
        NativeError::new(
            ErrorCode::ExtensionRunFailed,
            "Extension could not run within its capabilities and resource budget",
        )
    };
    if stop.load(Ordering::Relaxed) {
        return Err(stopped());
    }
    if input.len() > 512 * 1024 {
        return Err(failed());
    }
    let hash: [u8; 32] = Sha256::digest(module).into();
    // 应用已有独占租约；这里也串行使用共享的 SDK engine / 小型实例池。
    let mut compilation = COMPILED.lock().map_err(|_| failed())?;
    if stop.load(Ordering::Relaxed) {
        return Err(stopped());
    }
    let cached = compilation
        .as_ref()
        .filter(|entry| entry.hash == hash && entry.timeout == timeout && entry.fuel == fuel)
        .map(|entry| entry.plugin.clone());
    let compiled = if let Some(cached) = cached {
        cached
    } else {
        // Only raw, already verified module bytes enter the runtime. No URL / path manifests.
        let mut manifest = extism::Manifest::new([extism::Wasm::data(module.to_vec())])
            .disallow_all_hosts()
            .with_memory_max(MEMORY_PAGES)
            .with_timeout(timeout);
        manifest.memory.max_var_bytes = Some(TEXT_LIMIT as u64);
        manifest.memory.max_http_response_bytes = Some(0);
        let debug = extism::DebugOptions {
            coredump: None,
            memdump: None,
            debug_info: false,
            profiling_strategy: wasmtime::ProfilingStrategy::None,
        };
        let mut pool = wasmtime::PoolingAllocationConfig::default();
        pool.total_core_instances(4)
            .total_memories(4)
            .total_tables(4)
            .max_memory_size(MEMORY_PAGES as usize * 65536)
            .table_elements(65536);
        let mut config = wasmtime::Config::new();
        config.allocation_strategy(wasmtime::InstanceAllocationStrategy::Pooling(pool));
        let compiled = extism::PluginBuilder::new(manifest)
            .with_wasmtime_config(config)
            .with_wasi(true)
            .with_cache_disabled()
            .with_debug_options(debug)
            // JS PDK needs WASI, but synchronous polling could outlive Wasm interrupts.
            .with_function_in_namespace(
                "wasi_snapshot_preview1",
                "poll_oneoff",
                [const { extism::ValType::I32 }; 4],
                [extism::ValType::I32],
                extism::UserData::new(()),
                |_, _, _, _| Err(extism::Error::msg("Blocking WASI polling is unavailable")),
            )
            .with_fuel_limit(fuel)
            .with_initialization_fuel_limit(fuel)
            .compile()
            .map_err(|_| failed())?;
        *compilation = Some(Compilation {
            hash,
            timeout,
            fuel,
            plugin: compiled.clone(),
        });
        compiled
    };
    if stop.load(Ordering::Relaxed) {
        return Err(stopped());
    }
    let mut plugin = extism::Plugin::new_from_compiled(&compiled).map_err(|_| failed())?;
    if stop.load(Ordering::Relaxed) {
        return Err(stopped());
    }
    if !plugin.function_exists(function) {
        return Err(failed());
    }
    let cancel = plugin.cancel_handle();
    let (done, finished) = mpsc::channel();
    let started = Instant::now();
    let timed_out = AtomicBool::new(false);
    let result = std::thread::scope(|scope| {
        let stop = &stop;
        let timed_out = &timed_out;
        scope.spawn(move || {
            loop {
                match finished.recv_timeout(Duration::from_millis(10)) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if started.elapsed() >= timeout {
                    timed_out.store(true, Ordering::Relaxed);
                }
                if stop.load(Ordering::Relaxed) || timed_out.load(Ordering::Relaxed) {
                    // Repeat until completion, including cancellation racing the SDK call timer.
                    let _ = cancel.cancel();
                }
            }
        });
        let result = plugin
            .call::<_, &[u8]>(function, input)
            .map_err(|_| failed())
            .and_then(|bytes| {
                if bytes.len() > TEXT_LIMIT {
                    return Err(failed());
                }
                let text = std::str::from_utf8(bytes).map_err(|_| failed())?;
                bounded_text(text, TEXT_LIMIT, "Extension output").map_err(|_| failed())?;
                Ok(text.to_owned())
            });
        let _ = done.send(());
        result
    });
    if stop.load(Ordering::Relaxed) {
        return Err(stopped());
    }
    if timed_out.load(Ordering::Relaxed) || started.elapsed() >= timeout {
        return Err(NativeError::new(
            ErrorCode::ExtensionTimeout,
            "Extension execution timed out",
        ));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn stop() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }
    #[test]
    fn standard_extism_exports_run_without_application_specific_abi() {
        assert_eq!(
            run(DEMO_WASM, "uppercase", "Hello 世界".as_bytes(), stop()).unwrap(),
            "HELLO 世界"
        );
        assert_eq!(
            run(DEMO_WASM, "lowercase", b"Hello", stop()).unwrap(),
            "hello"
        );
        assert!(run(DEMO_WASM, "missing", b"", stop()).is_err());
        assert!(run(DEMO_WASM, "uppercase", &vec![b'a'; TEXT_LIMIT + 1], stop()).is_err());
    }
    #[test]
    fn compiled_code_reuse_never_preserves_instance_state_or_old_budgets() {
        let module = br#"(module
          (import "extism:host/env" "alloc" (func $alloc (param i64) (result i64)))
          (import "extism:host/env" "store_u8" (func $store (param i64 i32)))
          (import "extism:host/env" "output_set" (func $output (param i64 i64)))
          (global $count (mut i32) (i32.const 48))
          (func (export "run") (result i32) (local $ptr i64)
            (local.set $ptr (call $alloc (i64.const 1)))
            (call $store (local.get $ptr) (global.get $count))
            (global.set $count (i32.add (global.get $count) (i32.const 1)))
            (call $output (local.get $ptr) (i64.const 1)) (i32.const 0)))"#;
        for _ in 0..2 {
            assert_eq!(run(module, "run", b"", stop()).unwrap(), "0");
        }
        assert!(execute(module, "run", b"", stop(), TIMEOUT, 1).is_err());
        assert_eq!(run(module, "run", b"", stop()).unwrap(), "0");
    }
    #[test]
    fn cancellation_and_time_budget_interrupt_infinite_wasm() {
        let module =
            br#"(module (func (export "run") (result i32) (loop $loop (br $loop)) (i32.const 0)) (func (export "quick") (result i32) (i32.const 0)))"#;
        let flag = stop();
        let control = flag.clone();
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            control.store(true, Ordering::Relaxed);
        });
        assert_eq!(
            execute(module, "run", b"", flag, TIMEOUT, u64::MAX)
                .unwrap_err()
                .code,
            ErrorCode::UserCancelled
        );
        worker.join().unwrap();
        assert_eq!(
            execute(module, "quick", b"", stop(), TIMEOUT, u64::MAX).unwrap(),
            ""
        );
        assert_eq!(
            execute(
                module,
                "run",
                b"",
                stop(),
                Duration::from_millis(40),
                u64::MAX
            )
            .unwrap_err()
            .code,
            ErrorCode::ExtensionTimeout
        );
        assert!(execute(module, "run", b"", stop(), TIMEOUT, 1000).is_err());
        let initializer =
            br#"(module (func $init (loop $spin (br $spin))) (start $init) (func (export "run")))"#;
        assert!(execute(initializer, "run", b"", stop(), TIMEOUT, 1000).is_err());
    }
    #[test]
    fn completed_calls_still_observe_a_deadline_shorter_than_the_cancel_poll_interval() {
        let module = br#"(module (func (export "run") (result i32) (i32.const 0)))"#;
        assert_eq!(
            execute(module, "run", b"", stop(), Duration::from_nanos(1), FUEL)
                .unwrap_err()
                .code,
            ErrorCode::ExtensionTimeout
        );
    }
    #[test]
    fn denies_unknown_host_imports_and_unbounded_memory() {
        let wasi = br#"(module (import "host:filesystem" "read" (func (param i32))) (func (export "run")))"#;
        assert!(run(wasi, "run", b"", stop()).is_err());
        let large = br#"(module (memory 4097) (func (export "run")))"#;
        assert!(run(large, "run", b"", stop()).is_err());
        let table = br#"(module (table 65537 funcref) (func (export "run")))"#;
        assert!(run(table, "run", b"", stop()).is_err());
        let polling = br#"(module (import "wasi_snapshot_preview1" "poll_oneoff" (func $poll (param i32 i32 i32 i32) (result i32))) (func (export "run") (result i32) (call $poll (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))"#;
        assert!(run(polling, "run", b"", stop()).is_err());
    }
    #[test]
    fn wasi_does_not_inherit_environment_or_preopen_directories() {
        let module = br#"(module
          (import "wasi_snapshot_preview1" "environ_sizes_get" (func $env (param i32 i32) (result i32)))
          (import "wasi_snapshot_preview1" "fd_prestat_get" (func $fd (param i32 i32) (result i32)))
          (memory (export "memory") 1)
          (func (export "run") (result i32)
            (drop (call $env (i32.const 0) (i32.const 4)))
            (if (i32.ne (i32.load (i32.const 0)) (i32.const 0)) (then (return (i32.const 1))))
            (if (i32.ne (call $fd (i32.const 3) (i32.const 8)) (i32.const 8)) (then (return (i32.const 1))))
            (i32.const 0)))"#;
        assert_eq!(run(module, "run", b"", stop()).unwrap(), "");
    }
}
