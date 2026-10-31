//! 无头设备会话内核。内部句柄隔离连接代次，不代替 IPC 或插件调用边界的用户授权。
pub mod model;
mod session;
mod stream;

pub use session::{ConnectionToken, DeviceEngine, DeviceLimits, WriteStatus, WriteTicket};
pub use stream::{BatchLimit, StartAt, StreamBatch, StreamReader};

#[cfg(test)]
mod tests;
