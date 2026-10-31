use std::io::{self, Read};

use sha2::{Digest, Sha256};

use crate::device::model::{
    ConnectionState, DeviceEvent, DeviceEventKind, DeviceSource, Direction, MAX_EVENT_BYTES,
    SessionId, StreamGap, StreamItem,
};
use crate::error::{ErrorCode, NativeError, NativeResult};

use super::format::{
    BYTE_PREFIX_LENGTH, CONNECTION_LENGTH, FOOTER_LENGTH, FRAME_OVERHEAD_BYTES, GAP_LENGTH,
    HEADER_BYTES, HEADER_CONTENT_BYTES, MAGIC, TAG_BYTES, TAG_CONNECTION, TAG_FOOTER, TAG_GAP,
    VERSION, checked_end, digest_snapshot,
};
use super::model::{
    CaptureHeader, CaptureReadStatus, CaptureSummary, Counts, MAX_FRAME_BYTES, StreamValidation,
};

#[derive(Debug, Clone, Copy)]
enum FailureKind {
    Incomplete,
    Corrupt,
    Fatal,
}

struct ReadFailure {
    kind: FailureKind,
    offset: u64,
    error: NativeError,
}

impl ReadFailure {
    fn incomplete(offset: u64) -> Self {
        Self {
            kind: FailureKind::Incomplete,
            offset,
            error: NativeError::new(
                ErrorCode::StorageCorrupt,
                "Capture ended before a complete frame and footer",
            ),
        }
    }

    fn corrupt(offset: u64, message: impl Into<String>) -> Self {
        Self {
            kind: FailureKind::Corrupt,
            offset,
            error: NativeError::new(ErrorCode::StorageCorrupt, message),
        }
    }

    fn unsupported(offset: u64, message: &str) -> Self {
        Self {
            kind: FailureKind::Fatal,
            offset,
            error: NativeError::new(ErrorCode::InvalidArgument, message),
        }
    }

    fn io(offset: u64, error: io::Error) -> Self {
        Self {
            kind: FailureKind::Fatal,
            offset,
            error: NativeError::operation(ErrorCode::StorageIo, "Cannot read capture", error),
        }
    }

    fn recoverable(&self) -> bool {
        !matches!(self.kind, FailureKind::Fatal)
    }

    fn status(&self) -> CaptureReadStatus {
        match self.kind {
            FailureKind::Incomplete => CaptureReadStatus::Incomplete {
                offset: self.offset,
            },
            FailureKind::Corrupt => CaptureReadStatus::Corrupt {
                offset: self.offset,
            },
            FailureKind::Fatal => CaptureReadStatus::Failed {
                offset: self.offset,
            },
        }
    }
}

enum ReadState {
    Reading,
    Complete,
    Stopped(ReadFailure),
}

/// 只读回放源：只依赖公共事件值类型，不持有设备、发送队列或任何输出回调。
/// 逐帧接纳的事件是已验证前缀；消费到 None 后仍须检查 status，不能提前宣称记录完整。
pub struct CaptureReader<R: Read> {
    input: R,
    header: CaptureHeader,
    validation: StreamValidation,
    digest: Sha256,
    summary: CaptureSummary,
    position: u64,
    verified_offset: u64,
    recovering: bool,
    state: ReadState,
}

impl<R: Read> CaptureReader<R> {
    /// 默认严格模式；无 footer、半帧、损坏或尾后垃圾均返回错误。
    pub fn new(input: R) -> NativeResult<Self> {
        Self::open(input, false)
    }

    /// 只恢复已验证头之后的完整前缀，不扫描 payload 寻找新帧、不修改原件。
    /// 不支持的版本、flags、source、tag 和 I/O 错误仍返回错误，不作为恢复成功。
    pub fn new_recovering(input: R) -> NativeResult<Self> {
        Self::open(input, true)
    }

    pub fn header(&self) -> &CaptureHeader {
        &self.header
    }

    pub fn summary(&self) -> &CaptureSummary {
        &self.summary
    }

    /// 最后已接纳的完整头／帧之后的偏移；失败不推进，Complete 时包含 footer。
    pub fn verified_offset(&self) -> u64 {
        self.verified_offset
    }

    pub fn status(&self) -> CaptureReadStatus {
        match &self.state {
            ReadState::Reading => CaptureReadStatus::Reading,
            ReadState::Complete => CaptureReadStatus::Complete,
            ReadState::Stopped(failure) => failure.status(),
        }
    }

