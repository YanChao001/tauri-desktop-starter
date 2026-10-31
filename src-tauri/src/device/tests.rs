use std::{sync::Barrier, thread};

use crate::error::ErrorCode;

use super::{
    BatchLimit, DeviceEngine, DeviceLimits, StartAt, StreamBatch, WriteStatus,
    model::{
        ConnectionState, DeviceEvent, DeviceEventKind, Direction, MAX_BATCH_BYTES,
        MAX_BATCH_EVENTS, MAX_EVENT_BYTES, StreamGap, StreamItem,
    },
};

fn events(batch: StreamBatch) -> Vec<DeviceEvent> {
    batch
        .items
        .into_iter()
        .map(|item| match item {
            StreamItem::Event(event) => {
                event.validate().unwrap();
                event
            }
            StreamItem::Gap(gap) => panic!("Unexpected gap: {gap:?}"),
        })
        .collect()
}

fn assert_bytes(event: &DeviceEvent, direction: Direction, offset: u64, bytes: &[u8]) {
    assert_eq!(
        event.kind,
        DeviceEventKind::Bytes {
            direction,
            offset,
            bytes: bytes.to_vec(),
        }
    );
}

#[test]
fn readers_are_independent_and_dropping_a_view_does_not_close_the_connection() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let mut first = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let mut second = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let token = engine.connect(&id).unwrap();
    engine
        .push_virtual_rx(&token, &[0, 0xff, 0xc3, 0x28])
        .unwrap();

    let first_page = first
        .read_batch(BatchLimit {
            max_items: 1,
            max_bytes: 4,
        })
        .unwrap();
    assert!(!first_page.closed);
    assert_eq!(events(first_page)[0].sequence, 1);
    let second_page = second.read_batch(BatchLimit::default()).unwrap();
    assert!(!second_page.closed);
    let second_events = events(second_page);
    assert_eq!(second_events.len(), 2);
    assert_eq!(second_events[0].sequence, 1);
    assert_bytes(&second_events[1], Direction::Rx, 0, &[0, 0xff, 0xc3, 0x28]);
    assert_eq!(
        events(first.read_batch(BatchLimit::default()).unwrap()),
        second_events[1..]
    );

    drop(first);
    engine.push_virtual_rx(&token, b"live").unwrap();
    let live = second.read_batch(BatchLimit::default()).unwrap();
    assert!(!live.closed);
    assert_bytes(&events(live)[0], Direction::Rx, 4, b"live");
    drop(second);
    engine.push_virtual_rx(&token, b"no views").unwrap();
    assert_eq!(engine.connect(&id).unwrap_err().code, ErrorCode::Conflict);
}

#[test]
fn event_capacity_reports_precise_half_open_gaps_and_counts_each_gap_as_an_item() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_ring_events: 2,
        max_ring_bytes: 8,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let mut slow = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let token = engine.connect(&id).unwrap();
    let mut fast = engine.subscribe(&id, StartAt::Latest).unwrap();
    assert!(
        fast.read_batch(BatchLimit::default())
            .unwrap()
            .items
            .is_empty()
    );
    for byte in 0..3 {
        engine.push_virtual_rx(&token, &[byte]).unwrap();
        let batch = events(fast.read_batch(BatchLimit::default()).unwrap());
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].sequence, u64::from(byte) + 2);
    }
    let one_item = BatchLimit {
        max_items: 1,
        max_bytes: 1,
    };
    assert_eq!(
        slow.read_batch(one_item).unwrap().items,
        vec![StreamItem::Gap(StreamGap {
            session_id: id,
            from_sequence: 1,
            to_sequence: 3,
        })]
    );
    engine.push_virtual_rx(&token, &[3]).unwrap();
    assert_eq!(
        slow.read_batch(one_item).unwrap().items,
        vec![StreamItem::Gap(StreamGap {
            session_id: id,
            from_sequence: 3,
            to_sequence: 4,
        })]
    );
    let retained = events(slow.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(retained.len(), 2);
    assert_eq!(retained[0].sequence, 4);
    assert_eq!(retained[1].sequence, 5);
    assert_bytes(&retained[0], Direction::Rx, 2, &[2]);
    assert_bytes(&retained[1], Direction::Rx, 3, &[3]);

    let mut late = engine.subscribe(&id, StartAt::Latest).unwrap();
    assert!(
        late.read_batch(BatchLimit::default())
            .unwrap()
            .items
            .is_empty()
    );
    let mut beginning = engine.subscribe(&id, StartAt::Beginning).unwrap();
    assert_eq!(
        beginning.read_batch(one_item).unwrap().items,
        vec![StreamItem::Gap(StreamGap {
            session_id: id,
            from_sequence: 1,
            to_sequence: 4,
        })]
    );
}

