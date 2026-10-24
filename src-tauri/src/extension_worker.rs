//! 固定自身可执行文件的无界面 worker；取消和总超时均回收本次拥有的进程。
use crate::{
    error::NativeResult,
    extension_runtime::{self, CompilationCache, Failure, IO_LIMIT, MODULE_LIMIT, TIMEOUT},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    io::{self, Read, Write},
    process::{Child, Command, Stdio},
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const SLOTS: usize = 2;
const FRAME_LIMIT: usize = 32 * 1024 * 1024;
const POLL: Duration = Duration::from_millis(10);
static WORKERS: LazyLock<[Mutex<Option<Worker>>; SLOTS]> =
    LazyLock::new(|| std::array::from_fn(|_| Mutex::new(None)));
static CLOSING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    module: String,
    operation: Operation,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
enum Operation {
    Run { function: String, input: String },
    Validate { exports: Vec<String> },
}

type Reply = Result<String, Failure>;

struct Worker {
    child: Child,
    requests: Option<mpsc::SyncSender<Request>>,
    replies: mpsc::Receiver<io::Result<Reply>>,
    io_thread: Option<JoinHandle<()>>,
}

impl Worker {
    fn spawn() -> io::Result<Self> {
        let mut command = Command::new(std::env::current_exe()?);
        command
            .arg("--extension-worker")
            // Extism 的 EXTISM_ENABLE_WASI_OUTPUT 等环境开关也不得继承。
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = command.spawn()?;
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::other("Worker input pipe unavailable"));
        };
        let Some(mut stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(io::Error::other("Worker output pipe unavailable"));
        };
        let (requests, incoming) = mpsc::sync_channel::<Request>(1);
        let (outgoing, replies) = mpsc::sync_channel(1);
        let io_thread = thread::Builder::new()
            .name("extension-worker-io".into())
            .spawn(move || {
                while let Ok(request) = incoming.recv() {
                    let response =
                        write_frame(&mut stdin, &request).and_then(|()| read_frame(&mut stdout));
                    let failed = response.is_err();
                    if outgoing.send(response).is_err() || failed {
                        break;
                    }
                }
            });
        let io_thread = match io_thread {
            Ok(thread) => thread,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        Ok(Self {
            child,
            requests: Some(requests),
            replies,
            io_thread: Some(io_thread),
        })
    }

    fn call(
        &mut self,
        request: Request,
        stop: &AtomicBool,
        started: Instant,
        timeout: Duration,
    ) -> Result<Reply, Failure> {
        self.requests
            .as_ref()
            .ok_or_else(|| Failure::failed("worker", "worker is closed"))?
            .try_send(request)
            .map_err(|_| Failure::failed("worker", "worker request channel is unavailable"))?;
        wait_for_reply(&self.replies, stop, started, timeout)
    }
}

