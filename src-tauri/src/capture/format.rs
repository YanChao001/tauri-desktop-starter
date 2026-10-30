use std::io::{self, Write};

use sha2::{Digest, Sha256};

use crate::device::model::{ConnectionState, DeviceEventKind, DeviceSource, Direction, StreamItem};
use crate::error::{ErrorCode, NativeError, NativeResult};

use super::model::{
    CaptureHeader, CaptureSummary, MAX_CAPTURE_BYTES, MAX_FRAME_BYTES, StreamValidation,
};

pub(super) const MAGIC: &[u8; 8] = b"DVCAP\r\n\x1a";
pub(super) const VERSION: u16 = 1;
pub(super) const HEADER_CONTENT_BYTES: usize = 37;
pub(super) const HEADER_BYTES: usize = HEADER_CONTENT_BYTES + 32;
pub(super) const FRAME_OVERHEAD_BYTES: usize = 4 + 32;
pub(super) const TAG_CONNECTION: u8 = 1;
pub(super) const TAG_BYTES: u8 = 2;
pub(super) const TAG_GAP: u8 = 3;
pub(super) const TAG_FOOTER: u8 = 255;
pub(super) const CONNECTION_LENGTH: usize = 1 + 24 + 1;
pub(super) const BYTE_PREFIX_LENGTH: usize = 1 + 24 + 1 + 8 + 4;
pub(super) const GAP_LENGTH: usize = 1 + 16;
pub(super) const FOOTER_LENGTH: usize = 1 + 24 + 32;
const FOOTER_FRAME_BYTES: usize = FRAME_OVERHEAD_BYTES + FOOTER_LENGTH;

/// v1 的整数均为小端；session 与 source 只在固定头中出现。
/// 头为 magic(8)、version(2)、flags(2)、session(16)、source(1)、first_sequence(8)、SHA-256(32)。
/// 帧的 length 计入 tag + body，不计自身 4 字节及末尾 32 字节 SHA-256。
/// SHA-256 只检测损坏，不提供来源认证；finish 仅调用 Write::flush，不保证磁盘同步。
pub struct CaptureWriter<W: Write> {
    output: W,
    header: CaptureHeader,
    validation: StreamValidation,
    digest: Sha256,
    summary: CaptureSummary,
    written: u64,
    poisoned: bool,
}

impl<W: Write> CaptureWriter<W> {
    pub fn new(mut output: W, header: CaptureHeader) -> NativeResult<Self> {
        let encoded = encode_header(&header)?;
        output
            .write_all(&encoded)
            .map_err(|error| write_error("Cannot write capture header", error))?;
        let mut digest = Sha256::new();
        digest.update(encoded);
        let validation = StreamValidation::new(&header);
        let summary = validation.counts.summary(digest_snapshot(&digest));
        Ok(Self {
            output,
            header,
            validation,
            digest,
            summary,
            written: HEADER_BYTES as u64,
            poisoned: false,
        })
    }

    pub fn header(&self) -> &CaptureHeader {
        &self.header
    }

    pub fn summary(&self) -> &CaptureSummary {
        &self.summary
    }

    /// 无效输入和额度拒绝不写入、不推进摘要；任何写入故障都会永久阻止继续录制。
    pub fn append(&mut self, item: &StreamItem) -> NativeResult<()> {
        self.ensure_writable()?;
        let next = self.validation.next(item)?;
        let content_length = item_content_length(item);
        let frame_bytes = FRAME_OVERHEAD_BYTES + content_length;
        if frame_bytes > MAX_FRAME_BYTES {
            return Err(limit("Capture frame exceeds its byte budget"));
        }
        let end = checked_end(self.written, frame_bytes, true)
            .ok_or_else(|| limit("Capture exceeds its file budget including the footer"))?;
        let encoded = encode_item(item, content_length);
        if let Err(error) = self.output.write_all(&encoded) {
            self.poisoned = true;
            return Err(write_error("Cannot append capture frame", error));
        }
        self.digest.update(&encoded);
        self.validation = next;
        self.summary = next.counts.summary(digest_snapshot(&self.digest));
        self.written = end;
        Ok(())
    }