    /// 严格错误和恢复停止原因均保留；重复读取不会继续访问底层流。
    pub fn error(&self) -> Option<&NativeError> {
        match &self.state {
            ReadState::Stopped(failure) => Some(&failure.error),
            _ => None,
        }
    }

    pub fn next_item(&mut self) -> NativeResult<Option<StreamItem>> {
        match &self.state {
            ReadState::Complete => return Ok(None),
            ReadState::Stopped(failure) => {
                return if self.recovering && failure.recoverable() {
                    Ok(None)
                } else {
                    Err(failure.error.clone())
                };
            }
            ReadState::Reading => {}
        }
        match self.read_next() {
            Ok(Some(item)) => Ok(Some(item)),
            Ok(None) => {
                self.state = ReadState::Complete;
                Ok(None)
            }
            Err(failure) => {
                let result = if self.recovering && failure.recoverable() {
                    Ok(None)
                } else {
                    Err(failure.error.clone())
                };
                self.state = ReadState::Stopped(failure);
                result
            }
        }
    }

    fn open(mut input: R, recovering: bool) -> NativeResult<Self> {
        let mut position = 0;
        let (header, encoded) =
            read_header(&mut input, &mut position).map_err(|failure| failure.error)?;
        let mut digest = Sha256::new();
        digest.update(encoded);
        let validation = StreamValidation::new(&header);
        let summary = validation.counts.summary(digest_snapshot(&digest));
        Ok(Self {
            input,
            header,
            validation,
            digest,
            summary,
            position,
            verified_offset: position,
            recovering,
            state: ReadState::Reading,
        })
    }

    fn read_next(&mut self) -> Result<Option<StreamItem>, ReadFailure> {
        let offset = self.position;
        let frame = read_frame(&mut self.input, &mut self.position, self.validation.counts)?;
        if frame.tag == TAG_FOOTER {
            let summary = decode_footer(&frame.body, offset)?;
            if summary != self.summary {
                return Err(ReadFailure::corrupt(
                    offset,
                    "Capture footer totals or stream digest do not match its prefix",
                ));
            }
            require_eof(&mut self.input, &mut self.position)?;
            self.verified_offset = self.position;
            return Ok(None);
        }
        let item = decode_item(frame.tag, &frame.body, self.header.session_id, offset)?;
        let next = self
            .validation
            .next(&item)
            .map_err(|error| ReadFailure::corrupt(offset, error.message))?;
        frame.update_digest(&mut self.digest);
        self.validation = next;
        self.summary = next.counts.summary(digest_snapshot(&self.digest));
        self.verified_offset = self.position;
        Ok(Some(item))
    }
}

fn read_header<R: Read>(
    input: &mut R,
    position: &mut u64,
) -> Result<(CaptureHeader, [u8; HEADER_BYTES]), ReadFailure> {
    let mut encoded = [0; HEADER_BYTES];
    read_block(input, position, &mut encoded[..12], 0)?;
    if &encoded[..8] != MAGIC {
        return Err(ReadFailure::corrupt(0, "Capture magic does not match"));
    }
    if u16::from_le_bytes([encoded[8], encoded[9]]) != VERSION {
        return Err(ReadFailure::unsupported(8, "Unsupported capture version"));
    }
    if encoded[10..12] != [0, 0] {
        return Err(ReadFailure::unsupported(10, "Unsupported capture flags"));
    }
    read_block(input, position, &mut encoded[12..], 0)?;
    let checksum: [u8; 32] = Sha256::digest(&encoded[..HEADER_CONTENT_BYTES]).into();
    if encoded[HEADER_CONTENT_BYTES..] != checksum {
        return Err(ReadFailure::corrupt(
            0,
            "Capture header checksum does not match",
        ));
    }
    let mut fields = Fields::new(&encoded[12..HEADER_CONTENT_BYTES], 0);
    let session_id = SessionId::from_bytes(fields.array()?);
    let source = match fields.byte()? {
        0 => DeviceSource::Virtual,
        _ => return Err(ReadFailure::unsupported(28, "Unsupported capture source")),
    };
    let header = CaptureHeader {
        session_id,
        source,
        first_sequence: fields.u64()?,
    };
    header
        .validate()
        .map_err(|error| ReadFailure::corrupt(0, error.message))?;
    Ok((header, encoded))
}

struct Frame {
    length_bytes: [u8; 4],
    tag: u8,
    body: Vec<u8>,
    checksum: [u8; 32],
}

impl Frame {
    fn update_digest(&self, digest: &mut Sha256) {
        digest.update(self.length_bytes);
        digest.update([self.tag]);
        digest.update(&self.body);
        digest.update(self.checksum);
    }
}