fn wait_for_reply(
    replies: &mpsc::Receiver<io::Result<Reply>>,
    stop: &AtomicBool,
    started: Instant,
    timeout: Duration,
) -> Result<Reply, Failure> {
    loop {
        if stop.load(Ordering::Relaxed) || CLOSING.load(Ordering::Acquire) {
            return Err(Failure::cancelled());
        }
        let Some(remaining) = timeout.checked_sub(started.elapsed()) else {
            return Err(Failure::timeout());
        };
        match replies.recv_timeout(POLL.min(remaining)) {
            Ok(Ok(reply)) => {
                if stop.load(Ordering::Relaxed) {
                    return Err(Failure::cancelled());
                }
                if started.elapsed() >= timeout {
                    return Err(Failure::timeout());
                }
                return Ok(reply);
            }
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(Failure::failed(
                    "worker",
                    "worker exited or returned an invalid frame",
                ));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.requests.take();
        // Child 句柄只来自本模块的 spawn；不搜索进程名、不操作任意 PID。
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(thread) = self.io_thread.take() {
            let _ = thread.join();
        }
    }
}

fn dispatch(
    request: Request,
    stop: Arc<AtomicBool>,
    started: Instant,
    timeout: Duration,
) -> NativeResult<String> {
    loop {
        if stop.load(Ordering::Relaxed) || CLOSING.load(Ordering::Acquire) {
            return Err(Failure::cancelled().native());
        }
        if started.elapsed() >= timeout {
            return Err(Failure::timeout().native());
        }
        for slot in WORKERS.iter() {
            let mut slot = match slot.try_lock() {
                Ok(slot) => slot,
                Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => continue,
            };
            if slot
                .as_mut()
                .is_some_and(|worker| !matches!(worker.child.try_wait(), Ok(None)))
            {
                // 空闲期间崩溃的 worker 在接收新请求前替换，不使新调用白白失败。
                slot.take();
            }
            if slot.is_none() {
                *slot =
                    Some(Worker::spawn().map_err(|_| {
                        Failure::failed("worker", "worker could not start").native()
                    })?);
            }
            let result = slot
                .as_mut()
                .expect("initialized worker")
                .call(request, &stop, started, timeout);
            return match result {
                Ok(reply) => reply.map_err(Failure::native),
                Err(failure) => {
                    // 协议断连、总超时或取消后不再复用进程 / 编译缓存。
                    slot.take();
                    Err(failure.native())
                }
            };
        }
        thread::sleep(POLL);
    }
}

pub(crate) fn run(
    module: &[u8],
    function: &str,
    input: &[u8],
    stop: Arc<AtomicBool>,
) -> NativeResult<String> {
    let started = Instant::now();
    extension_runtime::check_request(module, function, input).map_err(Failure::native)?;
    dispatch(
        Request {
            module: STANDARD.encode(module),
            operation: Operation::Run {
                function: function.into(),
                input: STANDARD.encode(input),
            },
        },
        stop,
        started,
        TIMEOUT,
    )
}

pub(crate) fn validate(module: &[u8], exports: &[&str]) -> NativeResult<()> {
    let started = Instant::now();
    extension_runtime::check_request(module, "validate", &[]).map_err(Failure::native)?;
    if exports.len() > 128
        || exports
            .iter()
            .any(|name| name.is_empty() || name.len() > 128 || name.contains('\0'))
    {
        return Err(Failure::failed("validate", "invalid export declaration").native());
    }
    dispatch(
        Request {
            module: STANDARD.encode(module),
            operation: Operation::Validate {
                exports: exports.iter().map(|name| (*name).into()).collect(),
            },
        },
        Arc::new(AtomicBool::new(false)),
        started,
        TIMEOUT,
    )
    .map(|_| ())
}

pub(crate) fn shutdown() {
    CLOSING.store(true, Ordering::Release);
    for slot in WORKERS.iter() {
        slot.lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }
}

fn write_frame(writer: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    let frame = serde_json::to_vec(value).map_err(io::Error::other)?;
    if frame.is_empty() || frame.len() > FRAME_LIMIT {
        return Err(io::Error::other("Worker frame exceeds the size budget"));
    }
    writer.write_all(&(frame.len() as u32).to_be_bytes())?;
    writer.write_all(&frame)?;
    writer.flush()
}

fn read_frame<T: DeserializeOwned>(reader: &mut impl Read) -> io::Result<T> {
    let mut prefix = [0; 4];
    reader.read_exact(&mut prefix)?;
    let length = u32::from_be_bytes(prefix) as usize;
    if length == 0 || length > FRAME_LIMIT {
        return Err(io::Error::other("Invalid worker frame length"));
    }
    let mut frame = vec![0; length];
    reader.read_exact(&mut frame)?;
    serde_json::from_slice(&frame).map_err(io::Error::other)
}

fn process_request(request: Request, cache: &mut CompilationCache) -> Reply {
    // 在 base64 解码分配前再检查对应的编码上限。
    if request.module.len() > MODULE_LIMIT.div_ceil(3) * 4 {
        return Err(Failure::failed("input", "module exceeds the size budget"));
    }
    let module = STANDARD
        .decode(request.module)
        .map_err(|_| Failure::failed("input", "module encoding is invalid"))?;
    match request.operation {
        Operation::Run { function, input } => {
            if input.len() > IO_LIMIT.div_ceil(3) * 4 {
                return Err(Failure::failed("input", "input exceeds the size budget"));
            }
            let input = STANDARD
                .decode(input)
                .map_err(|_| Failure::failed("input", "input encoding is invalid"))?;
            extension_runtime::execute_worker(cache, &module, &function, &input)
        }
        Operation::Validate { exports } => {
            let names = exports.iter().map(String::as_str).collect::<Vec<_>>();
            extension_runtime::validate_in_process(&module, &names).map(|()| String::new())
        }
    }
}

pub(crate) fn worker_main() -> i32 {
    // 独立读取线程也负责父进程退出探测；即使编译尚未完成，stdin EOF 也立即退出。
    let (sender, receiver) = mpsc::sync_channel(1);
    if thread::Builder::new()
        .name("extension-worker-input".into())
        .spawn(move || {
            let mut input = io::stdin().lock();
            loop {
                match read_frame::<Request>(&mut input) {
                    Ok(request) => {
                        if sender.send(request).is_err() {
                            return;
                        }
                    }
                    Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
                        std::process::exit(0)
                    }
                    Err(_) => std::process::exit(2),
                }
            }
        })
        .is_err()
    {
        return 2;
    }
    let mut cache = CompilationCache::default();
    let mut output = io::stdout().lock();
    while let Ok(request) = receiver.recv() {
        if write_frame(&mut output, &process_request(request, &mut cache)).is_err() {
            return 2;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_are_length_delimited_and_reject_invalid_or_oversized_input() {
        let mut frames = Vec::new();
        write_frame(&mut frames, &"first\nsecond").unwrap();
        write_frame(&mut frames, &"third").unwrap();
        let mut reader = frames.as_slice();
        assert_eq!(read_frame::<String>(&mut reader).unwrap(), "first\nsecond");
        assert_eq!(read_frame::<String>(&mut reader).unwrap(), "third");
        for bytes in [
            vec![0; 4],
            ((FRAME_LIMIT + 1) as u32).to_be_bytes().to_vec(),
            vec![0, 0, 0, 1, b'{'],
            vec![0, 0, 0, 2, b'{'],
        ] {
            assert!(read_frame::<Request>(&mut bytes.as_slice()).is_err());
        }
    }
    #[test]
    fn protocol_uses_only_fixed_operations_and_validates_decoded_payloads() {
        // 同时检查父进程边界；无效入参在创建任何进程之前返回。
        assert!(run(b"", "run", b"", Arc::new(AtomicBool::new(false))).is_err());
        assert!(validate(b"", &["run"]).is_err());
        assert!(
            serde_json::from_str::<Request>(
                r#"{"module":"AA==","operation":{"action":"shell","command":"anything"}}"#
            )
            .is_err()
        );
        let request = Request {
            module: "!".into(),
            operation: Operation::Validate { exports: vec![] },
        };
        assert!(process_request(request, &mut CompilationCache::default()).is_err());
        let request = Request {
            module: STANDARD.encode(b"(module (func (export \"run\") (result i32) (i32.const 0)))"),
            operation: Operation::Run {
                function: "run".into(),
                input: "!".into(),
            },
        };
        assert!(process_request(request, &mut CompilationCache::default()).is_err());
    }
    #[test]
    fn waiting_observes_overall_deadline_cancel_and_worker_disconnect() {
        use extension_runtime::FailureKind;
        let (sender, replies) = mpsc::sync_channel(1);
        let stop = AtomicBool::new(false);
        assert!(matches!(
            wait_for_reply(&replies, &stop, Instant::now(), Duration::from_millis(20))
                .unwrap_err()
                .kind,
            FailureKind::Timeout
        ));
        stop.store(true, Ordering::Relaxed);
        assert!(matches!(
            wait_for_reply(&replies, &stop, Instant::now(), TIMEOUT)
                .unwrap_err()
                .kind,
            FailureKind::Cancelled
        ));
        stop.store(false, Ordering::Relaxed);
        sender.send(Ok(Ok("ready".into()))).unwrap();
        assert_eq!(
            wait_for_reply(&replies, &stop, Instant::now(), TIMEOUT)
                .unwrap()
                .unwrap(),
            "ready"
        );
        drop(sender);
        assert!(matches!(
            wait_for_reply(&replies, &stop, Instant::now(), TIMEOUT)
                .unwrap_err()
                .kind,
            FailureKind::Failed
        ));
    }
}