#[test]
fn payload_capacity_retains_whole_events_and_does_not_charge_connection_metadata() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_ring_events: 8,
        max_ring_bytes: 4,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let mut slow = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let token = engine.connect(&id).unwrap();
    engine.push_virtual_rx(&token, b"ab").unwrap();
    engine.push_virtual_rx(&token, b"cd").unwrap();
    let mut fast = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let initial = events(fast.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(initial.len(), 3);
    assert_eq!(initial[0].sequence, 1);

    engine.push_virtual_rx(&token, b"efg").unwrap();
    let batch = slow.read_batch(BatchLimit::default()).unwrap();
    assert!(!batch.closed);
    assert_eq!(batch.items.len(), 2);
    assert_eq!(
        batch.items[0],
        StreamItem::Gap(StreamGap {
            session_id: id,
            from_sequence: 1,
            to_sequence: 4,
        })
    );
    let StreamItem::Event(event) = &batch.items[1] else {
        panic!("Expected the retained byte event");
    };
    assert_eq!(event.sequence, 4);
    assert_bytes(event, Direction::Rx, 4, b"efg");
    engine.push_virtual_rx(&token, b"h").unwrap();
    let retained = events(fast.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(retained.len(), 2);
    assert_bytes(&retained[0], Direction::Rx, 4, b"efg");
    assert_bytes(&retained[1], Direction::Rx, 7, b"h");
}

#[test]
fn an_undersized_batch_rolls_back_the_cursor_including_a_staged_gap_and_event() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_ring_events: 2,
        max_ring_bytes: 8,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    engine.push_virtual_rx(&token, b"a").unwrap();
    engine.push_virtual_rx(&token, b"xy").unwrap();
    engine.push_virtual_rx(&token, b"large").unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Beginning).unwrap();
    assert_eq!(
        reader
            .read_batch(BatchLimit {
                max_items: 3,
                max_bytes: 4,
            })
            .unwrap_err()
            .code,
        ErrorCode::InputTooLong
    );
    let recovered = reader
        .read_batch(BatchLimit {
            max_items: 3,
            max_bytes: 7,
        })
        .unwrap();
    assert_eq!(recovered.items.len(), 3);
    assert_eq!(
        recovered.items[0],
        StreamItem::Gap(StreamGap {
            session_id: id,
            from_sequence: 1,
            to_sequence: 3,
        })
    );
    let restored = events(StreamBatch {
        items: recovered.items.into_iter().skip(1).collect(),
        closed: false,
    });
    assert_bytes(&restored[0], Direction::Rx, 1, b"xy");
    assert_bytes(&restored[1], Direction::Rx, 3, b"large");
}

#[test]
fn a_batch_that_only_lacks_remaining_bytes_returns_a_prefix_without_splitting_frames() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Latest).unwrap();
    engine.push_virtual_rx(&token, b"one").unwrap();
    engine.push_virtual_rx(&token, b"two").unwrap();
    let limit = BatchLimit {
        max_items: 4,
        max_bytes: 4,
    };
    let first = events(reader.read_batch(limit).unwrap());
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].sequence, 2);
    assert_bytes(&first[0], Direction::Rx, 0, b"one");
    let second = events(reader.read_batch(limit).unwrap());
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].sequence, 3);
    assert_bytes(&second[0], Direction::Rx, 3, b"two");
    let idle = reader.read_batch(limit).unwrap();
    assert!(idle.items.is_empty());
    assert!(!idle.closed);
}

