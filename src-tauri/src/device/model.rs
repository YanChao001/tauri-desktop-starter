//! 设备会话、有限字节流与记录模块共享的值类型，不包含窗口、文件或传输实现。
use std::fmt;

use crate::error::{ErrorCode, NativeError, NativeResult};

pub const MAX_EVENT_BYTES: usize = 64 * 1024;
pub const MAX_BATCH_EVENTS: usize = 256;
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SessionId([u8; 16]);

impl SessionId {
    pub fn random() -> NativeResult<Self> {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(|error| {
            NativeError::operation(
                ErrorCode::Internal,
                "Cannot allocate a device session ID",
                error,
            )
        })?;
        Ok(Self(bytes))
    }

    pub const fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 16] {
        &self.0
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(formatter, "{byte:02x}")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceSource {
    Virtual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Rx,
    Tx,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Connected,
    Disconnected,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceEventKind {
    Connection(ConnectionState),
    Bytes {
        direction: Direction,
        offset: u64,
        bytes: Vec<u8>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceEvent {
    pub session_id: SessionId,
    pub sequence: u64,
    pub epoch: u64,
    /// 会话开始后的主机观察时间，不是线路上逐字节到达时间。
    pub timestamp_micros: u64,
    pub kind: DeviceEventKind,
}

impl DeviceEvent {
    pub fn validate(&self) -> NativeResult<()> {
        if self.sequence == 0 {
            return Err(invalid("Device event sequence must be positive"));
        }
        match &self.kind {
            DeviceEventKind::Connection(ConnectionState::Closed) => {}
            DeviceEventKind::Connection(_) if self.epoch == 0 => {
                return Err(invalid("Connection epoch must be positive"));
            }
            DeviceEventKind::Bytes { offset, bytes, .. } => {
                if self.epoch == 0 || bytes.is_empty() {
                    return Err(invalid(
                        "Device bytes need an active epoch and nonempty payload",
                    ));
                }
                if bytes.len() > MAX_EVENT_BYTES {
                    return Err(NativeError::new(
                        ErrorCode::InputTooLong,
                        "Device byte event exceeds its payload budget",
                    ));
                }
                offset
                    .checked_add(bytes.len() as u64)
                    .ok_or_else(|| invalid("Device byte offset exceeds its representable range"))?;
            }
            DeviceEventKind::Connection(_) => {}
        }
        Ok(())
    }

    pub fn payload_bytes(&self) -> usize {
        match &self.kind {
            DeviceEventKind::Bytes { bytes, .. } => bytes.len(),
            DeviceEventKind::Connection(_) => 0,
        }
    }
}

/// 已被会话历史淘汰的半开序号区间；不宣称知道物理设备丢了多少字节。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamGap {
    pub session_id: SessionId,
    pub from_sequence: u64,
    pub to_sequence: u64,
}

impl StreamGap {
    pub fn validate(&self) -> NativeResult<()> {
        if self.from_sequence == 0 || self.to_sequence <= self.from_sequence {
            return Err(invalid(
                "Device stream gap requires a nonempty sequence interval",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamItem {
    Event(DeviceEvent),
    Gap(StreamGap),
}

impl StreamItem {
    pub fn session_id(&self) -> SessionId {
        match self {
            Self::Event(event) => event.session_id,
            Self::Gap(gap) => gap.session_id,
        }
    }

    pub fn validate(&self) -> NativeResult<()> {
        match self {
            Self::Event(event) => event.validate(),
            Self::Gap(gap) => gap.validate(),
        }
    }
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_events_keep_binary_payloads_and_validate_offsets_before_use() {
        let mut event = DeviceEvent {
            session_id: SessionId::from_bytes([3; 16]),
            sequence: 1,
            epoch: 1,
            timestamp_micros: 0,
            kind: DeviceEventKind::Bytes {
                direction: Direction::Rx,
                offset: 0,
                bytes: vec![0, 0xff, 0xc3, 0x28],
            },
        };
        assert!(event.validate().is_ok());
        assert_eq!(event.payload_bytes(), 4);
        if let DeviceEventKind::Bytes { offset, .. } = &mut event.kind {
            *offset = u64::MAX;
        }
        assert_eq!(
            event.validate().unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        event.sequence = 0;
        assert!(event.validate().is_err());
    }

    #[test]
    fn closed_unopened_sessions_and_explicit_sequence_gaps_are_representable() {
        let id = SessionId::from_bytes([0; 16]);
        let closed = DeviceEvent {
            session_id: id,
            sequence: 1,
            epoch: 0,
            timestamp_micros: 0,
            kind: DeviceEventKind::Connection(ConnectionState::Closed),
        };
        assert!(closed.validate().is_ok());
        assert_eq!(id.to_string(), "00000000000000000000000000000000");
        assert!(
            StreamGap {
                session_id: id,
                from_sequence: 2,
                to_sequence: 5
            }
            .validate()
            .is_ok()
        );
        assert!(
            StreamGap {
                session_id: id,
                from_sequence: 5,
                to_sequence: 5
            }
            .validate()
            .is_err()
        );
    }
}