fn read_frame<R: Read>(
    input: &mut R,
    position: &mut u64,
    counts: Counts,
) -> Result<Frame, ReadFailure> {
    let offset = *position;
    let mut length_bytes = [0; 4];
    read_block(input, position, &mut length_bytes, offset)?;
    let length = u32::from_le_bytes(length_bytes);
    if length == 0 || length > (MAX_FRAME_BYTES - FRAME_OVERHEAD_BYTES) as u32 {
        return Err(ReadFailure::corrupt(
            offset,
            "Capture frame length exceeds its budget",
        ));
    }
    let length = length as usize;
    let mut tag = [0];
    read_block(input, position, &mut tag, offset)?;
    let valid_length = match tag[0] {
        TAG_CONNECTION => length == CONNECTION_LENGTH,
        TAG_BYTES => {
            (BYTE_PREFIX_LENGTH + 1..=BYTE_PREFIX_LENGTH + MAX_EVENT_BYTES).contains(&length)
        }
        TAG_GAP => length == GAP_LENGTH,
        TAG_FOOTER => length == FOOTER_LENGTH,
        _ => {
            return Err(ReadFailure::unsupported(
                offset,
                "Unsupported capture frame tag",
            ));
        }
    };
    if !valid_length {
        return Err(ReadFailure::corrupt(
            offset,
            "Capture frame has an invalid length for its tag",
        ));
    }
    if checked_end(offset, length + FRAME_OVERHEAD_BYTES, tag[0] != TAG_FOOTER).is_none() {
        return Err(ReadFailure::corrupt(
            offset,
            "Capture exceeds its file budget",
        ));
    }
    if tag[0] != TAG_FOOTER {
        counts
            .ensure_item_budget()
            .map_err(|error| ReadFailure::corrupt(offset, error.message))?;
    }
    // 长度、类型和文件／事件总量先验证，再分配；常驻内存不随文件大小增长。
    let mut body = vec![0; length - 1];
    read_block(input, position, &mut body, offset)?;
    let mut checksum = [0; 32];
    read_block(input, position, &mut checksum, offset)?;
    let frame = Frame {
        length_bytes,
        tag: tag[0],
        body,
        checksum,
    };
    let mut digest = Sha256::new();
    digest.update(frame.length_bytes);
    digest.update([frame.tag]);
    digest.update(&frame.body);
    if digest_snapshot(&digest) != frame.checksum {
        return Err(ReadFailure::corrupt(
            offset,
            "Capture frame checksum does not match",
        ));
    }
    Ok(frame)
}

fn decode_item(
    tag: u8,
    body: &[u8],
    session_id: SessionId,
    offset: u64,
) -> Result<StreamItem, ReadFailure> {
    let mut fields = Fields::new(body, offset);
    if tag == TAG_GAP {
        return Ok(StreamItem::Gap(StreamGap {
            session_id,
            from_sequence: fields.u64()?,
            to_sequence: fields.u64()?,
        }));
    }
    let sequence = fields.u64()?;
    let epoch = fields.u64()?;
    let timestamp_micros = fields.u64()?;
    let kind = if tag == TAG_CONNECTION {
        let state = match fields.byte()? {
            0 => ConnectionState::Connected,
            1 => ConnectionState::Disconnected,
            2 => ConnectionState::Closed,
            _ => {
                return Err(ReadFailure::corrupt(
                    offset,
                    "Capture connection state is invalid",
                ));
            }
        };
        DeviceEventKind::Connection(state)
    } else {
        let direction = match fields.byte()? {
            0 => Direction::Rx,
            1 => Direction::Tx,
            _ => {
                return Err(ReadFailure::corrupt(
                    offset,
                    "Capture byte direction is invalid",
                ));
            }
        };
        let byte_offset = fields.u64()?;
        let byte_count = fields.u32()?;
        if byte_count == 0
            || byte_count > MAX_EVENT_BYTES as u32
            || byte_count as usize != fields.remaining().len()
        {
            return Err(ReadFailure::corrupt(
                offset,
                "Capture payload length does not match its frame",
            ));
        }
        DeviceEventKind::Bytes {
            direction,
            offset: byte_offset,
            bytes: fields.remaining().to_vec(),
        }
    };
    Ok(StreamItem::Event(DeviceEvent {
        session_id,
        sequence,
        epoch,
        timestamp_micros,
        kind,
    }))
}

