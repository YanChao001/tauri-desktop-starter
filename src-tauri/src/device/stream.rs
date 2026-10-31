use std::{collections::VecDeque, fmt, sync::Arc};

use crate::error::{ErrorCode, NativeError, NativeResult};

use super::{
    model::{DeviceEvent, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, StreamGap, StreamItem},
    session::Session,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartAt {
    /// 从会话序号 1 开始；已淘汰的前缀通过 Gap 报告。
    Beginning,
    /// 从订阅时取得的尾游标开始，跳过已有历史。
    Latest,
}

/// 字节额度只统计事件 payload；Gap 和连接事件仍占用一项额度。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchLimit {
    pub max_items: usize,
    pub max_bytes: usize,
}

impl Default for BatchLimit {
    fn default() -> Self {
        Self {
            max_items: MAX_BATCH_EVENTS,
            max_bytes: MAX_BATCH_BYTES,
        }
    }
}

impl BatchLimit {
    pub fn validate(&self) -> NativeResult<()> {
        if self.max_items == 0
            || self.max_items > MAX_BATCH_EVENTS
            || self.max_bytes == 0
            || self.max_bytes > MAX_BATCH_BYTES
        {
            return Err(NativeError::new(
                ErrorCode::InvalidArgument,
                "Device batch limits must be positive and within the batch capacity",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamBatch {
    pub items: Vec<StreamItem>,
    /// 会话已关闭且本游标已排空；暂时没有新事件不等于 EOF。
    pub closed: bool,
}

/// 只拥有读取游标；丢弃读取者不会断连或关闭会话。
pub struct StreamReader {
    session: Arc<Session>,
    next_sequence: u64,
}

impl fmt::Debug for StreamReader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StreamReader")
            .field("session_id", &self.session.id)
            .field("next_sequence", &self.next_sequence)
            .finish_non_exhaustive()
    }
}

impl StreamReader {
    pub(super) fn new(session: Arc<Session>, start: StartAt) -> NativeResult<Self> {
        let next_sequence = {
            let state = session.lock()?;
            match start {
                StartAt::Beginning => 1,
                StartAt::Latest => state.next_sequence,
            }
        };
        Ok(Self {
            session,
            next_sequence,
        })
    }

    /// 不拆分事件。若下一帧连完整的字节额度都无法容纳，返回错误且整个游标不推进。
    /// 若只是本批剩余额度不足，则保留下一帧供后续读取。
    pub fn read_batch(&mut self, limit: BatchLimit) -> NativeResult<StreamBatch> {
        limit.validate()?;
        let state = self.session.lock()?;
        let retained = state
            .ring
            .events
            .front()
            .map_or(state.next_sequence, |event| event.sequence);
        let mut next_sequence = self.next_sequence;
        let mut items = Vec::new();
        if next_sequence < retained {
            items.push(StreamItem::Gap(StreamGap {
                session_id: self.session.id,
                from_sequence: next_sequence,
                to_sequence: retained,
            }));
            next_sequence = retained;
        }

        // 保留历史是连续后缀，直接定位游标，不为每次小批读取扫描整个 ring。
        let index = usize::try_from(next_sequence - retained).map_err(|_| {
            NativeError::new(ErrorCode::Internal, "Device stream cursor is out of range")
        })?;
        let mut payload_bytes = 0;
        for event in state.ring.events.range(index..) {
            if items.len() == limit.max_items {
                break;
            }
            let bytes = event.payload_bytes();
            if bytes > limit.max_bytes {
                return Err(NativeError::new(
                    ErrorCode::InputTooLong,
                    "Device event cannot fit in the requested batch byte capacity",
                ));
            }
            if bytes > limit.max_bytes - payload_bytes {
                break;
            }
            items.push(StreamItem::Event(event.clone()));
            payload_bytes += bytes;
            // 生产端保留可表示的下一序号，因此历史事件不会使用 u64::MAX。
            next_sequence = event.sequence + 1;
        }
        let closed = state.is_closed() && next_sequence == state.next_sequence;
        self.next_sequence = next_sequence;
        Ok(StreamBatch { items, closed })
    }
}

pub(super) struct EventRing {
    events: VecDeque<DeviceEvent>,
    payload_bytes: usize,
    max_events: usize,
    max_bytes: usize,
}

impl EventRing {
    pub(super) fn new(max_events: usize, max_bytes: usize) -> Self {
        Self {
            events: VecDeque::new(),
            payload_bytes: 0,
            max_events,
            max_bytes,
        }
    }

    pub(super) fn check_payload(&self, bytes: usize) -> NativeResult<()> {
        if bytes > self.max_bytes {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Device event cannot fit in the session history byte capacity",
            ));
        }
        Ok(())
    }

    /// 调用方先验证单帧可容纳；提交阶段只淘汰连续前缀，不再发生可恢复失败。
    pub(super) fn append(&mut self, event: DeviceEvent) {
        let bytes = event.payload_bytes();
        debug_assert!(self.max_events > 0 && bytes <= self.max_bytes);
        while let Some(oldest) = self.events.front() {
            if self.events.len() < self.max_events && self.payload_bytes <= self.max_bytes - bytes {
                break;
            }
            self.payload_bytes -= oldest.payload_bytes();
            self.events.pop_front();
        }
        self.payload_bytes += bytes;
        self.events.push_back(event);
    }
}
