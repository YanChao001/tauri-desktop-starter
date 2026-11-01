//! 附件阶段的轻量快照；不取得历史、缓存、连接或发送锁。
use super::*;

const MAX_ACTIVE: usize = 64;
const MAX_TERMINAL: usize = 16;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Transfer {
    id: String,
    peer_id: String,
    direction: String,
    kind: String,
    name: String,
    bytes: usize,
    phase: String,
    completed_bytes: usize,
    total_bytes: usize,
    started_at: u64,
    #[serde(skip)]
    serial: u64,
    #[serde(skip)]
    cancelled: Arc<AtomicBool>,
    #[serde(skip)]
    hidden: bool,
}
impl Transfer {
    fn terminal(&self) -> bool {
        matches!(self.phase.as_str(), "completed" | "failed")
    }
}
#[derive(Default)]
struct State {
    serial: u64,
    transfers: VecDeque<Transfer>,
}
impl State {
    fn trim(&mut self) {
        self.transfers
            .retain(|entry| !(entry.hidden && entry.terminal()));
        while self
            .transfers
            .iter()
            .filter(|entry| entry.terminal())
            .count()
            > MAX_TERMINAL
        {
            if let Some(index) = self.transfers.iter().position(Transfer::terminal) {
                self.transfers.remove(index);
            }
        }
    }
}
#[derive(Default)]
pub(super) struct Transfers(Mutex<State>);
impl Transfers {
    pub(super) fn begin(
        self: &Arc<Self>,
        peer: &str,
        direction: &str,
        kind: &str,
        attachment: &Attachment,
        id: String,
        stop: Option<&AtomicBool>,
    ) -> NativeResult<TransferGuard> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| unavailable("LAN progress is unavailable"))?;
        // Stop 先置位该次会话 token 再取得此锁清空；锁内检查阻止旧选择器晚到重建条目。
        if stop.is_some_and(|stop| stop.load(Ordering::Acquire)) {
            return Err(attachment_io::interrupted("LAN transfer was stopped"));
        }
        if state
            .transfers
            .iter()
            .filter(|entry| !entry.terminal())
            .count()
            >= MAX_ACTIVE
            || state
                .transfers
                .iter()
                .any(|entry| entry.id == id && entry.direction == direction && !entry.terminal())
        {
            return Err(NativeError::new(
                ErrorCode::ExtensionBusy,
                "LAN attachment progress is full",
            ));
        }
        // 接收历史按消息 ID 幂等；补发替换终态，快照始终保持 direction + id 唯一。
        state
            .transfers
            .retain(|entry| entry.id != id || entry.direction != direction);
        state.serial = state.serial.wrapping_add(1);
        let serial = state.serial;
        let cancelled = Arc::new(AtomicBool::new(false));
        state.transfers.push_back(Transfer {
            id: id.clone(),
            peer_id: peer.into(),
            direction: direction.into(),
            kind: kind.into(),
            name: attachment.name.clone(),
            bytes: attachment.bytes,
            phase: if direction == "incoming" {
                "receiving"
            } else {
                "preparing"
            }
            .into(),
            completed_bytes: 0,
            total_bytes: attachment.bytes,
            started_at: now(),
            serial,
            cancelled: cancelled.clone(),
            hidden: false,
        });
        state.trim();
        Ok(TransferGuard {
            progress: self.clone(),
            id,
            serial,
            finished: false,
            cancelled,
        })
    }
    pub(super) fn snapshot(&self) -> NativeResult<Value> {
        let state = self
            .0
            .lock()
            .map_err(|_| unavailable("LAN progress is unavailable"))?;
        let visible: Vec<_> = state
            .transfers
            .iter()
            .filter(|entry| !entry.hidden)
            .collect();
        Ok(json!({"transfers":visible}))
    }
    pub(super) fn delivered(&self, peer: &str, id: &str) {
        if let Ok(mut state) = self.0.lock() {
            for entry in &mut state.transfers {
                if entry.peer_id == peer && entry.id == id && entry.direction == "outgoing" {
                    entry.phase = "completed".into();
                    entry.completed_bytes = entry.total_bytes;
                }
            }
            state.trim();
        }
    }
    pub(super) fn disconnected(&self, peer: &str) {
        if let Ok(mut state) = self.0.lock() {
            for entry in &mut state.transfers {
                if entry.peer_id == peer && !entry.terminal() {
                    entry.cancelled.store(true, Ordering::Release);
                    entry.phase = "failed".into();
                }
            }
            state.trim();
        }
    }
    pub(super) fn clear(&self) {
        if let Ok(mut state) = self.0.lock() {
            for entry in &state.transfers {
                entry.cancelled.store(true, Ordering::Release);
            }
            state.transfers.clear();
        }
    }
    pub(super) fn clear_history(&self, peer: Option<&str>) {
        if let Ok(mut state) = self.0.lock() {
            // 清空后晚到的 ACK 或完成不能在其他窗口重新生成附件气泡。
            // 在途 guard、取消标记和容量继续有效，只隐藏它们的快照。
            for entry in &mut state.transfers {
                if peer.is_none_or(|peer| peer == entry.peer_id) {
                    entry.hidden = true;
                }
            }
            state.trim();
        }
    }
}
pub(super) struct TransferGuard {
    progress: Arc<Transfers>,
    id: String,
    serial: u64,
    finished: bool,
    cancelled: Arc<AtomicBool>,
}
impl TransferGuard {
    pub(super) fn id(&self) -> &str {
        &self.id
    }
    pub(super) fn check(&self) -> NativeResult<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(attachment_io::interrupted(
                "LAN transfer was stopped or disconnected",
            ))
        } else {
            Ok(())
        }
    }
    fn edit(&self, edit: impl FnOnce(&mut Transfer)) {
        if let Ok(mut state) = self.progress.0.lock() {
            if let Some(entry) = state
                .transfers
                .iter_mut()
                .find(|entry| entry.serial == self.serial)
            {
                edit(entry);
            }
            state.trim();
        }
    }
    pub(super) fn phase(&self, phase: &str) {
        self.edit(|entry| {
            if !entry.terminal() {
                entry.phase = phase.into();
                entry.completed_bytes = 0;
            }
        });
    }
    pub(super) fn advance(&self, count: usize) {
        self.edit(|entry| {
            entry.completed_bytes = entry
                .completed_bytes
                .saturating_add(count)
                .min(entry.total_bytes)
        });
    }
    pub(super) fn complete(mut self) {
        self.edit(|entry| {
            entry.phase = "completed".into();
            entry.completed_bytes = entry.total_bytes;
        });
        self.finished = true;
    }
    pub(super) fn awaiting_receipt(mut self) {
        self.edit(|entry| {
            // 对端回执可能先于发送线程退出到达，不得把 completed 降回等待。
            if !entry.terminal() {
                entry.phase = "awaitingReceipt".into();
                entry.completed_bytes = entry.total_bytes;
            }
        });
        self.finished = true;
    }
}
impl Drop for TransferGuard {
    fn drop(&mut self) {
        if !self.finished {
            self.edit(|entry| {
                if !entry.terminal() {
                    entry.phase = "failed".into();
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn metadata() -> Attachment {
        Attachment {
            name: "progress.bin".into(),
            mime: "application/octet-stream".into(),
            bytes: 100,
            sha256: "a".repeat(64),
        }
    }
    #[test]
    fn failed_and_cleared_operations_cannot_leave_or_recreate_active_progress() {
        let transfers = Arc::new(Transfers::default());
        let failed = transfers
            .begin(
                "peer",
                "outgoing",
                "file",
                &metadata(),
                "failed".into(),
                None,
            )
            .unwrap();
        failed.advance(21);
        drop(failed);
        let snapshot = transfers.snapshot().unwrap();
        assert_eq!(snapshot["transfers"][0]["phase"], "failed");
        assert_eq!(snapshot["transfers"][0]["completedBytes"], 21);
        let late = transfers
            .begin(
                "peer",
                "incoming",
                "file",
                &metadata(),
                "stopped".into(),
                None,
            )
            .unwrap();
        transfers.clear();
        assert_eq!(
            late.check().unwrap_err().code,
            ErrorCode::ExtensionTransferInterrupted
        );
        late.advance(100);
        late.complete();
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
    }
    #[test]
    fn acknowledgements_finish_cleared_history_sends_and_win_the_sender_exit_race() {
        let transfers = Arc::new(Transfers::default());
        let sending = transfers
            .begin(
                "peer",
                "outgoing",
                "file",
                &metadata(),
                "message".into(),
                None,
            )
            .unwrap();
        sending.phase("sending");
        sending.advance(100);
        transfers.delivered("other", "message");
        assert_eq!(
            transfers.snapshot().unwrap()["transfers"][0]["phase"],
            "sending"
        );
        transfers.delivered("peer", "message");
        sending.awaiting_receipt();
        assert_eq!(
            transfers.snapshot().unwrap()["transfers"][0]["phase"],
            "completed"
        );
        let waiting = transfers
            .begin(
                "peer",
                "outgoing",
                "file",
                &metadata(),
                "waiting".into(),
                None,
            )
            .unwrap();
        let waiting_cancelled = waiting.cancelled.clone();
        waiting.awaiting_receipt();
        transfers.clear_history(Some("peer"));
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
        transfers.disconnected("peer");
        assert!(waiting_cancelled.load(Ordering::Acquire));
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
    }
    #[test]
    fn progress_admission_and_terminal_retention_stay_bounded() {
        let transfers = Arc::new(Transfers::default());
        let active: Vec<_> = (0..64)
            .map(|index| {
                transfers
                    .begin(
                        "peer",
                        "incoming",
                        "file",
                        &metadata(),
                        index.to_string(),
                        None,
                    )
                    .unwrap()
            })
            .collect();
        assert_eq!(
            transfers
                .begin(
                    "peer",
                    "incoming",
                    "file",
                    &metadata(),
                    "overfull".into(),
                    None
                )
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        drop(active);
        assert_eq!(
            transfers.snapshot().unwrap()["transfers"]
                .as_array()
                .unwrap()
                .len(),
            16
        );
        let next = transfers
            .begin("peer", "incoming", "file", &metadata(), "next".into(), None)
            .unwrap();
        next.complete();
        let snapshot = transfers.snapshot().unwrap();
        assert_eq!(snapshot["transfers"].as_array().unwrap().len(), 16);
        assert_eq!(
            snapshot["transfers"].as_array().unwrap().last().unwrap()["phase"],
            "completed"
        );
    }
    #[test]
    fn a_replayed_message_replaces_its_terminal_progress_and_active_identities_remain_unique() {
        let transfers = Arc::new(Transfers::default());
        transfers
            .begin(
                "first",
                "incoming",
                "file",
                &metadata(),
                "replay".into(),
                None,
            )
            .unwrap()
            .complete();
        let active = transfers
            .begin(
                "second",
                "incoming",
                "file",
                &metadata(),
                "replay".into(),
                None,
            )
            .unwrap();
        let snapshot = transfers.snapshot().unwrap();
        assert_eq!(
            snapshot["transfers"].as_array().unwrap().len(),
            1,
            "a replay must not expose two incoming entries with one id"
        );
        assert_eq!(snapshot["transfers"][0]["peerId"], "second");
        assert_eq!(
            transfers
                .begin(
                    "third",
                    "incoming",
                    "file",
                    &metadata(),
                    "replay".into(),
                    None
                )
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        assert_eq!(
            transfers.snapshot().unwrap()["transfers"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let opposite = transfers
            .begin(
                "third",
                "outgoing",
                "file",
                &metadata(),
                "replay".into(),
                None,
            )
            .unwrap();
        assert_eq!(
            transfers.snapshot().unwrap()["transfers"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        active.complete();
        opposite.complete();
    }
    #[test]
    fn clearing_history_hides_active_transfers_through_receipts_and_completion_without_cancelling()
    {
        let transfers = Arc::new(Transfers::default());
        let receiving = transfers
            .begin(
                "cleared",
                "incoming",
                "file",
                &metadata(),
                "receiving".into(),
                None,
            )
            .unwrap();
        let waiting = transfers
            .begin(
                "cleared",
                "outgoing",
                "file",
                &metadata(),
                "waiting".into(),
                None,
            )
            .unwrap();
        let waiting_cancelled = waiting.cancelled.clone();
        waiting.awaiting_receipt();
        transfers
            .begin(
                "cleared",
                "incoming",
                "file",
                &metadata(),
                "old-terminal".into(),
                None,
            )
            .unwrap()
            .complete();
        let other = transfers
            .begin(
                "retained",
                "incoming",
                "file",
                &metadata(),
                "other".into(),
                None,
            )
            .unwrap();
        transfers.clear_history(Some("cleared"));
        let snapshot = transfers.snapshot().unwrap();
        assert_eq!(
            snapshot["transfers"].as_array().unwrap().len(),
            1,
            "cleared attachments must not reappear as transfer-only bubbles"
        );
        assert_eq!(snapshot["transfers"][0]["id"], "other");
        receiving.check().unwrap();
        assert!(!waiting_cancelled.load(Ordering::Acquire));
        receiving.phase("verifying");
        receiving.advance(100);
        receiving.complete();
        transfers.delivered("cleared", "waiting");
        let snapshot = transfers.snapshot().unwrap();
        assert_eq!(snapshot["transfers"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["transfers"][0]["id"], "other");
        other.check().unwrap();
        other.complete();
        transfers.clear_history(None);
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
    }
    #[test]
    fn clearing_history_keeps_hidden_active_capacity_and_disconnect_stop_cancellation() {
        let transfers = Arc::new(Transfers::default());
        let active: Vec<_> = (0..64)
            .map(|index| {
                transfers
                    .begin(
                        "cleared",
                        "incoming",
                        "file",
                        &metadata(),
                        index.to_string(),
                        None,
                    )
                    .unwrap()
            })
            .collect();
        transfers.clear_history(None);
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
        assert_eq!(
            transfers
                .begin(
                    "new-peer",
                    "incoming",
                    "file",
                    &metadata(),
                    "overflow".into(),
                    None
                )
                .err()
                .unwrap()
                .code,
            ErrorCode::ExtensionBusy
        );
        transfers.disconnected("cleared");
        for guard in &active {
            assert!(guard.check().is_err());
        }
        assert!(transfers.0.lock().unwrap().transfers.len() <= 16);
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
        let next = transfers
            .begin(
                "new-peer",
                "incoming",
                "file",
                &metadata(),
                "next".into(),
                None,
            )
            .unwrap();
        transfers.clear_history(Some("new-peer"));
        next.check().unwrap();
        transfers.clear();
        assert!(next.check().is_err());
        drop(next);
        assert_eq!(transfers.snapshot().unwrap(), json!({"transfers":[]}));
    }
}