fn decode_footer(body: &[u8], offset: u64) -> Result<CaptureSummary, ReadFailure> {
    let mut fields = Fields::new(body, offset);
    Ok(CaptureSummary {
        event_count: fields.u64()?,
        byte_count: fields.u64()?,
        gap_count: fields.u64()?,
        digest: fields.array()?,
    })
}

struct Fields<'a> {
    remaining: &'a [u8],
    offset: u64,
}

impl<'a> Fields<'a> {
    fn new(remaining: &'a [u8], offset: u64) -> Self {
        Self { remaining, offset }
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], ReadFailure> {
        let field = self.remaining.get(..N).ok_or_else(|| {
            ReadFailure::corrupt(self.offset, "Capture frame is missing a fixed field")
        })?;
        let mut result = [0; N];
        result.copy_from_slice(field);
        self.remaining = &self.remaining[N..];
        Ok(result)
    }

    fn byte(&mut self) -> Result<u8, ReadFailure> {
        Ok(self.array::<1>()?[0])
    }

    fn u32(&mut self) -> Result<u32, ReadFailure> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    fn u64(&mut self) -> Result<u64, ReadFailure> {
        Ok(u64::from_le_bytes(self.array()?))
    }

    fn remaining(&self) -> &[u8] {
        self.remaining
    }
}

fn read_block<R: Read>(
    input: &mut R,
    position: &mut u64,
    mut buffer: &mut [u8],
    frame_offset: u64,
) -> Result<(), ReadFailure> {
    while !buffer.is_empty() {
        match input.read(buffer) {
            Ok(0) => return Err(ReadFailure::incomplete(*position)),
            Ok(count) => {
                *position += count as u64;
                buffer = &mut buffer[count..];
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(ReadFailure::io(frame_offset, error)),
        }
    }
    Ok(())
}

fn require_eof<R: Read>(input: &mut R, position: &mut u64) -> Result<(), ReadFailure> {
    let offset = *position;
    loop {
        match input.read(&mut [0]) {
            Ok(0) => return Ok(()),
            Ok(count) => {
                *position += count as u64;
                return Err(ReadFailure::corrupt(
                    offset,
                    "Capture has data after its footer",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(ReadFailure::io(offset, error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::{CaptureWriter, MAX_CAPTURE_BYTES, MAX_CAPTURE_ITEMS};

    struct PrefixOnly<'a>(&'a [u8]);

    impl Read for PrefixOnly<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            assert!(
                !self.0.is_empty(),
                "body must not be read after rejecting a resource limit"
            );
            self.0.read(buffer)
        }
    }

    #[test]
    fn reader_checks_event_and_file_budgets_before_reading_any_frame_body() {
        let length = BYTE_PREFIX_LENGTH + 1;
        let mut prefix = [0; 5];
        prefix[..4].copy_from_slice(&(length as u32).to_le_bytes());
        prefix[4] = TAG_BYTES;
        let mut position = HEADER_BYTES as u64;
        let mut input = PrefixOnly(&prefix);
        let counts = Counts {
            event_count: MAX_CAPTURE_ITEMS,
            ..Counts::default()
        };
        let failure = read_frame(&mut input, &mut position, counts).err().unwrap();
        assert_eq!(
            failure.status(),
            CaptureReadStatus::Corrupt {
                offset: HEADER_BYTES as u64
            }
        );
        assert_eq!(position, (HEADER_BYTES + 5) as u64);

        let footer_bytes = FRAME_OVERHEAD_BYTES + FOOTER_LENGTH;
        let offset = MAX_CAPTURE_BYTES - (FRAME_OVERHEAD_BYTES + length + footer_bytes) as u64 + 1;
        let mut position = offset;
        let failure = read_frame(&mut PrefixOnly(&prefix), &mut position, Counts::default())
            .err()
            .unwrap();
        assert_eq!(failure.status(), CaptureReadStatus::Corrupt { offset });
        assert_eq!(position, offset + 5);
    }

    #[test]
    fn footer_is_still_readable_when_the_item_budget_is_exactly_full() {
        let header = CaptureHeader::new(SessionId::from_bytes([1; 16]), DeviceSource::Virtual);
        let (data, _) = CaptureWriter::new(Vec::new(), header)
            .unwrap()
            .finish()
            .unwrap();
        let mut input = &data[HEADER_BYTES..];
        let mut position = HEADER_BYTES as u64;
        let counts = Counts {
            gap_count: MAX_CAPTURE_ITEMS,
            ..Counts::default()
        };
        assert!(read_frame(&mut input, &mut position, counts).is_ok());
        assert_eq!(position, data.len() as u64);
    }
}