#[test]
fn reconnect_rejects_every_old_operation_and_preserves_sequence_and_direction_offsets() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let old = engine.connect(&id).unwrap();
    assert_eq!(old.session_id(), id);
    assert_eq!(old.epoch(), 1);
    let mut reader = engine.subscribe(&id, StartAt::Beginning).unwrap();
    engine.push_virtual_rx(&old, &[0, 0xff]).unwrap();
    let completed = engine.enqueue_write(&old, b"abc").unwrap();
    assert_eq!(engine.step_virtual(&old, 1).unwrap(), 1);
    let cancelled = engine.enqueue_write(&old, b"not replayed").unwrap();
    engine.disconnect(&old).unwrap();
    assert_eq!(cancelled.try_result(), WriteStatus::Cancelled);
    let current = engine.connect(&id).unwrap();
    assert_eq!(current.epoch(), 2);
    assert_eq!(
        engine.push_virtual_rx(&old, b"x").unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.enqueue_write(&old, b"x").unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.step_virtual(&old, 0).unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.disconnect(&old).unwrap_err().code,
        ErrorCode::Conflict
    );
    engine.push_virtual_rx(&current, b"d").unwrap();
    let next = engine.enqueue_write(&current, b"ef").unwrap();
    assert_eq!(engine.step_virtual(&current, usize::MAX).unwrap(), 1);
    assert_eq!(completed.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(next.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(cancelled.try_result(), WriteStatus::Cancelled);

    let history = events(reader.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(history.len(), 9);
    assert_eq!(
        history
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>(),
        (1..=9).collect::<Vec<_>>()
    );
    assert!(history[..5].iter().all(|event| event.epoch == 1));
    assert!(history[5..].iter().all(|event| event.epoch == 2));
    assert_eq!(
        history[4].kind,
        DeviceEventKind::Connection(ConnectionState::Disconnected)
    );
    assert_eq!(
        history[5].kind,
        DeviceEventKind::Connection(ConnectionState::Connected)
    );
    assert_bytes(&history[2], Direction::Tx, 0, b"abc");
    assert_bytes(&history[3], Direction::Rx, 2, b"abc");
    assert_bytes(&history[6], Direction::Rx, 5, b"d");
    assert_bytes(&history[7], Direction::Tx, 3, b"ef");
    assert_bytes(&history[8], Direction::Rx, 6, b"ef");
}

#[test]
fn writes_are_fifo_and_dropped_or_cloned_tickets_do_not_change_terminal_results() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Latest).unwrap();
    let first = engine.enqueue_write(&token, b"one").unwrap();
    let kept = first.clone();
    drop(first);
    let second = engine.enqueue_write(&token, b"two").unwrap();
    let third = engine.enqueue_write(&token, b"three").unwrap();
    assert_eq!(engine.step_virtual(&token, 0).unwrap(), 0);
    assert_eq!(kept.try_result(), WriteStatus::Pending);
    assert_eq!(engine.step_virtual(&token, 1).unwrap(), 1);
    assert_eq!(kept.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(second.try_result(), WriteStatus::Pending);
    assert_eq!(third.try_result(), WriteStatus::Pending);
    assert_eq!(engine.step_virtual(&token, usize::MAX).unwrap(), 2);
    assert_eq!(engine.step_virtual(&token, 1).unwrap(), 0);
    assert_eq!(second.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(third.try_result(), WriteStatus::VirtualCompleted);
    let history = events(reader.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(history.len(), 6);
    for (pair, (offset, bytes)) in history.as_chunks::<2>().0.iter().zip([
        (0, b"one".as_slice()),
        (3, b"two".as_slice()),
        (6, b"three".as_slice()),
    ]) {
        assert_bytes(&pair[0], Direction::Tx, offset, bytes);
        assert_bytes(&pair[1], Direction::Rx, offset, bytes);
    }
    engine.disconnect(&token).unwrap();
    assert_eq!(kept.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(second.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(third.try_result(), WriteStatus::VirtualCompleted);
}

#[test]
fn the_entire_selected_step_is_preflighted_before_history_eviction_or_ticket_completion() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_ring_events: 8,
        max_ring_bytes: 4,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Latest).unwrap();
    engine.push_virtual_rx(&token, b"seed").unwrap();
    let first = engine.enqueue_write(&token, b"ok").unwrap();
    let second = engine.enqueue_write(&token, b"large").unwrap();
    assert_eq!(
        engine.step_virtual(&token, 2).unwrap_err().code,
        ErrorCode::InputTooLong
    );
    assert_eq!(
        engine.push_virtual_rx(&token, b"large").unwrap_err().code,
        ErrorCode::InputTooLong
    );
    assert_eq!(first.try_result(), WriteStatus::Pending);
    assert_eq!(second.try_result(), WriteStatus::Pending);
    let unchanged = events(reader.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(unchanged.len(), 1);
    assert_eq!(unchanged[0].sequence, 2);
    assert_bytes(&unchanged[0], Direction::Rx, 0, b"seed");

    assert_eq!(engine.step_virtual(&token, 1).unwrap(), 1);
    let committed = events(reader.read_batch(BatchLimit::default()).unwrap());
    assert_eq!(committed.len(), 2);
    assert_eq!(committed[0].sequence, 3);
    assert_eq!(committed[1].sequence, 4);
    assert_bytes(&committed[0], Direction::Tx, 0, b"ok");
    assert_bytes(&committed[1], Direction::Rx, 4, b"ok");
    assert_eq!(first.try_result(), WriteStatus::VirtualCompleted);
    assert_eq!(second.try_result(), WriteStatus::Pending);
    engine.disconnect(&token).unwrap();
    assert_eq!(second.try_result(), WriteStatus::Cancelled);
}

#[test]
fn count_and_byte_queue_saturation_never_block_disconnect_or_close() {
    for (max_pending_writes, max_pending_write_bytes) in [(2, 16), (8, 4)] {
        let engine = DeviceEngine::new(DeviceLimits {
            max_pending_writes,
            max_pending_write_bytes,
            ..DeviceLimits::default()
        })
        .unwrap();
        let id = engine.create_virtual().unwrap();
        let token = engine.connect(&id).unwrap();
        let first = engine.enqueue_write(&token, b"ab").unwrap();
        let second = engine.enqueue_write(&token, b"cd").unwrap();
        assert_eq!(
            engine.enqueue_write(&token, b"e").unwrap_err().code,
            ErrorCode::NativeBusy
        );
        engine.disconnect(&token).unwrap();
        assert_eq!(first.try_result(), WriteStatus::Cancelled);
        assert_eq!(second.try_result(), WriteStatus::Cancelled);

        let token = engine.connect(&id).unwrap();
        let first = engine.enqueue_write(&token, b"ab").unwrap();
        let second = engine.enqueue_write(&token, b"cd").unwrap();
        assert_eq!(
            engine.enqueue_write(&token, b"e").unwrap_err().code,
            ErrorCode::NativeBusy
        );
        engine.close(&id).unwrap();
        assert_eq!(first.try_result(), WriteStatus::Cancelled);
        assert_eq!(second.try_result(), WriteStatus::Cancelled);
        assert_eq!(
            engine.step_virtual(&token, 1).unwrap_err().code,
            ErrorCode::Conflict
        );
    }
}

#[test]
fn close_is_idempotent_and_eof_is_only_reported_after_the_cursor_drains() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Beginning).unwrap();
    engine.push_virtual_rx(&token, b"x").unwrap();
    let pending = engine.enqueue_write(&token, b"cancel").unwrap();
    engine.close(&id).unwrap();
    engine.close(&id).unwrap();
    assert_eq!(pending.try_result(), WriteStatus::Cancelled);
    let limit = BatchLimit {
        max_items: 1,
        max_bytes: 1,
    };
    for sequence in 1..=3 {
        let batch = reader.read_batch(limit).unwrap();
        assert_eq!(batch.closed, sequence == 3);
        assert_eq!(events(batch)[0].sequence, sequence);
    }
    for _ in 0..2 {
        let eof = reader.read_batch(limit).unwrap();
        assert!(eof.items.is_empty());
        assert!(eof.closed);
    }
    let mut latest = engine.subscribe(&id, StartAt::Latest).unwrap();
    let eof = latest.read_batch(limit).unwrap();
    assert!(eof.items.is_empty() && eof.closed);
    assert_eq!(engine.connect(&id).unwrap_err().code, ErrorCode::Conflict);
    assert_eq!(
        engine.push_virtual_rx(&token, b"x").unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.enqueue_write(&token, b"x").unwrap_err().code,
        ErrorCode::Conflict
    );
}

#[test]
fn a_closed_session_still_drains_its_gap_and_terminal_event_before_eof() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_ring_events: 1,
        max_ring_bytes: 1,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    engine.push_virtual_rx(&token, b"x").unwrap();
    engine.close(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let limit = BatchLimit {
        max_items: 1,
        max_bytes: 1,
    };
    let gap = reader.read_batch(limit).unwrap();
    assert!(!gap.closed);
    assert_eq!(
        gap.items,
        vec![StreamItem::Gap(StreamGap {
            session_id: id,
            from_sequence: 1,
            to_sequence: 3,
        })]
    );
    let terminal = reader.read_batch(limit).unwrap();
    assert!(terminal.closed);
    assert_eq!(
        events(terminal)[0].kind,
        DeviceEventKind::Connection(ConnectionState::Closed)
    );
}

#[test]
fn shutdown_is_idempotent_cancels_pending_and_preserves_readable_closed_history() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let clone = engine.clone();
    let active = engine.create_virtual().unwrap();
    let unopened = engine.create_virtual().unwrap();
    let token = engine.connect(&active).unwrap();
    let pending = engine.enqueue_write(&token, b"cancel").unwrap();
    let mut reader = engine.subscribe(&active, StartAt::Latest).unwrap();
    engine.shutdown().unwrap();
    clone.shutdown().unwrap();
    engine.close(&active).unwrap();
    assert_eq!(pending.try_result(), WriteStatus::Cancelled);
    assert_eq!(
        engine.create_virtual().unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        clone.create_virtual().unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.connect(&unopened).unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.push_virtual_rx(&token, b"x").unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.enqueue_write(&token, b"x").unwrap_err().code,
        ErrorCode::Conflict
    );
    assert_eq!(
        engine.step_virtual(&token, 0).unwrap_err().code,
        ErrorCode::Conflict
    );
    let mut unopened_reader = engine.subscribe(&unopened, StartAt::Beginning).unwrap();
    let unopened_history = unopened_reader.read_batch(BatchLimit::default()).unwrap();
    assert!(unopened_history.closed);
    let unopened_events = events(unopened_history);
    assert_eq!(unopened_events.len(), 1);
    assert_eq!(unopened_events[0].sequence, 1);
    assert_eq!(unopened_events[0].epoch, 0);
    assert_eq!(
        unopened_events[0].kind,
        DeviceEventKind::Connection(ConnectionState::Closed)
    );
    drop(engine);
    drop(clone);
    let final_batch = reader.read_batch(BatchLimit::default()).unwrap();
    assert!(final_batch.closed);
    let terminal = events(final_batch);
    assert_eq!(terminal.len(), 1);
    assert_eq!(terminal[0].sequence, 2);
    assert_eq!(
        terminal[0].kind,
        DeviceEventKind::Connection(ConnectionState::Closed)
    );
}

#[test]
fn dropping_the_last_session_owner_cancels_unexecuted_tickets() {
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let ticket = engine.enqueue_write(&token, b"not executed").unwrap();
    let clone = engine.clone();
    let mut reader = engine.subscribe(&id, StartAt::Beginning).unwrap();
    drop(engine);
    assert_eq!(ticket.try_result(), WriteStatus::Pending);
    drop(clone);
    assert_eq!(ticket.try_result(), WriteStatus::Cancelled);
    let retained = reader.read_batch(BatchLimit::default()).unwrap();
    assert!(!retained.closed);
    assert_eq!(events(retained).len(), 1);
}

#[test]
fn closed_capacity_is_reclaimed_only_after_every_reader_drops_and_tokens_do_not_pin_it() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_sessions: 1,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let first = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let second = engine.subscribe(&id, StartAt::Beginning).unwrap();
    assert_eq!(
        engine.create_virtual().unwrap_err().code,
        ErrorCode::NativeBusy
    );
    engine.close(&id).unwrap();
    assert_eq!(
        engine.create_virtual().unwrap_err().code,
        ErrorCode::NativeBusy
    );
    drop(first);
    assert_eq!(
        engine.create_virtual().unwrap_err().code,
        ErrorCode::NativeBusy
    );
    drop(second);
    let replacement = engine.create_virtual().unwrap();
    assert_ne!(replacement, id);
    assert_eq!(
        engine.subscribe(&id, StartAt::Beginning).unwrap_err().code,
        ErrorCode::NotFound
    );
    assert!(engine.push_virtual_rx(&token, b"old").is_err());
    assert_eq!(
        engine.create_virtual().unwrap_err().code,
        ErrorCode::NativeBusy
    );
    engine.close(&replacement).unwrap();
    assert!(engine.create_virtual().is_ok());
}

