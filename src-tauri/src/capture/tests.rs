use std::cell::Cell;
use std::io::{self, Cursor, Read};
use std::rc::Rc;

use sha2::{Digest, Sha256};

use super::format::{
    BYTE_PREFIX_LENGTH, FRAME_OVERHEAD_BYTES, HEADER_BYTES, HEADER_CONTENT_BYTES, MAGIC,
};
use super::*;
use crate::device::model::{
    ConnectionState, DeviceEvent, DeviceEventKind, DeviceSource, Direction, MAX_EVENT_BYTES,
    SessionId, StreamGap, StreamItem,
};
use crate::error::ErrorCode;

fn header() -> CaptureHeader {
    CaptureHeader::new(SessionId::from_bytes([0xa5; 16]), DeviceSource::Virtual)
}

fn event(sequence: u64, epoch: u64, kind: DeviceEventKind) -> StreamItem {
    StreamItem::Event(DeviceEvent {
        session_id: header().session_id,
        sequence,
        epoch,
        timestamp_micros: sequence * 10,
        kind,
    })
}

fn connection(sequence: u64, epoch: u64, state: ConnectionState) -> StreamItem {
    event(sequence, epoch, DeviceEventKind::Connection(state))
}

fn bytes(sequence: u64, epoch: u64, direction: Direction, offset: u64, data: &[u8]) -> StreamItem {
    event(
        sequence,
        epoch,
        DeviceEventKind::Bytes {
            direction,
            offset,
            bytes: data.to_vec(),
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

fn sample() -> Vec<StreamItem> {
    vec![
        connection(1, 1, ConnectionState::Connected),
        bytes(2, 1, Direction::Rx, 0, &[0, 0xff, 0xc3, 0x28]),
        bytes(3, 1, Direction::Tx, 0, &[0x80, 0]),
        connection(4, 1, ConnectionState::Disconnected),
        connection(5, 2, ConnectionState::Connected),
        bytes(6, 2, Direction::Rx, 4, &[0xfe, 1]),
        gap(7, 11),
        bytes(11, 4, Direction::Tx, 20, &[0, 0x81]),
        bytes(12, 4, Direction::Rx, 30, MAGIC),
        connection(13, 4, ConnectionState::Disconnected),
        connection(14, 5, ConnectionState::Connected),
        bytes(15, 5, Direction::Rx, 38, &[0xf5]),
        connection(16, 5, ConnectionState::Closed),
    ]
}

fn record(items: &[StreamItem]) -> (Vec<u8>, CaptureSummary) {
    let mut writer = CaptureWriter::new(Vec::new(), header()).unwrap();
    for item in items {
        writer.append(item).unwrap();
    }
    writer.finish().unwrap()
}

fn read_all<R: Read>(reader: &mut CaptureReader<R>) -> Vec<StreamItem> {
    let mut items = Vec::new();
    while let Some(item) = reader.next_item().unwrap() {
        items.push(item);
    }
    items
}

fn frame_ranges(data: &[u8]) -> Vec<(usize, usize)> {
    let mut frames = Vec::new();
    let mut offset = HEADER_BYTES;
    while offset < data.len() {
        let length = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
        let end = offset + FRAME_OVERHEAD_BYTES + length;
        frames.push((offset, end));
        offset = end;
    }
    assert_eq!(offset, data.len());
    frames
}

fn rehash_header(data: &mut [u8]) {
    let digest: [u8; 32] = Sha256::digest(&data[..HEADER_CONTENT_BYTES]).into();
    data[HEADER_CONTENT_BYTES..HEADER_BYTES].copy_from_slice(&digest);
}

fn rehash_frame(data: &mut [u8], start: usize, end: usize) {
    let digest: [u8; 32] = Sha256::digest(&data[start..end - 32]).into();
    data[end - 32..end].copy_from_slice(&digest);
}

struct ShortRead {
    input: Cursor<Vec<u8>>,
    calls: usize,
}

impl Read for ShortRead {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.calls += 1;
        if self.calls.is_multiple_of(4) {
            return Err(io::Error::from(io::ErrorKind::Interrupted));
        }
        let count = buffer.len().min(3);
        self.input.read(&mut buffer[..count])
    }
}

#[test]
fn binary_reconnect_and_gap_round_trip_with_exact_v1_layout_and_prefix_digest() {
    let items = sample();
    let (data, summary) = record(&items);
    assert_eq!(&data[..8], MAGIC);
    assert_eq!(&data[8..12], &[1, 0, 0, 0]);
    assert_eq!(&data[12..28], header().session_id.as_bytes());
    assert_eq!(data[28], 0);
    assert_eq!(&data[29..37], &1_u64.to_le_bytes());
    assert_eq!(summary.event_count, 12);
    assert_eq!(summary.gap_count, 1);
    assert_eq!(summary.byte_count, 19);
    let frames = frame_ranges(&data);
    let footer_start = frames.last().unwrap().0;
    assert_eq!(
        summary.digest,
        <[u8; 32]>::from(Sha256::digest(&data[..footer_start]))
    );
    for (start, end) in &frames {
        let checksum: [u8; 32] = Sha256::digest(&data[*start..*end - 32]).into();
        assert_eq!(data[*end - 32..*end], checksum);
    }
    let input = ShortRead {
        input: Cursor::new(data.clone()),
        calls: 0,
    };
    let mut reader = CaptureReader::new(input).unwrap();
    assert_eq!(reader.header(), &header());
    assert_eq!(reader.status(), CaptureReadStatus::Reading);
    assert_eq!(reader.verified_offset(), HEADER_BYTES as u64);
    for (index, item) in items.iter().enumerate() {
        assert_eq!(reader.next_item().unwrap().as_ref(), Some(item));
        assert_eq!(reader.verified_offset(), frames[index].1 as u64);
    }
    assert_eq!(reader.next_item().unwrap(), None);
    assert_eq!(reader.status(), CaptureReadStatus::Complete);
    assert_eq!(reader.summary(), &summary);
    assert_eq!(reader.verified_offset(), data.len() as u64);
    assert_eq!(reader.next_item().unwrap(), None);
}

#[test]
fn finishing_empty_or_still_connected_records_does_not_invent_a_session_close() {
    let items = sample();
    for prefix in [&items[..0], &items[..2]] {
        let (data, summary) = record(prefix);
        let mut reader = CaptureReader::new(data.as_slice()).unwrap();
        assert_eq!(read_all(&mut reader), prefix);
        assert_eq!(reader.status(), CaptureReadStatus::Complete);
        assert_eq!(reader.summary(), &summary);
    }
    let payload = vec![0xff; MAX_EVENT_BYTES];
    let large = vec![
        connection(1, 1, ConnectionState::Connected),
        bytes(2, 1, Direction::Rx, 0, &payload),
    ];
    let (data, summary) = record(&large);
    let mut reader = CaptureReader::new(data.as_slice()).unwrap();
    assert_eq!(read_all(&mut reader), large);
    assert_eq!(reader.summary(), &summary);
}

#[test]
fn every_truncation_boundary_reports_actual_eof_and_only_yields_complete_verified_items() {
    let items = sample();
    let (data, _) = record(&items);
    let frames = frame_ranges(&data);
    for cut in 0..data.len() {
        let truncated = &data[..cut];
        if cut < HEADER_BYTES {
            assert!(CaptureReader::new(truncated).is_err(), "header cut {cut}");
            assert!(
                CaptureReader::new_recovering(truncated).is_err(),
                "header cut {cut}"
            );
            continue;
        }
        let accepted = frames[..items.len()]
            .iter()
            .filter(|(_, end)| *end <= cut)
            .count();
        let expected_offset = if accepted == 0 {
            HEADER_BYTES
        } else {
            frames[accepted - 1].1
        };
        let mut strict = CaptureReader::new(truncated).unwrap();
        for item in &items[..accepted] {
            assert_eq!(
                strict.next_item().unwrap().as_ref(),
                Some(item),
                "cut {cut}"
            );
        }
        assert_eq!(
            strict.next_item().unwrap_err().code,
            ErrorCode::StorageCorrupt,
            "cut {cut}"
        );
        assert_eq!(
            strict.status(),
            CaptureReadStatus::Incomplete { offset: cut as u64 }
        );
        assert_eq!(strict.verified_offset(), expected_offset as u64);
        let mut recovering = CaptureReader::new_recovering(truncated).unwrap();
        assert_eq!(read_all(&mut recovering), items[..accepted], "cut {cut}");
        assert_eq!(recovering.status(), strict.status());
        assert_eq!(recovering.summary(), strict.summary());
        assert_eq!(recovering.verified_offset(), expected_offset as u64);
        let digest: [u8; 32] = Sha256::digest(&data[..expected_offset]).into();
        assert_eq!(recovering.summary().digest, digest);
        assert_eq!(recovering.next_item().unwrap(), None);
    }
}

#[test]
fn corrupt_frame_does_not_scan_past_it_even_when_its_payload_contains_capture_magic() {
    let items = sample();
    let (mut data, _) = record(&items);
    let frames = frame_ranges(&data);
    let bad_index = 8;
    let (start, end) = frames[bad_index];
    data[end - 1] ^= 0x40;
    let mut strict = CaptureReader::new(data.as_slice()).unwrap();
    for item in &items[..bad_index] {
        assert_eq!(strict.next_item().unwrap().as_ref(), Some(item));
    }
    assert_eq!(
        strict.next_item().unwrap_err().code,
        ErrorCode::StorageCorrupt
    );
    assert_eq!(
        strict.status(),
        CaptureReadStatus::Corrupt {
            offset: start as u64
        }
    );
    assert_eq!(strict.verified_offset(), start as u64);
    assert_eq!(
        strict.next_item().unwrap_err().code,
        ErrorCode::StorageCorrupt
    );
    let mut recovering = CaptureReader::new_recovering(data.as_slice()).unwrap();
    assert_eq!(read_all(&mut recovering), items[..bad_index]);
    assert_eq!(recovering.status(), strict.status());
    assert_eq!(recovering.summary(), strict.summary());
    assert_eq!(recovering.verified_offset(), start as u64);
}

#[test]
fn footer_must_bind_each_total_the_full_header_and_every_complete_frame() {
    let items = sample();
    let (original, _) = record(&items);
    let frames = frame_ranges(&original);
    let (footer_start, footer_end) = *frames.last().unwrap();
    for field_offset in [5, 13, 21, 29] {
        let mut data = original.clone();
        data[footer_start + field_offset] ^= 1;
        rehash_frame(&mut data, footer_start, footer_end);
        let mut strict = CaptureReader::new(data.as_slice()).unwrap();
        for item in &items {
            assert_eq!(strict.next_item().unwrap().as_ref(), Some(item));
        }
        assert_eq!(
            strict.next_item().unwrap_err().code,
            ErrorCode::StorageCorrupt
        );
        assert_eq!(
            strict.status(),
            CaptureReadStatus::Corrupt {
                offset: footer_start as u64
            }
        );
        let mut recovering = CaptureReader::new_recovering(data.as_slice()).unwrap();
        assert_eq!(read_all(&mut recovering), items);
        assert_eq!(recovering.status(), strict.status());
        assert_eq!(recovering.verified_offset(), footer_start as u64);
    }
    // 单帧校验都合法时，改头或改历史仍必须被 footer 的累计摘要拒绝。
    for change_header in [false, true] {
        let mut data = original.clone();
        if change_header {
            data[12] ^= 1;
            rehash_header(&mut data);
        } else {
            let (start, end) = frames[1];
            data[start + 4 + BYTE_PREFIX_LENGTH] ^= 1;
            rehash_frame(&mut data, start, end);
        }
        let mut reader = CaptureReader::new_recovering(data.as_slice()).unwrap();
        assert_eq!(read_all(&mut reader).len(), items.len());
        assert_eq!(
            reader.status(),
            CaptureReadStatus::Corrupt {
                offset: footer_start as u64
            }
        );
    }
}

#[test]
fn footer_hash_and_trailing_garbage_cannot_be_reported_as_complete() {
    let items = sample();
    let (original, _) = record(&items);
    let footer_start = frame_ranges(&original).last().unwrap().0;
    let mut bad_hash = original.clone();
    *bad_hash.last_mut().unwrap() ^= 1;
    let mut reader = CaptureReader::new_recovering(bad_hash.as_slice()).unwrap();
    assert_eq!(read_all(&mut reader), items);
    assert_eq!(
        reader.status(),
        CaptureReadStatus::Corrupt {
            offset: footer_start as u64
        }
    );

    let mut trailing = original.clone();
    trailing.extend_from_slice(MAGIC);
    let mut strict = CaptureReader::new(trailing.as_slice()).unwrap();
    for item in &items {
        assert_eq!(strict.next_item().unwrap().as_ref(), Some(item));
    }
    assert_eq!(
        strict.next_item().unwrap_err().code,
        ErrorCode::StorageCorrupt
    );
    assert_eq!(
        strict.status(),
        CaptureReadStatus::Corrupt {
            offset: original.len() as u64
        }
    );
    let mut recovering = CaptureReader::new_recovering(trailing.as_slice()).unwrap();
    assert_eq!(read_all(&mut recovering), items);
    assert_eq!(recovering.status(), strict.status());
    assert_eq!(recovering.verified_offset(), footer_start as u64);
}

#[test]
fn future_header_fields_and_unknown_tags_are_errors_even_for_explicit_recovery() {
    let (original, _) = record(&sample());
    for (offset, value) in [(8, 2), (10, 1), (28, 1)] {
        let mut data = original.clone();
        data[offset] = value;
        rehash_header(&mut data);
        assert_eq!(
            CaptureReader::new(data.as_slice()).err().unwrap().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            CaptureReader::new_recovering(data.as_slice())
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgument
        );
    }
    for offset in [0, HEADER_CONTENT_BYTES] {
        let mut data = original.clone();
        data[offset] ^= 1;
        assert_eq!(
            CaptureReader::new_recovering(data.as_slice())
                .err()
                .unwrap()
                .code,
            ErrorCode::StorageCorrupt
        );
    }
    let mut data = original.clone();
    data[29..37].copy_from_slice(&2_u64.to_le_bytes());
    rehash_header(&mut data);
    assert_eq!(
        CaptureReader::new_recovering(data.as_slice())
            .err()
            .unwrap()
            .code,
        ErrorCode::StorageCorrupt
    );

    let (start, end) = frame_ranges(&original)[0];
    let mut unknown = original.clone();
    unknown[start + 4] = 77;
    rehash_frame(&mut unknown, start, end);
    for recovering in [false, true] {
        let mut reader = if recovering {
            CaptureReader::new_recovering(unknown.as_slice()).unwrap()
        } else {
            CaptureReader::new(unknown.as_slice()).unwrap()
        };
        assert_eq!(
            reader.next_item().unwrap_err().code,
            ErrorCode::InvalidArgument
        );
        assert_eq!(
            reader.status(),
            CaptureReadStatus::Failed {
                offset: start as u64
            }
        );
        assert_eq!(reader.verified_offset(), HEADER_BYTES as u64);
        assert_eq!(
            reader.next_item().unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
}

#[test]
fn huge_declared_lengths_are_rejected_without_reading_or_allocating_the_body() {
    let (original, _) = record(&[]);
    for length in [0, u32::MAX, MAX_FRAME_BYTES as u32] {
        let mut data = original[..HEADER_BYTES].to_vec();
        data.extend_from_slice(&length.to_le_bytes());
        let mut reader = CaptureReader::new_recovering(data.as_slice()).unwrap();
        assert_eq!(reader.next_item().unwrap(), None);
        assert_eq!(
            reader.status(),
            CaptureReadStatus::Corrupt {
                offset: HEADER_BYTES as u64
            }
        );
        assert_eq!(reader.verified_offset(), HEADER_BYTES as u64);
    }
    let mut oversized = original[..HEADER_BYTES].to_vec();
    oversized.extend_from_slice(&((BYTE_PREFIX_LENGTH + MAX_EVENT_BYTES + 1) as u32).to_le_bytes());
    oversized.push(2);
    let mut reader = CaptureReader::new_recovering(oversized.as_slice()).unwrap();
    assert_eq!(reader.next_item().unwrap(), None);
    assert_eq!(
        reader.status(),
        CaptureReadStatus::Corrupt {
            offset: HEADER_BYTES as u64
        }
    );
}

#[test]
fn valid_frame_hashes_do_not_bypass_event_state_offset_or_payload_validation() {
    let items = sample();
    let (original, _) = record(&items);
    let frames = frame_ranges(&original);
    for (index, field_offset, replacement) in [
        (1, 4 + 25, vec![9]),
        (1, 4 + 34, u32::MAX.to_le_bytes().to_vec()),
        (1, 4 + 1, 3_u64.to_le_bytes().to_vec()),
        (1, 4 + 26, 1_u64.to_le_bytes().to_vec()),
        (1, 4 + 17, 0_u64.to_le_bytes().to_vec()),
        (4, 4 + 9, 3_u64.to_le_bytes().to_vec()),
        (5, 4 + 9, 1_u64.to_le_bytes().to_vec()),
        (9, 4 + 25, vec![9]),
    ] {
        let (start, end) = frames[index];
        let mut data = original.clone();
        data[start + field_offset..start + field_offset + replacement.len()]
            .copy_from_slice(&replacement);
        rehash_frame(&mut data, start, end);
        let mut reader = CaptureReader::new_recovering(data.as_slice()).unwrap();
        assert_eq!(read_all(&mut reader), items[..index]);
        assert_eq!(
            reader.status(),
            CaptureReadStatus::Corrupt {
                offset: start as u64
            }
        );
        assert_eq!(reader.verified_offset(), start as u64);
    }
}

struct FailingRead {
    input: Cursor<Vec<u8>>,
    fail_at: usize,
    calls: Rc<Cell<usize>>,
}

impl Read for FailingRead {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.calls.set(self.calls.get() + 1);
        let position = self.input.position() as usize;
        if position >= self.fail_at {
            return Err(io::Error::other("injected read failure"));
        }
        let count = buffer.len().min(self.fail_at - position);
        self.input.read(&mut buffer[..count])
    }
}

#[test]
fn io_errors_are_fatal_and_terminal_instead_of_a_recovered_or_complete_capture() {
    let items = sample();
    let (data, _) = record(&items);
    let frames = frame_ranges(&data);
    for fail_at in [0, HEADER_BYTES + 5, frames[0].1 + 6, data.len()] {
        let calls = Rc::new(Cell::new(0));
        let input = FailingRead {
            input: Cursor::new(data.clone()),
            fail_at,
            calls: Rc::clone(&calls),
        };
        let opened = CaptureReader::new_recovering(input);
        if fail_at < HEADER_BYTES {
            assert_eq!(opened.err().unwrap().code, ErrorCode::StorageIo);
            continue;
        }
        let mut reader = opened.unwrap();
        let accepted = frames[..items.len()]
            .iter()
            .filter(|(_, end)| *end <= fail_at)
            .count();
        for item in &items[..accepted] {
            assert_eq!(reader.next_item().unwrap().as_ref(), Some(item));
        }
        assert_eq!(reader.next_item().unwrap_err().code, ErrorCode::StorageIo);
        let failure_offset = if fail_at == data.len() {
            fail_at
        } else {
            frames[accepted].0
        };
        assert_eq!(
            reader.status(),
            CaptureReadStatus::Failed {
                offset: failure_offset as u64
            }
        );
        let previous_calls = calls.get();
        assert_eq!(reader.next_item().unwrap_err().code, ErrorCode::StorageIo);
        assert_eq!(calls.get(), previous_calls);
    }
}