    /// 结束录制不要求会话 Closed；会话可以继续供其它读取者使用。
    pub fn finish(mut self) -> NativeResult<(W, CaptureSummary)> {
        self.ensure_writable()?;
        let summary = self.summary;
        checked_end(self.written, FOOTER_FRAME_BYTES, false)
            .ok_or_else(|| limit("Capture footer exceeds its file budget"))?;
        let encoded = encode_footer(summary);
        if let Err(error) = self.output.write_all(&encoded) {
            self.poisoned = true;
            return Err(write_error("Cannot write capture footer", error));
        }
        if let Err(error) = self.output.flush() {
            self.poisoned = true;
            return Err(write_error("Cannot flush capture", error));
        }
        Ok((self.output, summary))
    }

    fn ensure_writable(&self) -> NativeResult<()> {
        if self.poisoned {
            return Err(NativeError::new(
                ErrorCode::StorageIo,
                "Capture writer cannot continue after an I/O failure",
            ));
        }
        Ok(())
    }
}

fn encode_header(header: &CaptureHeader) -> NativeResult<[u8; HEADER_BYTES]> {
    header.validate()?;
    let mut encoded = [0; HEADER_BYTES];
    encoded[..8].copy_from_slice(MAGIC);
    encoded[8..10].copy_from_slice(&VERSION.to_le_bytes());
    // flags=0，Virtual=0；任何未来取值都必须显式拒绝。
    encoded[12..28].copy_from_slice(header.session_id.as_bytes());
    encoded[28] = match header.source {
        DeviceSource::Virtual => 0,
    };
    encoded[29..37].copy_from_slice(&header.first_sequence.to_le_bytes());
    let checksum: [u8; 32] = Sha256::digest(&encoded[..HEADER_CONTENT_BYTES]).into();
    encoded[HEADER_CONTENT_BYTES..].copy_from_slice(&checksum);
    Ok(encoded)
}

fn item_content_length(item: &StreamItem) -> usize {
    match item {
        StreamItem::Event(event) => match &event.kind {
            DeviceEventKind::Connection(_) => CONNECTION_LENGTH,
            DeviceEventKind::Bytes { bytes, .. } => BYTE_PREFIX_LENGTH + bytes.len(),
        },
        StreamItem::Gap(_) => GAP_LENGTH,
    }
}

fn encode_item(item: &StreamItem, content_length: usize) -> Vec<u8> {
    let mut content = Vec::with_capacity(content_length);
    match item {
        StreamItem::Event(event) => {
            content.push(match &event.kind {
                DeviceEventKind::Connection(_) => TAG_CONNECTION,
                DeviceEventKind::Bytes { .. } => TAG_BYTES,
            });
            content.extend_from_slice(&event.sequence.to_le_bytes());
            content.extend_from_slice(&event.epoch.to_le_bytes());
            content.extend_from_slice(&event.timestamp_micros.to_le_bytes());
            match &event.kind {
                DeviceEventKind::Connection(state) => content.push(match state {
                    ConnectionState::Connected => 0,
                    ConnectionState::Disconnected => 1,
                    ConnectionState::Closed => 2,
                }),
                DeviceEventKind::Bytes {
                    direction,
                    offset,
                    bytes,
                } => {
                    content.push(match direction {
                        Direction::Rx => 0,
                        Direction::Tx => 1,
                    });
                    content.extend_from_slice(&offset.to_le_bytes());
                    content.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
                    content.extend_from_slice(bytes);
                }
            }
        }
        StreamItem::Gap(gap) => {
            content.push(TAG_GAP);
            content.extend_from_slice(&gap.from_sequence.to_le_bytes());
            content.extend_from_slice(&gap.to_sequence.to_le_bytes());
        }
    }
    encode_frame(&content)
}

fn encode_footer(summary: CaptureSummary) -> Vec<u8> {
    let mut content = Vec::with_capacity(FOOTER_LENGTH);
    content.push(TAG_FOOTER);
    content.extend_from_slice(&summary.event_count.to_le_bytes());
    content.extend_from_slice(&summary.byte_count.to_le_bytes());
    content.extend_from_slice(&summary.gap_count.to_le_bytes());
    content.extend_from_slice(&summary.digest);
    encode_frame(&content)
}