#[test]
fn invalid_inputs_and_batch_limits_do_not_advance_history_or_cursors() {
    let defaults = DeviceLimits::default();
    for limits in [
        DeviceLimits {
            max_sessions: 0,
            ..defaults
        },
        DeviceLimits {
            max_ring_events: 0,
            ..defaults
        },
        DeviceLimits {
            max_ring_bytes: 0,
            ..defaults
        },
        DeviceLimits {
            max_pending_writes: 0,
            ..defaults
        },
        DeviceLimits {
            max_pending_write_bytes: 0,
            ..defaults
        },
    ] {
        assert_eq!(
            DeviceEngine::new(limits).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    let engine = DeviceEngine::new(DeviceLimits {
        max_pending_write_bytes: MAX_EVENT_BYTES,
        ..defaults
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Latest).unwrap();
    assert_eq!(
        engine.push_virtual_rx(&token, b"").unwrap_err().code,
        ErrorCode::InvalidArgument
    );
    assert_eq!(
        engine.enqueue_write(&token, b"").unwrap_err().code,
        ErrorCode::InvalidArgument
    );
    let oversized = vec![0; MAX_EVENT_BYTES + 1];
    assert_eq!(
        engine.push_virtual_rx(&token, &oversized).unwrap_err().code,
        ErrorCode::InputTooLong
    );
    assert_eq!(
        engine.enqueue_write(&token, &oversized).unwrap_err().code,
        ErrorCode::InputTooLong
    );
    let bytes = vec![0xff; MAX_EVENT_BYTES];
    engine.push_virtual_rx(&token, &bytes).unwrap();
    for limit in [
        BatchLimit {
            max_items: 0,
            max_bytes: 1,
        },
        BatchLimit {
            max_items: 1,
            max_bytes: 0,
        },
        BatchLimit {
            max_items: MAX_BATCH_EVENTS + 1,
            max_bytes: 1,
        },
        BatchLimit {
            max_items: 1,
            max_bytes: MAX_BATCH_BYTES + 1,
        },
    ] {
        assert_eq!(
            reader.read_batch(limit).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    assert_eq!(
        reader
            .read_batch(BatchLimit {
                max_items: 1,
                max_bytes: MAX_EVENT_BYTES - 1
            })
            .unwrap_err()
            .code,
        ErrorCode::InputTooLong
    );
    let exact = events(
        reader
            .read_batch(BatchLimit {
                max_items: 1,
                max_bytes: MAX_EVENT_BYTES,
            })
            .unwrap(),
    );
    assert_eq!(exact.len(), 1);
    assert_eq!(exact[0].sequence, 2);
    assert_bytes(&exact[0], Direction::Rx, 0, &bytes);
    assert_eq!(engine.step_virtual(&token, 1).unwrap(), 0);
}

#[test]
fn an_individually_oversized_pending_write_is_rejected_without_enqueuing() {
    let engine = DeviceEngine::new(DeviceLimits {
        max_pending_write_bytes: 2,
        ..DeviceLimits::default()
    })
    .unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    assert_eq!(
        engine.enqueue_write(&token, b"big").unwrap_err().code,
        ErrorCode::InputTooLong
    );
    assert_eq!(engine.step_virtual(&token, usize::MAX).unwrap(), 0);
    let ticket = engine.enqueue_write(&token, b"ok").unwrap();
    assert_eq!(engine.step_virtual(&token, 1).unwrap(), 1);
    assert_eq!(ticket.try_result(), WriteStatus::VirtualCompleted);
}

#[test]
fn concurrent_rx_and_fifo_writes_share_unique_session_sequences_and_offsets() {
    const PRODUCERS: usize = 4;
    const WRITES: u8 = 32;
    let engine = DeviceEngine::new(DeviceLimits::default()).unwrap();
    let id = engine.create_virtual().unwrap();
    let token = engine.connect(&id).unwrap();
    let mut reader = engine.subscribe(&id, StartAt::Beginning).unwrap();
    let barrier = Barrier::new(PRODUCERS);
    let tickets = thread::scope(|scope| {
        let handles: Vec<_> = (0..PRODUCERS)
            .map(|producer| {
                let engine = &engine;
                let token = &token;
                let barrier = &barrier;
                scope.spawn(move || {
                    barrier.wait();
                    let mut tickets = Vec::new();
                    for index in 0..WRITES {
                        let bytes = [producer as u8, index];
                        engine.push_virtual_rx(token, &bytes).unwrap();
                        tickets.push(engine.enqueue_write(token, &bytes).unwrap());
                        assert_eq!(engine.step_virtual(token, 1).unwrap(), 1);
                    }
                    tickets
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert!(
        tickets
            .iter()
            .all(|ticket| ticket.try_result() == WriteStatus::VirtualCompleted)
    );
    assert_eq!(engine.step_virtual(&token, usize::MAX).unwrap(), 0);
    engine.close(&id).unwrap();
    let first = reader.read_batch(BatchLimit::default()).unwrap();
    assert_eq!(first.items.len(), MAX_BATCH_EVENTS);
    assert!(!first.closed);
    let mut history = events(first);
    let last = reader.read_batch(BatchLimit::default()).unwrap();
    assert!(last.closed);
    history.extend(events(last));
    let expected = PRODUCERS * usize::from(WRITES) * 3 + 2;
    assert_eq!(history.len(), expected);
    assert_eq!(
        history
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>(),
        (1..=expected as u64).collect::<Vec<_>>()
    );
    let mut rx_offset = 0;
    let mut tx_offset = 0;
    let mut timestamp = 0;
    for event in &history {
        assert_eq!(event.session_id, id);
        assert_eq!(event.epoch, 1);
        assert!(event.timestamp_micros >= timestamp);
        timestamp = event.timestamp_micros;
        if let DeviceEventKind::Bytes {
            direction,
            offset,
            bytes,
        } = &event.kind
        {
            let expected_offset = match direction {
                Direction::Rx => &mut rx_offset,
                Direction::Tx => &mut tx_offset,
            };
            assert_eq!(*offset, *expected_offset);
            assert_eq!(bytes.len(), 2);
            *expected_offset += bytes.len() as u64;
        }
    }
    assert_eq!(tx_offset, (PRODUCERS * usize::from(WRITES) * 2) as u64);
    assert_eq!(rx_offset, tx_offset * 2);
}
