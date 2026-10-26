//! Extism ABI 与实例隔离；桌面调用在固定的无界面宿主子进程中完成。
use crate::error::{ErrorCode, NativeError, NativeResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

pub const DEMO_WASM: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/text-tools.wasm"));
pub(crate) const TIMEOUT: Duration = Duration::from_secs(15);
pub(crate) const IO_LIMIT: usize = 4 * 1024 * 1024;
pub(crate) const MODULE_LIMIT: usize = 16 * 1024 * 1024;
const FUEL: u64 = 100_000_000;
const MEMORY_PAGES: u32 = 4096;
const MAX_MEMORIES_PER_MODULE: u32 = 1;
const MAX_TABLES_PER_MODULE: u32 = 1;
const CACHE_ENTRIES: usize = 4;
// SDK 不公开 JIT 实际占用；此额度针对源模块字节，条目数另设硬上限。
const CACHE_SOURCE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum FailureKind {
    Failed,
    Timeout,
    Cancelled,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Failure {
    pub kind: FailureKind,
    pub message: String,
}

impl Failure {
    pub(crate) fn failed(stage: &str, reason: &str) -> Self {
        Self {
            kind: FailureKind::Failed,
            message: format!("Extension {stage}: {reason}"),
        }
    }
    pub(crate) fn timeout() -> Self {
        Self {
            kind: FailureKind::Timeout,
            message: "Extension worker: overall deadline exceeded".into(),
        }
    }
    pub(crate) fn cancelled() -> Self {
        Self {
            kind: FailureKind::Cancelled,
            message: "Extension worker: cancelled".into(),
        }
    }
    pub(crate) fn native(self) -> NativeError {
        let code = match self.kind {
            FailureKind::Failed => ErrorCode::ExtensionRunFailed,
            FailureKind::Timeout => ErrorCode::ExtensionTimeout,
            FailureKind::Cancelled => ErrorCode::UserCancelled,
        };
        NativeError::new(code, self.message)
    }
}

type RuntimeResult<T> = Result<T, Failure>;

struct Compilation {
    hash: [u8; 32],
    source_bytes: usize,
    timeout: Duration,
    fuel: u64,
    plugin: extism::CompiledPlugin,
}

#[derive(Default)]
pub(crate) struct CompilationCache(VecDeque<Compilation>);

impl CompilationCache {
    fn compile(
        &mut self,
        module: &[u8],
        timeout: Duration,
        fuel: u64,
    ) -> RuntimeResult<extism::CompiledPlugin> {
        let hash: [u8; 32] = Sha256::digest(module).into();
        if let Some(index) = self
            .0
            .iter()
            .position(|entry| entry.hash == hash && entry.timeout == timeout && entry.fuel == fuel)
        {
            let entry = self.0.remove(index).expect("existing cache entry");
            let compiled = entry.plugin.clone();
            self.0.push_back(entry);
            return Ok(compiled);
        }
        // 只使用已校验的内存模块，不接受 Extism URL / 路径清单。
        let mut manifest = extism::Manifest::new([extism::Wasm::data(module.to_vec())])
            .disallow_all_hosts()
            .with_memory_max(MEMORY_PAGES)
            .with_timeout(timeout);
        manifest.memory.max_var_bytes = Some(IO_LIMIT as u64);
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
            .max_memories_per_module(MAX_MEMORIES_PER_MODULE)
            .max_tables_per_module(MAX_TABLES_PER_MODULE)
            .max_memory_size(MEMORY_PAGES as usize * 65536)
            .table_elements(65536);
        let mut config = wasmtime::Config::new();
        config.allocation_strategy(wasmtime::InstanceAllocationStrategy::Pooling(pool));
        let compiled = extism::PluginBuilder::new(manifest)
            .with_wasmtime_config(config)
            .with_wasi(true)
            .with_cache_disabled()
            .with_debug_options(debug)
            // JS PDK 需要 WASI，阻塞 polling 却可能逃逸 Wasm 中断。
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
            .map_err(|_| Failure::failed("compile", "module compilation failed"))?;
        while !self.0.is_empty()
            && (self.0.len() >= CACHE_ENTRIES
                || self.0.iter().map(|entry| entry.source_bytes).sum::<usize>() + module.len()
                    > CACHE_SOURCE_BYTES)
        {
            self.0.pop_front();
        }
        self.0.push_back(Compilation {
            hash,
            source_bytes: module.len(),
            timeout,
            fuel,
            plugin: compiled.clone(),
        });
        Ok(compiled)
    }
}

pub fn run(
    module: &[u8],
    function: &str,
    input: &[u8],
    stop: Arc<AtomicBool>,
) -> NativeResult<String> {
    #[cfg(not(test))]
    {
        crate::extension_worker::run(module, function, input, stop)
    }
    #[cfg(test)]
    {
        run_in_process(module, function, input, stop, TIMEOUT, FUEL)
    }
}

/// 完整编译和检查约定导出，不创建实例、不运行 Wasm start / 初始化。
pub fn validate(module: &[u8], expected_exports: &[&str]) -> NativeResult<()> {
    #[cfg(not(test))]
    {
        crate::extension_worker::validate(module, expected_exports)
    }
    #[cfg(test)]
    {
        validate_in_process(module, expected_exports).map_err(Failure::native)
    }
}

/// 可执行文件必须在初始化 Tauri、单实例插件及日志之前分派此固定协议。
pub fn worker_main() -> i32 {
    crate::extension_worker::worker_main()
}

/// 仅终止本运行时创建并仍持有的子进程；实际退出前调用。
pub fn shutdown_workers() {
    crate::extension_worker::shutdown()
}

pub(crate) fn check_request(module: &[u8], function: &str, input: &[u8]) -> RuntimeResult<()> {
    if module.is_empty() || module.len() > MODULE_LIMIT {
        return Err(Failure::failed(
            "input",
            "module exceeds the size budget or is empty",
        ));
    }
    if function.is_empty() || function.len() > 128 || function.contains('\0') {
        return Err(Failure::failed("input", "invalid exported function name"));
    }
    if input.len() > IO_LIMIT {
        return Err(Failure::failed("input", "input exceeds the 4 MiB budget"));
    }
    Ok(())
}

pub(crate) fn validate_in_process(module: &[u8], expected_exports: &[&str]) -> RuntimeResult<()> {
    check_request(module, "validate", &[])?;
    if expected_exports.len() > 128
        || expected_exports
            .iter()
            .any(|name| name.is_empty() || name.len() > 128 || name.contains('\0'))
    {
        return Err(Failure::failed("validate", "invalid export declaration"));
    }
    let engine = wasmtime::Engine::default();
    let compiled = wasmtime::Module::new(&engine, module)
        .map_err(|_| Failure::failed("validate", "module compilation failed"))?;
    let resources = compiled.resources_required();
    if resources.num_memories > MAX_MEMORIES_PER_MODULE
        || resources.num_tables > MAX_TABLES_PER_MODULE
        || resources
            .max_initial_memory_size
            .is_some_and(|size| size > u64::from(MEMORY_PAGES))
        || resources
            .max_initial_table_size
            .is_some_and(|size| size > 65536)
    {
        return Err(Failure::failed(
            "validate",
            "module exceeds the memory or table budget",
        ));
    }
    for import in compiled.imports() {
        let wasmtime::ExternType::Func(function) = import.ty() else {
            return Err(Failure::failed("validate", "unsupported host import"));
        };
        let Some((parameters, result)) = host_signature(import.module(), import.name()) else {
            return Err(Failure::failed("validate", "unsupported host import"));
        };
        let matches = |actual: wasmtime::ValType, expected: AbiType| {
            matches!(
                (actual, expected),
                (wasmtime::ValType::I32, AbiType::I32) | (wasmtime::ValType::I64, AbiType::I64)
            )
        };
        if function.params().len() != parameters.len()
            || !function
                .params()
                .zip(parameters)
                .all(|(actual, expected)| matches(actual, *expected))
            || function.results().len() != usize::from(result.is_some())
            || !function
                .results()
                .zip(result)
                .all(|(actual, expected)| matches(actual, expected))
        {
            return Err(Failure::failed(
                "validate",
                "host import has an incompatible ABI",
            ));
        }
    }
    for name in expected_exports {
        let Some(wasmtime::ExternType::Func(function)) = compiled.get_export(name) else {
            return Err(Failure::failed(
                "validate",
                "a declared function export is missing",
            ));
        };
        if function.params().len() != 0
            || !matches!(
                function.results().collect::<Vec<_>>().as_slice(),
                [wasmtime::ValType::I32]
            )
        {
            return Err(Failure::failed(
                "validate",
                "a declared function has an incompatible Extism ABI",
            ));
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum AbiType {
    I32,
    I64,
}

/// 固定 SDK 的公开宿主 ABI；升级 Extism / Wasmtime 时和内嵌 kernel 导出、
/// extism::plugin::relink、WASI preview1 WITX 一并核验。不创建 guest 实例。
fn host_signature(namespace: &str, name: &str) -> Option<(&'static [AbiType], Option<AbiType>)> {
    use AbiType::{I32, I64};
    Some(match namespace {
        "extism:host/env" => match name {
            "alloc" | "length_unsafe" | "length" | "load_u64" | "input_load_u64" | "config_get"
            | "var_get" => (&[I64], Some(I64)),
            "load_u8" | "input_load_u8" => (&[I64], Some(I32)),
            "free" | "error_set" | "log_warn" | "log_info" | "log_debug" | "log_error"
            | "log_trace" => (&[I64], None),
            "store_u8" => (&[I64, I32], None),
            "store_u64" | "input_set" | "output_set" | "var_set" => (&[I64, I64], None),
            "http_request" => (&[I64, I64], Some(I64)),
            "input_length" | "input_offset" | "output_length" | "output_offset" | "error_get"
            | "memory_bytes" | "http_headers" => (&[], Some(I64)),
            "http_status_code" | "get_log_level" => (&[], Some(I32)),
            "reset" => (&[], None),
            _ => return None,
        },
        "wasi_snapshot_preview1" => match name {
            "args_get"
            | "args_sizes_get"
            | "environ_get"
            | "environ_sizes_get"
            | "clock_res_get"
            | "fd_fdstat_get"
            | "fd_fdstat_set_flags"
            | "fd_filestat_get"
            | "fd_prestat_get"
            | "fd_renumber"
            | "fd_tell"
            | "random_get"
            | "sock_shutdown" => (&[I32, I32], Some(I32)),
            "clock_time_get" => (&[I32, I64, I32], Some(I32)),
            "fd_seek" => (&[I32, I64, I32, I32], Some(I32)),
            "fd_advise" | "fd_filestat_set_times" => (&[I32, I64, I64, I32], Some(I32)),
            "fd_allocate" | "fd_fdstat_set_rights" => (&[I32, I64, I64], Some(I32)),
            "fd_close" | "fd_datasync" | "fd_sync" | "proc_raise" => (&[I32], Some(I32)),
            "fd_filestat_set_size" => (&[I32, I64], Some(I32)),
            "fd_pread" | "fd_pwrite" | "fd_readdir" => (&[I32, I32, I32, I64, I32], Some(I32)),
            "fd_prestat_dir_name"
            | "path_create_directory"
            | "path_remove_directory"
            | "path_unlink_file"
            | "sock_accept" => (&[I32, I32, I32], Some(I32)),
            "fd_read" | "fd_write" | "poll_oneoff" => (&[I32, I32, I32, I32], Some(I32)),
            "path_filestat_get" | "path_symlink" | "sock_send" => {
                (&[I32, I32, I32, I32, I32], Some(I32))
            }
            "path_filestat_set_times" => (&[I32, I32, I32, I32, I64, I64, I32], Some(I32)),
            "path_link" => (&[I32, I32, I32, I32, I32, I32, I32], Some(I32)),
            "path_open" => (&[I32, I32, I32, I32, I32, I64, I64, I32, I32], Some(I32)),
            "path_readlink" | "path_rename" | "sock_recv" => {
                (&[I32, I32, I32, I32, I32, I32], Some(I32))
            }
            "proc_exit" => (&[I32], None),
            "sched_yield" => (&[], Some(I32)),
            _ => return None,
        },
        _ => return None,
    })
}

#[cfg(test)]
fn run_in_process(
    module: &[u8],
    function: &str,
    input: &[u8],
    stop: Arc<AtomicBool>,
    timeout: Duration,
    fuel: u64,
) -> NativeResult<String> {
    static CACHE: std::sync::Mutex<CompilationCache> =
        std::sync::Mutex::new(CompilationCache(VecDeque::new()));
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    execute(&mut cache, module, function, input, stop, timeout, fuel).map_err(Failure::native)
}

pub(crate) fn execute(
    cache: &mut CompilationCache,
    module: &[u8],
    function: &str,
    input: &[u8],
    stop: Arc<AtomicBool>,
    timeout: Duration,
    fuel: u64,
) -> RuntimeResult<String> {
    let started = Instant::now();
    check_request(module, function, input)?;
    if stop.load(Ordering::Relaxed) {
        return Err(Failure::cancelled());
    }
    let compiled = cache.compile(module, timeout, fuel)?;
    if stop.load(Ordering::Relaxed) {
        return Err(Failure::cancelled());
    }
    if started.elapsed() >= timeout {
        return Err(Failure::timeout());
    }
    let mut plugin = extism::Plugin::new_from_compiled(&compiled).map_err(|error| {
        let reason = if fuel_error(&error) {
            "initialization exhausted the fuel budget"
        } else {
            "initialization or linking failed"
        };
        Failure::failed("initialize", reason)
    })?;
    if stop.load(Ordering::Relaxed) {
        return Err(Failure::cancelled());
    }
    if started.elapsed() >= timeout {
        return Err(Failure::timeout());
    }
    if !plugin.function_exists(function) {
        return Err(Failure::failed(
            "export",
            "requested function does not exist",
        ));
    }
    let cancel = plugin.cancel_handle();
    let (done, finished) = mpsc::channel();
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
                    let _ = cancel.cancel();
                }
            }
        });
        let result = plugin
            .call::<_, &[u8]>(function, input)
            .map_err(|error| {
                Failure::failed(
                    "execute",
                    if fuel_error(&error) {
                        "fuel budget exhausted"
                    } else {
                        "module trapped or returned an error"
                    },
                )
            })
            .and_then(|bytes| {
                if bytes.len() > IO_LIMIT {
                    return Err(Failure::failed("output", "output exceeds the 4 MiB budget"));
                }
                let text = std::str::from_utf8(bytes)
                    .map_err(|_| Failure::failed("output", "output is not UTF-8"))?;
                if text.contains('\0') {
                    return Err(Failure::failed(
                        "output",
                        "output contains a null character",
                    ));
                }
                Ok(text.to_owned())
            });
        let _ = done.send(());
        result
    });
    if stop.load(Ordering::Relaxed) {
        return Err(Failure::cancelled());
    }
    if timed_out.load(Ordering::Relaxed) || started.elapsed() >= timeout {
        return Err(Failure::timeout());
    }
    result
}