fn encode_frame(content: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(FRAME_OVERHEAD_BYTES + content.len());
    encoded.extend_from_slice(&(content.len() as u32).to_le_bytes());
    encoded.extend_from_slice(content);
    let checksum: [u8; 32] = Sha256::digest(&encoded).into();
    encoded.extend_from_slice(&checksum);
    encoded
}

pub(super) fn checked_end(offset: u64, frame_bytes: usize, reserve_footer: bool) -> Option<u64> {
    let end = offset.checked_add(frame_bytes as u64)?;
    let reserved_end = if reserve_footer {
        end.checked_add(FOOTER_FRAME_BYTES as u64)?
    } else {
        end
    };
    (reserved_end <= MAX_CAPTURE_BYTES).then_some(end)
}

pub(super) fn digest_snapshot(digest: &Sha256) -> [u8; 32] {
    digest.clone().finalize().into()
}

fn write_error(message: &str, error: io::Error) -> NativeError {
    NativeError::operation(ErrorCode::StorageIo, message, error)
}

fn limit(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InputTooLong, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::model::MAX_CAPTURE_ITEMS;
    use crate::device::model::{DeviceEvent, MAX_EVENT_BYTES, SessionId, StreamGap};

    fn header() -> CaptureHeader {
        CaptureHeader::new(SessionId::from_bytes([4; 16]), DeviceSource::Virtual)
    }

    fn connected() -> StreamItem {
        StreamItem::Event(DeviceEvent {
            session_id: header().session_id,
            sequence: 1,
            epoch: 1,
            timestamp_micros: 10,
            kind: DeviceEventKind::Connection(ConnectionState::Connected),
        })
    }

    fn payload(bytes: Vec<u8>) -> StreamItem {
        StreamItem::Event(DeviceEvent {
            session_id: header().session_id,
            sequence: 2,
            epoch: 1,
            timestamp_micros: 20,
            kind: DeviceEventKind::Bytes {
                direction: Direction::Rx,
                offset: 0,
                bytes,
            },
        })
    }

    #[derive(Debug)]
    struct FailingWriter {
        bytes: Vec<u8>,
        remaining: usize,
        write_calls: usize,
        fail_flush: bool,
    }

    impl FailingWriter {
        fn new(remaining: usize, fail_flush: bool) -> Self {
            Self {
                bytes: Vec::new(),
                remaining,
                write_calls: 0,
                fail_flush,
            }
        }
    }

    impl Write for FailingWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.write_calls += 1;
            if self.remaining == 0 {
                return Err(io::Error::other("injected write failure"));
            }
            let count = self.remaining.min(buffer.len());
            self.bytes.extend_from_slice(&buffer[..count]);
            self.remaining -= count;
            Ok(count)
        }

        fn flush(&mut self) -> io::Result<()> {
            if self.fail_flush {
                Err(io::Error::other("injected flush failure"))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn invalid_append_leaves_bytes_sequence_counts_and_digest_unchanged() {
        let mut writer = CaptureWriter::new(Vec::new(), header()).unwrap();
        writer.append(&connected()).unwrap();
        let previous_bytes = writer.output.clone();
        let previous_summary = *writer.summary();
        let mut foreign = payload(vec![1]);
        if let StreamItem::Event(event) = &mut foreign {
            event.session_id = SessionId::from_bytes([5; 16]);
        }
        let mut discontinuous = payload(vec![1]);
        if let StreamItem::Event(DeviceEvent {
            kind: DeviceEventKind::Bytes { offset, .. },
            ..
        }) = &mut discontinuous
        {
            *offset = 1;
        }
        let invalid_gap = StreamItem::Gap(StreamGap {
            session_id: header().session_id,
            from_sequence: 3,
            to_sequence: 5,
        });
        for (item, code) in [
            (connected(), ErrorCode::InvalidArgument),
            (foreign, ErrorCode::InvalidArgument),
            (discontinuous, ErrorCode::InvalidArgument),
            (invalid_gap, ErrorCode::InvalidArgument),
            (payload(Vec::new()), ErrorCode::InvalidArgument),
            (
                payload(vec![0; MAX_EVENT_BYTES + 1]),
                ErrorCode::InputTooLong,
            ),
        ] {
            assert_eq!(writer.append(&item).unwrap_err().code, code);
            assert_eq!(writer.output, previous_bytes);
            assert_eq!(*writer.summary(), previous_summary);
        }
        writer.append(&payload(vec![0, 0xff])).unwrap();
        let (_, summary) = writer.finish().unwrap();
        assert_eq!(summary.event_count, 2);
        assert_eq!(summary.byte_count, 2);
    }

    #[test]
    fn footer_space_and_item_limits_are_checked_before_allocating_or_writing_frames() {
        let mut writer = CaptureWriter::new(Vec::new(), header()).unwrap();
        let frame_bytes = FRAME_OVERHEAD_BYTES + CONNECTION_LENGTH;
        // 固定状态直接覆盖额度边界，避免测试实际写入 256 MiB 或一百万个帧。
        writer.written = MAX_CAPTURE_BYTES - FOOTER_FRAME_BYTES as u64 - frame_bytes as u64;
        writer.append(&connected()).unwrap();
        assert_eq!(
            writer.written + FOOTER_FRAME_BYTES as u64,
            MAX_CAPTURE_BYTES
        );
        let previous_bytes = writer.output.clone();
        let previous_summary = *writer.summary();
        assert_eq!(
            writer.append(&payload(vec![1])).unwrap_err().code,
            ErrorCode::InputTooLong
        );
        assert_eq!(writer.output, previous_bytes);
        assert_eq!(*writer.summary(), previous_summary);
        assert!(writer.finish().is_ok());

        let mut writer = CaptureWriter::new(Vec::new(), header()).unwrap();
        writer.validation.counts.event_count = MAX_CAPTURE_ITEMS;
        let previous_bytes = writer.output.clone();
        assert_eq!(
            writer.append(&connected()).unwrap_err().code,
            ErrorCode::InputTooLong
        );
        assert_eq!(writer.output, previous_bytes);
        assert!(checked_end(u64::MAX, frame_bytes, true).is_none());
        assert!(
            checked_end(
                MAX_CAPTURE_BYTES - FOOTER_FRAME_BYTES as u64 + 1,
                FOOTER_FRAME_BYTES,
                false
            )
            .is_none()
        );
    }

    #[test]
    fn partial_write_permanently_poisoned_writer_cannot_finish_a_false_success() {
        let output = FailingWriter::new(usize::MAX, false);
        let mut writer = CaptureWriter::new(output, header()).unwrap();
        let previous_summary = *writer.summary();
        writer.output.remaining = 5;
        assert_eq!(
            writer.append(&connected()).unwrap_err().code,
            ErrorCode::StorageIo
        );
        assert_eq!(writer.output.bytes.len(), HEADER_BYTES + 5);
        assert_eq!(*writer.summary(), previous_summary);
        let calls = writer.output.write_calls;
        assert_eq!(
            writer.append(&connected()).unwrap_err().code,
            ErrorCode::StorageIo
        );
        assert_eq!(writer.output.write_calls, calls);
        assert_eq!(writer.finish().unwrap_err().code, ErrorCode::StorageIo);
    }

    #[test]
    fn header_footer_and_flush_failures_never_return_a_completed_capture() {
        assert_eq!(
            CaptureWriter::new(FailingWriter::new(HEADER_BYTES - 1, false), header())
                .err()
                .unwrap()
                .code,
            ErrorCode::StorageIo
        );
        let output = FailingWriter::new(HEADER_BYTES + FOOTER_FRAME_BYTES - 1, false);
        let writer = CaptureWriter::new(output, header()).unwrap();
        assert_eq!(writer.finish().unwrap_err().code, ErrorCode::StorageIo);
        let writer = CaptureWriter::new(FailingWriter::new(usize::MAX, true), header()).unwrap();
        assert_eq!(writer.finish().unwrap_err().code, ErrorCode::StorageIo);

        let mut invalid_header = header();
        invalid_header.first_sequence = 2;
        assert_eq!(
            CaptureWriter::new(Vec::new(), invalid_header)
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgument
        );
    }
}
