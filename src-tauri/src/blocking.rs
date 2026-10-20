//! 将原生同步服务移出异步运行时的工作线程。

use crate::error::{ErrorCode, NativeError, NativeResult};

pub async fn run<T: Send + 'static>(
    task: impl FnOnce() -> NativeResult<T> + Send + 'static,
) -> NativeResult<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            NativeError::operation(ErrorCode::Internal, "Native task did not complete", error)
        })?
}
