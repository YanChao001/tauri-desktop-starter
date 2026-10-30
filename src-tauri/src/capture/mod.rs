//! 有界二进制记录与只读回放，只依赖设备公共值类型，不持有会话或设备写入能力。

mod format;
mod model;
mod replay;

pub use format::CaptureWriter;
pub use model::{
    CaptureHeader, CaptureReadStatus, CaptureSummary, MAX_CAPTURE_BYTES, MAX_CAPTURE_ITEMS,
    MAX_FRAME_BYTES,
};
pub use replay::CaptureReader;

#[cfg(test)]
mod tests;
