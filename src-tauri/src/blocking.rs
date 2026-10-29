//! 将原生同步服务移出异步运行时的工作线程，并在进入阻塞池前限制并发。

use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;

use crate::error::{ErrorCode, NativeError, NativeResult};

const MAX_NATIVE_TASKS: usize = 16;
static TASKS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(MAX_NATIVE_TASKS)));

pub async fn run<T: Send + 'static>(
    task: impl FnOnce() -> NativeResult<T> + Send + 'static,
) -> NativeResult<T> {
    run_limited(&TASKS, task).await
}

async fn run_limited<T: Send + 'static>(
    tasks: &Arc<Semaphore>,
    task: impl FnOnce() -> NativeResult<T> + Send + 'static,
) -> NativeResult<T> {
    let permit = tasks.clone().try_acquire_owned().map_err(|_| {
        NativeError::new(
            ErrorCode::NativeBusy,
            "Native task limit reached; try again after an operation finishes",
        )
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        // 停止等待不会取消同步 I/O；执行位置随真实任务结束后释放。
        let _permit = permit;
        task()
    })
    .await
    .map_err(|error| {
        NativeError::operation(ErrorCode::Internal, "Native task did not complete", error)
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };

    #[test]
    fn rejects_excess_work_and_keeps_the_slot_after_the_waiter_is_cancelled() {
        let tasks = Arc::new(Semaphore::new(1));
        let worker_tasks = tasks.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let waiter = tauri::async_runtime::spawn(async move {
            run_limited(&worker_tasks, move || {
                started_tx.send(()).unwrap();
                finish_rx.recv().unwrap();
                Ok(())
            })
            .await
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let reject = || tauri::async_runtime::block_on(run_limited(&tasks, || Ok(())));
        assert_eq!(reject().unwrap_err().code, ErrorCode::NativeBusy);
        waiter.abort();
        assert_eq!(reject().unwrap_err().code, ErrorCode::NativeBusy);
        finish_tx.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while tasks.available_permits() == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(1));
        }
        reject().unwrap();
    }

    #[test]
    fn failed_operations_release_the_slot_and_keep_their_error_code() {
        let tasks = Arc::new(Semaphore::new(1));
        let result: NativeResult<()> = tauri::async_runtime::block_on(run_limited(&tasks, || {
            Err(NativeError::new(
                ErrorCode::Conflict,
                "Changed while saving",
            ))
        }));
        assert_eq!(result.unwrap_err().code, ErrorCode::Conflict);
        assert_eq!(tasks.available_permits(), 1);
    }
}
