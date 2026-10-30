use std::{
    collections::HashMap,
    fmt,
    sync::{Arc, Mutex, MutexGuard, OnceLock, RwLock, RwLockReadGuard, Weak},
    time::Instant,
};

use crate::error::{ErrorCode, NativeError, NativeResult};

use super::{
    model::{ConnectionState, DeviceEvent, DeviceEventKind, Direction, MAX_EVENT_BYTES, SessionId},
    stream::{EventRing, StartAt, StreamReader},
};

/// 字节额度只统计原始 payload；事件／队列条数另行限制元数据占用。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeviceLimits {
    pub max_sessions: usize,
    pub max_ring_events: usize,
    pub max_ring_bytes: usize,
    pub max_pending_writes: usize,
    pub max_pending_write_bytes: usize,
}

impl Default for DeviceLimits {
    fn default() -> Self {
        Self {
            max_sessions: 32,
            max_ring_events: 4096,
            max_ring_bytes: 4 * 1024 * 1024,
            max_pending_writes: 128,
            max_pending_write_bytes: 1024 * 1024,
        }
    }
}

impl DeviceLimits {
    pub fn validate(&self) -> NativeResult<()> {
        if self.max_sessions == 0
            || self.max_ring_events == 0
            || self.max_ring_bytes == 0
            || self.max_pending_writes == 0
            || self.max_pending_write_bytes == 0
        {
            return Err(invalid("Device capacities must be positive"));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct DeviceEngine {
    inner: Arc<EngineState>,
}

struct EngineState {
    limits: DeviceLimits,
    /// 普通操作共享屏障，只在 shutdown 时独占；注册表锁不等待会话锁。
    shutdown: RwLock<bool>,
    sessions: Mutex<HashMap<SessionId, Arc<Session>>>,
}

impl Drop for EngineState {
    fn drop(&mut self) {
        // 最后一个引擎退出后没有执行者；只读历史不能让发送 ticket 永久 Pending。
        let sessions = self
            .sessions
            .get_mut()
            .unwrap_or_else(|error| error.into_inner());
        for session in sessions.values() {
            let mut state = session
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            state.pending.clear();
            state.pending_bytes = 0;
        }
    }
}

impl fmt::Debug for DeviceEngine {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceEngine")
            .field("limits", &self.inner.limits)
            .finish_non_exhaustive()
    }
}

/// 只能由 connect 创建，绑定同一引擎、会话和连接代次；不拥有会话生命周期。
#[derive(Debug, Clone)]
pub struct ConnectionToken {
    session: Weak<Session>,
    session_id: SessionId,
    epoch: u64,
}

impl ConnectionToken {
    pub fn session_id(&self) -> SessionId {
        self.session_id
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteStatus {
    Pending,
    /// 仅表示虚拟 TX 与回显 RX 已提交到会话历史，不是设备 ACK。
    VirtualCompleted,
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct WriteTicket {
    outcome: Arc<OnceLock<WriteStatus>>,
}

impl WriteTicket {
    /// 非阻塞快照；终态不会因重连、读取或丢弃 ticket 再次变化。
    pub fn try_result(&self) -> WriteStatus {
        self.outcome.get().copied().unwrap_or(WriteStatus::Pending)
    }
}

struct PendingWrite {
    bytes: Vec<u8>,
    outcome: Arc<OnceLock<WriteStatus>>,
}

impl Drop for PendingWrite {
    fn drop(&mut self) {
        // 显式关闭之外，最后一个引擎释放也不能让外部 ticket 永久停在 Pending。
        self.outcome.get_or_init(|| WriteStatus::Cancelled);
    }
}

pub(super) struct Session {
    pub(super) id: SessionId,
    started: Instant,
    state: Mutex<SessionState>,
}

pub(super) struct SessionState {
    pub(super) ring: EventRing,
    pub(super) next_sequence: u64,
    epoch: u64,
    phase: ConnectionState,
    rx_offset: u64,
    tx_offset: u64,
    pending: std::collections::VecDeque<PendingWrite>,
    pending_bytes: usize,
}

struct PreparedConnection {
    event: DeviceEvent,
    next_sequence: u64,
    phase: ConnectionState,
}

impl DeviceEngine {
    pub fn new(limits: DeviceLimits) -> NativeResult<Self> {
        limits.validate()?;
        Ok(Self {
            inner: Arc::new(EngineState {
                limits,
                shutdown: RwLock::new(false),
                sessions: Mutex::new(HashMap::new()),
            }),
        })
    }

    /// 容量包含仍被读取者保留的已关闭会话。无读取者／在途操作的关闭会话在创建时回收。
    pub fn create_virtual(&self) -> NativeResult<SessionId> {
        let _running = self.running()?;
        let id = SessionId::random()?;
        let mut sessions = lock(&self.inner.sessions)?;
        sessions.retain(|_, session| {
            if Arc::strong_count(session) != 1 {
                return true;
            }
            session
                .state
                .try_lock()
                .map_or(true, |state| !state.is_closed())
        });
        if sessions.len() >= self.inner.limits.max_sessions {
            return Err(busy("Device session capacity is full"));
        }
        if sessions.contains_key(&id) {
            return Err(busy("Device session ID collided; retry creation"));
        }
        sessions.insert(
            id,
            Arc::new(Session {
                id,
                started: Instant::now(),
                state: Mutex::new(SessionState {
                    ring: EventRing::new(
                        self.inner.limits.max_ring_events,
                        self.inner.limits.max_ring_bytes,
                    ),
                    next_sequence: 1,
                    epoch: 0,
                    phase: ConnectionState::Disconnected,
                    rx_offset: 0,
                    tx_offset: 0,
                    pending: std::collections::VecDeque::new(),
                    pending_bytes: 0,
                }),
            }),
        );
        Ok(id)
    }

    pub fn connect(&self, id: &SessionId) -> NativeResult<ConnectionToken> {
        let _running = self.running()?;
        let session = self.session(id)?;
        let mut state = session.lock()?;
        if state.phase != ConnectionState::Disconnected {
            return Err(conflict("Device session is connected or closed"));
        }
        let epoch = state
            .epoch
            .checked_add(1)
            .ok_or_else(|| exhausted("Device connection epoch is exhausted"))?;
        let prepared = state.prepare_connection(&session, ConnectionState::Connected, epoch)?;
        state.commit_connection(prepared);
        Ok(ConnectionToken {
            session: Arc::downgrade(&session),
            session_id: *id,
            epoch,
        })
    }

    /// 订阅不建立连接，丢弃游标也不关闭会话；shutdown 后仍可读取保留历史。
    pub fn subscribe(&self, id: &SessionId, start: StartAt) -> NativeResult<StreamReader> {
        StreamReader::new(self.session(id)?, start)
    }

    pub fn push_virtual_rx(&self, token: &ConnectionToken, bytes: &[u8]) -> NativeResult<()> {
        validate_bytes(bytes)?;
        let _running = self.running()?;
        let session = self.token_session(token)?;
        let mut state = session.lock()?;
        state.require_token(token)?;
        state.ring.check_payload(bytes.len())?;
        let next_sequence = state
            .next_sequence
            .checked_add(1)
            .ok_or_else(|| exhausted("Device event sequence is exhausted"))?;
        let next_offset = advance_offset(state.rx_offset, bytes.len())?;
        let timestamp_micros = session.timestamp()?;
        let event = DeviceEvent {
            session_id: session.id,
            sequence: state.next_sequence,
            epoch: state.epoch,
            timestamp_micros,
            kind: DeviceEventKind::Bytes {
                direction: Direction::Rx,
                offset: state.rx_offset,
                bytes: bytes.to_vec(),
            },
        };
        state.ring.append(event);
        state.next_sequence = next_sequence;
        state.rx_offset = next_offset;
        Ok(())
    }

    /// 仅入队，不产生字节事件；执行在 step_virtual 中统一预检并结算。
    pub fn enqueue_write(
        &self,
        token: &ConnectionToken,
        bytes: &[u8],
    ) -> NativeResult<WriteTicket> {
        validate_bytes(bytes)?;
        let _running = self.running()?;
        let session = self.token_session(token)?;
        let mut state = session.lock()?;
        state.require_token(token)?;
        if bytes.len() > self.inner.limits.max_pending_write_bytes {
            return Err(NativeError::new(
                ErrorCode::InputTooLong,
                "Device write cannot fit in the pending byte capacity",
            ));
        }
        let pending_bytes = state
            .pending_bytes
            .checked_add(bytes.len())
            .filter(|total| *total <= self.inner.limits.max_pending_write_bytes)
            .ok_or_else(|| busy("Device pending byte capacity is full"))?;
        if state.pending.len() >= self.inner.limits.max_pending_writes {
            return Err(busy("Device pending write capacity is full"));
        }
        let outcome = Arc::new(OnceLock::new());
        let ticket = WriteTicket {
            outcome: Arc::clone(&outcome),
        };
        state.pending.push_back(PendingWrite {
            bytes: bytes.to_vec(),
            outcome,
        });
        state.pending_bytes = pending_bytes;
        Ok(ticket)
    }

    /// 同步执行最多 maximum 条 FIFO 写入，每条产生 TX 和回显 RX；不启动后台线程。
    /// 本次选中写入的单帧额度、全部序号和偏移先预检，失败保留整个队列。
    pub fn step_virtual(&self, token: &ConnectionToken, maximum: usize) -> NativeResult<usize> {
        let _running = self.running()?;
        let session = self.token_session(token)?;
        let mut state = session.lock()?;
        state.require_token(token)?;
        let count = maximum.min(state.pending.len());
        if count == 0 {
            return Ok(0);
        }

        let event_count = u64::try_from(count)
            .ok()
            .and_then(|count| count.checked_mul(2))
            .ok_or_else(|| exhausted("Device event count is exhausted"))?;
        let next_sequence = state
            .next_sequence
            .checked_add(event_count)
            .ok_or_else(|| exhausted("Device event sequence is exhausted"))?;
        let mut drained_bytes = 0_usize;
        for write in state.pending.iter().take(count) {
            state.ring.check_payload(write.bytes.len())?;
            drained_bytes = drained_bytes
                .checked_add(write.bytes.len())
                .ok_or_else(|| exhausted("Device pending byte count is exhausted"))?;
        }
        let next_tx_offset = advance_offset(state.tx_offset, drained_bytes)?;
        let next_rx_offset = advance_offset(state.rx_offset, drained_bytes)?;
        let timestamp_micros = session.timestamp()?;

        let epoch = state.epoch;
        let mut sequence = state.next_sequence;
        let mut tx_offset = state.tx_offset;
        let mut rx_offset = state.rx_offset;
        let SessionState { ring, pending, .. } = &mut *state;
        for mut write in pending.drain(..count) {
            let bytes = write.bytes.len() as u64;
            ring.append(DeviceEvent {
                session_id: session.id,
                sequence,
                epoch,
                timestamp_micros,
                kind: DeviceEventKind::Bytes {
                    direction: Direction::Tx,
                    offset: tx_offset,
                    bytes: write.bytes.clone(),
                },
            });
            ring.append(DeviceEvent {
                session_id: session.id,
                sequence: sequence + 1,
                epoch,
                timestamp_micros,
                kind: DeviceEventKind::Bytes {
                    direction: Direction::Rx,
                    offset: rx_offset,
                    bytes: std::mem::take(&mut write.bytes),
                },
            });
            sequence += 2;
            tx_offset += bytes;
            rx_offset += bytes;
            write.outcome.get_or_init(|| WriteStatus::VirtualCompleted);
        }
        state.next_sequence = next_sequence;
        state.tx_offset = next_tx_offset;
        state.rx_offset = next_rx_offset;
        state.pending_bytes -= drained_bytes;
        Ok(count)
    }

    /// 控制路径不占发送队列容量；未执行写入结算为 Cancelled，重连不会重放。
    pub fn disconnect(&self, token: &ConnectionToken) -> NativeResult<()> {
        let _running = self.running()?;
        let session = self.token_session(token)?;
        let mut state = session.lock()?;
        state.require_token(token)?;
        let prepared =
            state.prepare_connection(&session, ConnectionState::Disconnected, state.epoch)?;
        state.commit_connection(prepared);
        Ok(())
    }

    /// 关闭为幂等终态；已有读取者保留同一历史，直到排空或显式丢弃游标。
    pub fn close(&self, id: &SessionId) -> NativeResult<()> {
        let _barrier = self
            .inner
            .shutdown
            .read()
            .map_err(|_| internal("Device shutdown barrier is poisoned"))?;
        let session = self.session(id)?;
        let mut state = session.lock()?;
        if !state.is_closed() {
            let prepared =
                state.prepare_connection(&session, ConnectionState::Closed, state.epoch)?;
            state.commit_connection(prepared);
        }
        Ok(())
    }

    /// 全局屏障只用于停机：全部关闭事件先预检，失败时不部分关闭或结算 ticket。
    pub fn shutdown(&self) -> NativeResult<()> {
        let mut shutdown = self
            .inner
            .shutdown
            .write()
            .map_err(|_| internal("Device shutdown barrier is poisoned"))?;
        if *shutdown {
            return Ok(());
        }
        let sessions: Vec<_> = lock(&self.inner.sessions)?.values().cloned().collect();
        let mut states = sessions
            .iter()
            .map(|session| session.lock())
            .collect::<NativeResult<Vec<_>>>()?;
        let prepared = sessions
            .iter()
            .zip(&states)
            .map(|(session, state)| {
                if state.is_closed() {
                    Ok(None)
                } else {
                    state
                        .prepare_connection(session, ConnectionState::Closed, state.epoch)
                        .map(Some)
                }
            })
            .collect::<NativeResult<Vec<_>>>()?;
        for (state, prepared) in states.iter_mut().zip(prepared) {
            if let Some(prepared) = prepared {
                state.commit_connection(prepared);
            }
        }
        *shutdown = true;
        Ok(())
    }

    fn running(&self) -> NativeResult<RwLockReadGuard<'_, bool>> {
        let shutdown = self
            .inner
            .shutdown
            .read()
            .map_err(|_| internal("Device shutdown barrier is poisoned"))?;
        if *shutdown {
            return Err(conflict("Device engine is shut down"));
        }
        Ok(shutdown)
    }

    fn session(&self, id: &SessionId) -> NativeResult<Arc<Session>> {
        lock(&self.inner.sessions)?
            .get(id)
            .cloned()
            .ok_or_else(|| NativeError::new(ErrorCode::NotFound, "Device session does not exist"))
    }

    fn token_session(&self, token: &ConnectionToken) -> NativeResult<Arc<Session>> {
        let session = self.session(&token.session_id)?;
        // 即使 ID 被再次分配，旧 Weak 也不能授权操作另一份会话。
        if !Weak::ptr_eq(&token.session, &Arc::downgrade(&session)) {
            return Err(invalid(
                "Device connection token belongs to another session",
            ));
        }
        Ok(session)
    }
}

impl Session {
    pub(super) fn lock(&self) -> NativeResult<MutexGuard<'_, SessionState>> {
        lock(&self.state)
    }

    fn timestamp(&self) -> NativeResult<u64> {
        u64::try_from(self.started.elapsed().as_micros())
            .map_err(|_| exhausted("Device monotonic timestamp is exhausted"))
    }
}

impl SessionState {
    pub(super) fn is_closed(&self) -> bool {
        self.phase == ConnectionState::Closed
    }

    fn require_token(&self, token: &ConnectionToken) -> NativeResult<()> {
        if self.phase != ConnectionState::Connected || self.epoch != token.epoch {
            return Err(conflict("Device connection token is stale or disconnected"));
        }
        Ok(())
    }

    fn prepare_connection(
        &self,
        session: &Session,
        phase: ConnectionState,
        epoch: u64,
    ) -> NativeResult<PreparedConnection> {
        let next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or_else(|| exhausted("Device event sequence is exhausted"))?;
        Ok(PreparedConnection {
            event: DeviceEvent {
                session_id: session.id,
                sequence: self.next_sequence,
                epoch,
                timestamp_micros: session.timestamp()?,
                kind: DeviceEventKind::Connection(phase),
            },
            next_sequence,
            phase,
        })
    }

    fn commit_connection(&mut self, prepared: PreparedConnection) {
        self.epoch = prepared.event.epoch;
        self.phase = prepared.phase;
        self.next_sequence = prepared.next_sequence;
        self.ring.append(prepared.event);
        if self.phase != ConnectionState::Connected {
            for write in self.pending.drain(..) {
                write.outcome.get_or_init(|| WriteStatus::Cancelled);
            }
            self.pending_bytes = 0;
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> NativeResult<MutexGuard<'_, T>> {
    mutex
        .lock()
        .map_err(|_| internal("Device state lock is poisoned"))
}

fn validate_bytes(bytes: &[u8]) -> NativeResult<()> {
    if bytes.is_empty() {
        return Err(invalid("Device bytes must not be empty"));
    }
    if bytes.len() > MAX_EVENT_BYTES {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            "Device bytes exceed the single-event payload budget",
        ));
    }
    Ok(())
}

fn advance_offset(offset: u64, bytes: usize) -> NativeResult<u64> {
    offset
        .checked_add(bytes as u64)
        .ok_or_else(|| exhausted("Device byte offset is exhausted"))
}

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn busy(message: &str) -> NativeError {
    NativeError::new(ErrorCode::NativeBusy, message)
}

fn conflict(message: &str) -> NativeError {
    NativeError::new(ErrorCode::Conflict, message)
}

fn exhausted(message: &str) -> NativeError {
    NativeError::new(ErrorCode::Conflict, message)
}

fn internal(message: &str) -> NativeError {
    NativeError::new(ErrorCode::Internal, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exhausted_epoch_sequence_and_offsets_do_not_change_history_or_queue() {
        let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
        let id = engine.create_virtual().unwrap();
        let session = engine.session(&id).unwrap();
        session.lock().unwrap().epoch = u64::MAX;
        assert_eq!(engine.connect(&id).unwrap_err().code, ErrorCode::Conflict);
        {
            let mut state = session.lock().unwrap();
            assert_eq!(state.next_sequence, 1);
            assert_eq!(state.phase, ConnectionState::Disconnected);
            state.epoch = 0;
        }
        let token = engine.connect(&id).unwrap();
        let ticket = engine.enqueue_write(&token, b"two").unwrap();
        let mut reader = engine.subscribe(&id, StartAt::Latest).unwrap();
        session.lock().unwrap().rx_offset = u64::MAX - 1;
        assert_eq!(
            engine.push_virtual_rx(&token, b"two").unwrap_err().code,
            ErrorCode::Conflict
        );
        assert_eq!(
            engine.step_virtual(&token, 1).unwrap_err().code,
            ErrorCode::Conflict
        );
        assert_eq!(ticket.try_result(), WriteStatus::Pending);
        {
            let mut state = session.lock().unwrap();
            assert_eq!(state.tx_offset, 0);
            assert_eq!(state.pending.len(), 1);
            assert_eq!(state.pending_bytes, 3);
            assert_eq!(state.next_sequence, 2);
            state.rx_offset = 0;
            state.next_sequence = u64::MAX - 1;
        }
        assert!(engine.step_virtual(&token, 1).is_err());
        assert_eq!(ticket.try_result(), WriteStatus::Pending);
        session.lock().unwrap().next_sequence = u64::MAX;
        assert!(engine.push_virtual_rx(&token, b"x").is_err());
        assert!(engine.disconnect(&token).is_err());
        assert!(engine.close(&id).is_err());
        {
            let mut state = session.lock().unwrap();
            assert_eq!(state.phase, ConnectionState::Connected);
            assert_eq!(state.pending.len(), 1);
            state.next_sequence = 2;
        }
        assert!(
            reader
                .read_batch(super::super::BatchLimit::default())
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(engine.step_virtual(&token, 1).unwrap(), 1);
        assert_eq!(ticket.try_result(), WriteStatus::VirtualCompleted);
    }

    #[test]
    fn a_later_write_overflow_does_not_partially_complete_the_selected_batch() {
        let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
        let id = engine.create_virtual().unwrap();
        let token = engine.connect(&id).unwrap();
        let session = engine.session(&id).unwrap();
        let first = engine.enqueue_write(&token, b"abc").unwrap();
        let second = engine.enqueue_write(&token, b"de").unwrap();
        let mut reader = engine.subscribe(&id, StartAt::Latest).unwrap();
        for (rx_offset, tx_offset, sequence) in [
            (u64::MAX - 4, 0, 2),
            (0, u64::MAX - 4, 2),
            (0, 0, u64::MAX - 3),
        ] {
            {
                let mut state = session.lock().unwrap();
                state.rx_offset = rx_offset;
                state.tx_offset = tx_offset;
                state.next_sequence = sequence;
            }
            assert_eq!(
                engine.step_virtual(&token, 2).unwrap_err().code,
                ErrorCode::Conflict
            );
            assert_eq!(first.try_result(), WriteStatus::Pending);
            assert_eq!(second.try_result(), WriteStatus::Pending);
            let state = session.lock().unwrap();
            assert_eq!(state.rx_offset, rx_offset);
            assert_eq!(state.tx_offset, tx_offset);
            assert_eq!(state.next_sequence, sequence);
            assert_eq!(state.pending.len(), 2);
            assert_eq!(state.pending_bytes, 5);
        }
        {
            let mut state = session.lock().unwrap();
            state.rx_offset = 0;
            state.tx_offset = 0;
            state.next_sequence = 2;
        }
        assert!(
            reader
                .read_batch(super::super::BatchLimit::default())
                .unwrap()
                .items
                .is_empty()
        );
        assert_eq!(engine.step_virtual(&token, 2).unwrap(), 2);
        assert_eq!(first.try_result(), WriteStatus::VirtualCompleted);
        assert_eq!(second.try_result(), WriteStatus::VirtualCompleted);
        let batch = reader
            .read_batch(super::super::BatchLimit::default())
            .unwrap();
        assert_eq!(batch.items.len(), 4);
    }

    #[test]
    fn pending_byte_count_overflow_rejects_enqueue_without_mutating_the_queue() {
        let engine = DeviceEngine::new(DeviceLimits {
            max_pending_write_bytes: usize::MAX,
            ..DeviceLimits::default()
        })
        .unwrap();
        let id = engine.create_virtual().unwrap();
        let token = engine.connect(&id).unwrap();
        let session = engine.session(&id).unwrap();
        session.lock().unwrap().pending_bytes = usize::MAX;
        assert_eq!(
            engine.enqueue_write(&token, b"x").unwrap_err().code,
            ErrorCode::NativeBusy
        );
        let mut state = session.lock().unwrap();
        assert!(state.pending.is_empty());
        assert_eq!(state.pending_bytes, usize::MAX);
        assert_eq!(state.next_sequence, 2);
        state.pending_bytes = 0;
    }

    #[test]
    fn a_reused_session_id_cannot_retarget_an_old_weak_connection_token() {
        let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
        let id = engine.create_virtual().unwrap();
        let stale = engine.connect(&id).unwrap();
        engine.close(&id).unwrap();
        let replacement_id = engine.create_virtual().unwrap();
        assert!(stale.session.upgrade().is_none());
        let replacement = lock(&engine.inner.sessions)
            .unwrap()
            .remove(&replacement_id)
            .unwrap();
        let mut replacement = Arc::into_inner(replacement).unwrap();
        replacement.id = id;
        lock(&engine.inner.sessions)
            .unwrap()
            .insert(id, Arc::new(replacement));
        let current = engine.connect(&id).unwrap();
        assert_eq!(current.epoch(), stale.epoch());
        assert_eq!(
            engine.push_virtual_rx(&stale, b"old").unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            engine.enqueue_write(&stale, b"old").unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            engine.step_virtual(&stale, 0).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            engine.disconnect(&stale).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        engine.push_virtual_rx(&current, b"new").unwrap();
    }

    #[test]
    fn shutdown_preflights_every_session_before_cancelling_any_write() {
        let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
        let first = engine.create_virtual().unwrap();
        let second = engine.create_virtual().unwrap();
        let first_token = engine.connect(&first).unwrap();
        let second_token = engine.connect(&second).unwrap();
        let first_ticket = engine.enqueue_write(&first_token, b"first").unwrap();
        let second_ticket = engine.enqueue_write(&second_token, b"second").unwrap();
        let second_session = engine.session(&second).unwrap();
        second_session.lock().unwrap().next_sequence = u64::MAX;
        assert!(engine.shutdown().is_err());
        assert_eq!(first_ticket.try_result(), WriteStatus::Pending);
        assert_eq!(second_ticket.try_result(), WriteStatus::Pending);
        assert_eq!(
            engine.session(&first).unwrap().lock().unwrap().phase,
            ConnectionState::Connected
        );
        assert!(!*engine.inner.shutdown.read().unwrap());
        second_session.lock().unwrap().next_sequence = 2;
        engine.shutdown().unwrap();
        assert_eq!(first_ticket.try_result(), WriteStatus::Cancelled);
        assert_eq!(second_ticket.try_result(), WriteStatus::Cancelled);
    }
}