fn fuel_error(error: &extism::Error) -> bool {
    error.chain().any(|cause| cause.downcast_ref::<wasmtime::Trap>() == Some(&wasmtime::Trap::OutOfFuel))
        // Extism 1.41 将 fuel=0 的 trap 转为固定 SDK 错误；不向用户暴露 guest 错误文本。
        || error.to_string() == "plugin ran out of fuel"
}

pub(crate) fn execute_worker(
    cache: &mut CompilationCache,
    module: &[u8],
    function: &str,
    input: &[u8],
) -> RuntimeResult<String> {
    execute(
        cache,
        module,
        function,
        input,
        Arc::new(AtomicBool::new(false)),
        TIMEOUT,
        FUEL,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn run(
        module: &[u8],
        function: &str,
        input: &[u8],
        stop: Arc<AtomicBool>,
    ) -> NativeResult<String> {
        run_in_process(module, function, input, stop, TIMEOUT, FUEL)
    }
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
        assert!(run(DEMO_WASM, "uppercase", &vec![b'a'; IO_LIMIT + 1], stop()).is_err());
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
        assert!(run_in_process(module, "run", b"", stop(), TIMEOUT, 1).is_err());
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
            run_in_process(module, "run", b"", flag, TIMEOUT, u64::MAX)
                .unwrap_err()
                .code,
            ErrorCode::UserCancelled
        );
        worker.join().unwrap();
        assert_eq!(
            run_in_process(module, "quick", b"", stop(), TIMEOUT, u64::MAX).unwrap(),
            ""
        );
        assert_eq!(
            run_in_process(
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
        assert!(run_in_process(module, "run", b"", stop(), TIMEOUT, 1000).is_err());
        let initializer =
            br#"(module (func $init (loop $spin (br $spin))) (start $init) (func (export "run")))"#;
        assert!(run_in_process(initializer, "run", b"", stop(), TIMEOUT, 1000).is_err());
    }
    #[test]
    fn completed_calls_still_observe_a_deadline_shorter_than_the_cancel_poll_interval() {
        let module = br#"(module (func (export "run") (result i32) (i32.const 0)))"#;
        assert_eq!(
            run_in_process(module, "run", b"", stop(), Duration::from_nanos(1), FUEL)
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
    #[test]
    fn validation_checks_exports_and_abi_without_running_initialization() {
        let initializer = br#"(module (func $init unreachable) (start $init) (func (export "run") (result i32) (i32.const 0)))"#;
        validate(initializer, &["run"]).unwrap();
        assert!(validate(initializer, &["missing"]).is_err());
        assert!(
            validate(
                br#"(module (func (export "run") (param i32) (result i32) (i32.const 0)))"#,
                &["run"]
            )
            .is_err()
        );
        assert!(validate(b"not wasm", &["run"]).is_err());
        let memory = br#"(module (memory 4097) (func (export "run") (result i32) (i32.const 0)))"#;
        assert!(validate(memory, &["run"]).is_err());
        let unknown_import = br#"(module (import "host:filesystem" "read" (func)) (func (export "run") (result i32) (i32.const 0)))"#;
        assert!(validate(unknown_import, &["run"]).is_err());
        for module in [
            br#"(module (import "extism:host/env" "missing" (func)) (func (export "run") (result i32) (i32.const 0)))"#.as_slice(),
            br#"(module (import "extism:host/env" "alloc" (func (param i32) (result i64))) (func (export "run") (result i32) (i32.const 0)))"#.as_slice(),
            br#"(module (import "wasi_snapshot_preview1" "missing" (func)) (func (export "run") (result i32) (i32.const 0)))"#.as_slice(),
            br#"(module (import "wasi_snapshot_preview1" "clock_time_get" (func (param i32 i32 i32) (result i32))) (func (export "run") (result i32) (i32.const 0)))"#.as_slice(),
        ] {
            assert!(validate(module, &["run"]).is_err());
        }
        validate(DEMO_WASM, &["uppercase", "lowercase"]).unwrap();
    }
    #[test]
    fn compilation_cache_is_a_bounded_lru() {
        let mut cache = CompilationCache::default();
        for number in 0..CACHE_ENTRIES + 1 {
            let module =
                format!("(module (func (export \"run\") (result i32) (i32.const {number})))");
            cache.compile(module.as_bytes(), TIMEOUT, FUEL).unwrap();
        }
        assert_eq!(cache.0.len(), CACHE_ENTRIES);
        assert!(
            cache
                .0
                .iter()
                .map(|entry| entry.source_bytes)
                .sum::<usize>()
                <= CACHE_SOURCE_BYTES
        );
        let hash = cache.0.front().unwrap().hash;
        let module = b"(module (func (export \"run\") (result i32) (i32.const 1)))";
        cache.compile(module, TIMEOUT, FUEL).unwrap();
        assert_eq!(cache.0.back().unwrap().hash, hash);
    }
}
