use crate::device::model::{
    ConnectionState, DeviceEventKind, DeviceSource, Direction, SessionId, StreamItem,
};
use crate::error::{ErrorCode, NativeError, NativeResult};

/// 完整帧的上限，包含 length、tag、body 和逐帧摘要。
pub const MAX_FRAME_BYTES: usize = 128 * 1024;
pub const MAX_CAPTURE_BYTES: u64 = 256 * 1024 * 1024;
/// 事件与缺口帧合计；footer 不计入。
pub const MAX_CAPTURE_ITEMS: u64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureHeader {
    pub session_id: SessionId,
    pub source: DeviceSource,
    /// v1 从会话序号 1 开始，已淘汰的开头必须用 Gap 表达。
    pub first_sequence: u64,
}

impl CaptureHeader {
    pub const fn new(session_id: SessionId, source: DeviceSource) -> Self {
        Self {
            session_id,
            source,
            first_sequence: 1,
        }
    }

    pub fn validate(&self) -> NativeResult<()> {
        if self.first_sequence != 1 {
            return Err(invalid("Capture v1 must start at sequence 1"));
        }
        Ok(())
    }
}

/// 始终描述已接纳的前缀；只有 reader 的 Complete 状态表示 footer 与 EOF 均已验证。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureSummary {
    pub event_count: u64,
    /// Rx 与历史 Tx 的原始 payload 字节数，不包含未知缺口。
    pub byte_count: u64,
    /// 缺口帧数量，不是丢失字节数或缺失序号数。
    pub gap_count: u64,
    /// 完整头及所有事件／缺口帧（含各自摘要）的 SHA-256，不含 footer。
    pub digest: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureReadStatus {
    Reading,
    Complete,
    /// offset 是实际遇到 EOF 的字节偏移；已验证前缀边界另见 verified_offset()。
    Incomplete {
        offset: u64,
    },
    /// 通常指未接纳的帧起点；尾后垃圾指向 footer 之后的首字节。
    Corrupt {
        offset: u64,
    },
    /// 不支持的格式或 I/O 故障不能作为可恢复的损坏降级。
    Failed {
        offset: u64,
    },
}

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct Counts {
    pub event_count: u64,
    pub byte_count: u64,
    pub gap_count: u64,
}

impl Counts {
    pub fn summary(self, digest: [u8; 32]) -> CaptureSummary {
        CaptureSummary {
            event_count: self.event_count,
            byte_count: self.byte_count,
            gap_count: self.gap_count,
            digest,
        }
    }

    pub fn ensure_item_budget(self) -> NativeResult<()> {
        let item_count = self
            .event_count
            .checked_add(self.gap_count)
            .ok_or_else(|| limit("Capture item count exceeds its representable range"))?;
        if item_count >= MAX_CAPTURE_ITEMS {
            return Err(limit("Capture exceeds its item budget"));
        }
        Ok(())
    }

    fn next(self, item: &StreamItem) -> NativeResult<Self> {
        self.ensure_item_budget()?;
        let mut next = self;
        match item {
            StreamItem::Event(event) => {
                next.event_count = next
                    .event_count
                    .checked_add(1)
                    .ok_or_else(|| limit("Capture event count exceeds its representable range"))?;
                next.byte_count = next
                    .byte_count
                    .checked_add(event.payload_bytes() as u64)
                    .ok_or_else(|| limit("Capture byte count exceeds its representable range"))?;
            }
            StreamItem::Gap(_) => {
                next.gap_count = next
                    .gap_count
                    .checked_add(1)
                    .ok_or_else(|| limit("Capture gap count exceeds its representable range"))?;
            }
        }
        Ok(next)
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct ByteOffset {
    end: u64,
    may_skip: bool,
}

impl ByteOffset {
    fn advance(&mut self, offset: u64, byte_count: usize) -> NativeResult<()> {
        if offset < self.end || (!self.may_skip && offset != self.end) {
            return Err(invalid(
                "Capture byte offset is not continuous in its direction",
            ));
        }
        self.end = offset
            .checked_add(byte_count as u64)
            .ok_or_else(|| invalid("Capture byte offset exceeds its representable range"))?;
        self.may_skip = false;
        Ok(())
    }
}

/// writer 与 reader 共用顺序约束；只复制固定大小的状态，不保留历史 payload。
#[derive(Debug, Clone, Copy)]
pub(super) struct StreamValidation {
    session_id: SessionId,
    next_sequence: Option<u64>,
    epoch: u64,
    timestamp_micros: u64,
    connection: Option<ConnectionState>,
    rx: ByteOffset,
    tx: ByteOffset,
    pub counts: Counts,
}

impl StreamValidation {
    pub fn new(header: &CaptureHeader) -> Self {
        Self {
            session_id: header.session_id,
            next_sequence: Some(header.first_sequence),
            epoch: 0,
            timestamp_micros: 0,
            connection: Some(ConnectionState::Disconnected),
            rx: ByteOffset::default(),
            tx: ByteOffset::default(),
            counts: Counts::default(),
        }
    }

    /// 先计算候选状态；调用方成功完成 I/O／校验后才提交。
    pub fn next(self, item: &StreamItem) -> NativeResult<Self> {
        item.validate()?;
        if item.session_id() != self.session_id {
            return Err(invalid("Capture item belongs to a different session"));
        }
        if self.connection == Some(ConnectionState::Closed) {
            return Err(invalid(
                "Capture cannot continue after the session is closed",
            ));
        }
        let mut next = self;
        next.counts = self.counts.next(item)?;
        match item {
            StreamItem::Gap(gap) => {
                if self.next_sequence != Some(gap.from_sequence) {
                    return Err(invalid(
                        "Capture gap does not start at the expected sequence",
                    ));
                }
                next.next_sequence = Some(gap.to_sequence);
                next.connection = None;
                // 缺口可能包含任一方向的数据；各方向独立消除不确定性。
                next.rx.may_skip = true;
                next.tx.may_skip = true;
            }
            StreamItem::Event(event) => {
                if self.next_sequence != Some(event.sequence) {
                    return Err(invalid("Capture event sequence needs an explicit gap"));
                }
                if event.epoch < self.epoch || event.timestamp_micros < self.timestamp_micros {
                    return Err(invalid("Capture epoch or observation time moved backwards"));
                }
                match &event.kind {
                    DeviceEventKind::Connection(ConnectionState::Connected) => {
                        let valid = match self.connection {
                            Some(ConnectionState::Disconnected) => {
                                self.epoch.checked_add(1) == Some(event.epoch)
                            }
                            None => event.epoch > self.epoch,
                            _ => false,
                        };
                        if !valid {
                            return Err(invalid("Capture connection does not begin a new epoch"));
                        }
                        next.connection = Some(ConnectionState::Connected);
                    }
                    DeviceEventKind::Connection(ConnectionState::Disconnected) => {
                        if self.connection.is_some()
                            && (self.connection != Some(ConnectionState::Connected)
                                || event.epoch != self.epoch)
                        {
                            return Err(invalid("Capture disconnect has no matching connection"));
                        }
                        next.connection = Some(ConnectionState::Disconnected);
                    }
                    DeviceEventKind::Connection(ConnectionState::Closed) => {
                        if self.connection.is_some() && event.epoch != self.epoch {
                            return Err(invalid("Capture close has an inconsistent epoch"));
                        }
                        next.connection = Some(ConnectionState::Closed);
                    }
                    DeviceEventKind::Bytes {
                        direction,
                        offset,
                        bytes,
                    } => {
                        if self.connection.is_some()
                            && (self.connection != Some(ConnectionState::Connected)
                                || event.epoch != self.epoch)
                        {
                            return Err(invalid(
                                "Capture bytes have no matching active connection",
                            ));
                        }
                        match direction {
                            Direction::Rx => next.rx.advance(*offset, bytes.len())?,
                            Direction::Tx => next.tx.advance(*offset, bytes.len())?,
                        }
                        next.connection = Some(ConnectionState::Connected);
                    }
                }
                next.next_sequence = event.sequence.checked_add(1);
                next.epoch = event.epoch;
                next.timestamp_micros = event.timestamp_micros;
            }
        }
        Ok(next)
    }
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn limit(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InputTooLong, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::model::{DeviceEvent, StreamGap};

    fn header() -> CaptureHeader {
        CaptureHeader::new(SessionId::from_bytes([7; 16]), DeviceSource::Virtual)
    }

    fn event(sequence: u64, epoch: u64, kind: DeviceEventKind) -> StreamItem {
        StreamItem::Event(DeviceEvent {
            session_id: header().session_id,
            sequence,
            epoch,
            timestamp_micros: sequence,
            kind,
        })
    }

    fn connection(sequence: u64, epoch: u64, state: ConnectionState) -> StreamItem {
        event(sequence, epoch, DeviceEventKind::Connection(state))
    }

    fn bytes(sequence: u64, epoch: u64, direction: Direction, offset: u64) -> StreamItem {
        event(
            sequence,
            epoch,
            DeviceEventKind::Bytes {
                direction,
                offset,
                bytes: vec![0, 0xff],
            },
        )
    }

    fn gap(from_sequence: u64, to_sequence: u64) -> StreamItem {
        StreamItem::Gap(StreamGap {
            session_id: header().session_id,
            from_sequence,
            to_sequence,
        })
    }

    #[test]
    fn known_connections_require_matching_epochs_and_session_wide_direction_offsets() {
        let initial = StreamValidation::new(&header());
        assert!(initial.next(&bytes(1, 1, Direction::Rx, 0)).is_err());
        assert!(
            initial
                .next(&connection(1, 1, ConnectionState::Disconnected))
                .is_err()
        );
        assert!(
            initial
                .next(&connection(1, 2, ConnectionState::Connected))
                .is_err()
        );

        let active = initial
            .next(&connection(1, 1, ConnectionState::Connected))
            .unwrap()
            .next(&bytes(2, 1, Direction::Rx, 0))
            .unwrap();
        for invalid in [
            connection(3, 1, ConnectionState::Connected),
            connection(3, 2, ConnectionState::Connected),
            connection(3, 2, ConnectionState::Disconnected),
            connection(3, 2, ConnectionState::Closed),
            bytes(3, 2, Direction::Rx, 2),
            bytes(3, 1, Direction::Rx, 0),
            bytes(3, 1, Direction::Rx, 3),
            bytes(4, 1, Direction::Rx, 2),
            gap(4, 6),
        ] {
            assert_eq!(
                active.next(&invalid).unwrap_err().code,
                ErrorCode::InvalidArgument
            );
        }
        let disconnected = active
            .next(&bytes(3, 1, Direction::Tx, 0))
            .unwrap()
            .next(&connection(4, 1, ConnectionState::Disconnected))
            .unwrap();
        assert!(disconnected.next(&bytes(5, 1, Direction::Rx, 2)).is_err());
        assert!(
            disconnected
                .next(&connection(5, 3, ConnectionState::Connected))
                .is_err()
        );
        let reconnected = disconnected
            .next(&connection(5, 2, ConnectionState::Connected))
            .unwrap();
        assert!(reconnected.next(&bytes(6, 2, Direction::Rx, 0)).is_err());
        let continued = reconnected
            .next(&bytes(6, 2, Direction::Rx, 2))
            .unwrap()
            .next(&bytes(7, 2, Direction::Tx, 2))
            .unwrap();
        assert_eq!(continued.counts.event_count, 7);
        assert_eq!(continued.counts.byte_count, 8);
    }

    #[test]
    fn gaps_allow_unknown_connections_and_independent_forward_offsets_not_regressions() {
        let prefix = StreamValidation::new(&header())
            .next(&connection(1, 1, ConnectionState::Connected))
            .unwrap()
            .next(&bytes(2, 1, Direction::Rx, 0))
            .unwrap()
            .next(&gap(3, 6))
            .unwrap();
        assert!(prefix.next(&bytes(6, 1, Direction::Rx, 1)).is_err());
        assert!(prefix.next(&bytes(6, 0, Direction::Rx, 2)).is_err());
        assert!(
            prefix
                .next(&connection(6, 1, ConnectionState::Connected))
                .is_err()
        );
        let after_rx = prefix.next(&bytes(6, 3, Direction::Rx, 10)).unwrap();
        assert!(after_rx.next(&bytes(7, 3, Direction::Rx, 13)).is_err());
        assert!(after_rx.next(&bytes(7, 4, Direction::Tx, 20)).is_err());
        let mut backwards_time = bytes(7, 3, Direction::Tx, 20);
        if let StreamItem::Event(event) = &mut backwards_time {
            event.timestamp_micros = 5;
        }
        assert!(after_rx.next(&backwards_time).is_err());
        let continued = after_rx
            .next(&bytes(7, 3, Direction::Tx, 20))
            .unwrap()
            .next(&bytes(8, 3, Direction::Rx, 12))
            .unwrap();
        assert_eq!(continued.counts.event_count, 5);
        assert_eq!(continued.counts.byte_count, 8);
        assert_eq!(continued.counts.gap_count, 1);

        let disconnected = prefix
            .next(&connection(6, 3, ConnectionState::Disconnected))
            .unwrap();
        assert!(
            disconnected
                .next(&connection(7, 4, ConnectionState::Connected))
                .is_ok()
        );
    }

    #[test]
    fn session_mismatch_close_and_sequence_exhaustion_do_not_become_new_streams() {
        let initial = StreamValidation::new(&header());
        let mut foreign = connection(1, 1, ConnectionState::Connected);
        if let StreamItem::Event(event) = &mut foreign {
            event.session_id = SessionId::from_bytes([8; 16]);
        }
        assert!(initial.next(&foreign).is_err());
        let closed = initial
            .next(&connection(1, 0, ConnectionState::Closed))
            .unwrap();
        assert!(closed.next(&gap(2, 5)).is_err());
        assert!(
            closed
                .next(&connection(2, 1, ConnectionState::Connected))
                .is_err()
        );

        let exhausted = initial
            .next(&gap(1, u64::MAX))
            .unwrap()
            .next(&bytes(u64::MAX, 1, Direction::Rx, 0))
            .unwrap();
        assert!(exhausted.next(&bytes(1, 1, Direction::Rx, 2)).is_err());
    }
}
