//! 组合虚拟设备与原始记录回放，不初始化桌面、不打开真实设备或用户应用存档。
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::BufReader,
    path::{Path, PathBuf},
};
use tauri_desktop_starter_lib::{
    capture::{CaptureHeader, CaptureReadStatus, CaptureReader, CaptureSummary, CaptureWriter},
    device::{
        BatchLimit, DeviceEngine, DeviceLimits, StartAt, StreamReader, WriteStatus,
        model::{DeviceEventKind, DeviceSource, Direction, StreamItem},
    },
};

type ToolResult<T> = Result<T, Box<dyn std::error::Error>>;
const DEFAULT_FRAMES: usize = 16;
const MAX_FRAMES: usize = 4096;

#[derive(Debug)]
enum Action {
    Help,
    RecordVirtual {
        output: PathBuf,
        frames: usize,
    },
    Replay {
        input: PathBuf,
        recover_prefix: bool,
    },
}

fn arguments(args: impl IntoIterator<Item = OsString>) -> ToolResult<Action> {
    let mut args = args.into_iter();
    let Some(command) = args.next() else {
        return Ok(Action::Help);
    };
    if command == "--help" || command == "-h" {
        if args.next().is_some() {
            return Err("Help does not accept additional arguments".into());
        }
        return Ok(Action::Help);
    }
    let mut output = None;
    let mut input = None;
    let mut frames = None;
    let mut recover_prefix = false;
    while let Some(key) = args.next() {
        let key = key.to_str().ok_or("Option names must be valid UTF-8")?;
        match key {
            "--output" if command == "record-virtual" && output.is_none() => {
                output = Some(path_argument(args.next())?);
            }
            "--frames" if command == "record-virtual" && frames.is_none() => {
                let value = args.next().ok_or("Missing --frames value")?;
                let value = value.to_str().ok_or("Invalid --frames value")?;
                if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                    return Err("--frames must be a positive decimal integer".into());
                }
                let count: usize = value.parse()?;
                if !(1..=MAX_FRAMES).contains(&count) {
                    return Err(format!("--frames must be between 1 and {MAX_FRAMES}").into());
                }
                frames = Some(count);
            }
            "--input" if command == "replay" && input.is_none() => {
                input = Some(path_argument(args.next())?);
            }
            "--recover-prefix" if command == "replay" && !recover_prefix => {
                recover_prefix = true;
            }
            _ => {
                return Err(format!("Unknown, duplicate or command-specific option: {key}").into());
            }
        }
    }
    if command == "record-virtual" {
        Ok(Action::RecordVirtual {
            output: output.ok_or("Required: --output <new capture file>")?,
            frames: frames.unwrap_or(DEFAULT_FRAMES),
        })
    } else if command == "replay" {
        Ok(Action::Replay {
            input: input.ok_or("Required: --input <capture file>")?,
            recover_prefix,
        })
    } else {
        Err("Expected record-virtual or replay".into())
    }
}

fn path_argument(value: Option<OsString>) -> ToolResult<PathBuf> {
    let value = value.ok_or("Missing file path")?;
    if value.is_empty() || value.to_str().is_some_and(|value| value.starts_with("--")) {
        return Err("Missing file path".into());
    }
    Ok(PathBuf::from(value))
}

fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.is_symlink()
    }
}

fn open_input(path: &Path) -> ToolResult<File> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || linked(&metadata) {
        return Err("Capture input must be a regular file, not a link or reparse point".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "macos")]
        options.custom_flags(0x0100 | 0x0004);
        #[cfg(not(target_os = "macos"))]
        options.custom_flags(0x0002_0000 | 0x0800);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || linked(&metadata) {
        return Err("Capture input changed or is not a regular file".into());
    }
    Ok(file)
}

fn create_output(path: &Path) -> ToolResult<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}

#[derive(Default)]
struct Observation {
    rx_bytes: u64,
    tx_bytes: u64,
    payload: Sha256,
}

impl Observation {
    fn accept(&mut self, item: &StreamItem) {
        if let StreamItem::Event(event) = item
            && let DeviceEventKind::Bytes {
                direction, bytes, ..
            } = &event.kind
        {
            match direction {
                Direction::Rx => self.rx_bytes += bytes.len() as u64,
                Direction::Tx => self.tx_bytes += bytes.len() as u64,
            }
            self.payload.update(bytes);
        }
    }

    fn report(self, summary: &CaptureSummary) -> Value {
        json!({
            "events": summary.event_count,
            "bytes": summary.byte_count,
            "gaps": summary.gap_count,
            "rxBytes": self.rx_bytes,
            "txBytes": self.tx_bytes,
            "digest": hex(&summary.digest),
            "payloadSha256": hex(&self.payload.finalize()),
        })
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(char::from(DIGITS[(byte >> 4) as usize]));
        output.push(char::from(DIGITS[(byte & 15) as usize]));
    }
    output
}

fn append_available(
    reader: &mut StreamReader,
    writer: &mut CaptureWriter<&mut File>,
    observation: &mut Observation,
) -> ToolResult<bool> {
    loop {
        let batch = reader.read_batch(BatchLimit::default())?;
        let empty = batch.items.is_empty();
        for item in batch.items {
            writer.append(&item)?;
            observation.accept(&item);
        }
        if batch.closed || empty {
            return Ok(batch.closed);
        }
    }
}

fn record_virtual(output: &Path, frames: usize) -> ToolResult<Value> {
    let engine = DeviceEngine::new(DeviceLimits::default())?;
    let session = engine.create_virtual()?;
    let mut reader = engine.subscribe(&session, StartAt::Beginning)?;
    let token = engine.connect(&session)?;
    let mut file = create_output(output)?;
    let mut writer = CaptureWriter::new(
        &mut file,
        CaptureHeader::new(session, DeviceSource::Virtual),
    )?;
    let mut observation = Observation::default();
    append_available(&mut reader, &mut writer, &mut observation)?;
    for index in 0..frames {
        let payload = [
            0,
            0xff,
            (index & 0xff) as u8,
            ((index >> 8) & 0xff) as u8,
            b'\r',
            b'\n',
        ];
        engine.push_virtual_rx(&token, &payload)?;
        let ticket = engine.enqueue_write(&token, &payload)?;
        if engine.step_virtual(&token, 1)? != 1
            || ticket.try_result() != WriteStatus::VirtualCompleted
        {
            return Err(
                "Virtual write did not complete; no hardware acknowledgement is implied".into(),
            );
        }
        append_available(&mut reader, &mut writer, &mut observation)?;
    }
    engine.disconnect(&token)?;
    engine.close(&session)?;
    if !append_available(&mut reader, &mut writer, &mut observation)? {
        return Err("Closed virtual session did not reach its drained boundary".into());
    }
    engine.shutdown()?;
    let (_, summary) = writer.finish()?;
    file.sync_all()?;
    let recorded_bytes = file.metadata()?.len();
    drop(file);
    Ok(json!({
        "action": "record-virtual",
        "source": "virtual",
        "sessionId": session.to_string(),
        "frames": frames,
        "complete": true,
        "synced": true,
        "fileBytes": recorded_bytes,
        "summary": observation.report(&summary),
    }))
}

fn replay(input: &Path, recover_prefix: bool) -> ToolResult<Value> {
    let file = BufReader::new(open_input(input)?);
    let mut reader = if recover_prefix {
        CaptureReader::new_recovering(file)?
    } else {
        CaptureReader::new(file)?
    };
    let session = reader.header().session_id;
    let recorded_source = match reader.header().source {
        DeviceSource::Virtual => "virtual",
    };
    let mut observation = Observation::default();
    while let Some(item) = reader.next_item()? {
        observation.accept(&item);
    }
    let complete = matches!(reader.status(), CaptureReadStatus::Complete);
    let status = match reader.status() {
        CaptureReadStatus::Complete => "complete",
        CaptureReadStatus::Incomplete { .. } => "incomplete",
        CaptureReadStatus::Corrupt { .. } => "corrupt",
        CaptureReadStatus::Failed { .. } => "failed",
        CaptureReadStatus::Reading => "reading",
    };
    let offset = match reader.status() {
        CaptureReadStatus::Incomplete { offset }
        | CaptureReadStatus::Corrupt { offset }
        | CaptureReadStatus::Failed { offset } => Some(offset),
        _ => None,
    };
    Ok(json!({
        "action": "replay",
        "source": "replay",
        "recordedSource": recorded_source,
        "sessionId": session.to_string(),
        "complete": complete,
        "status": status,
        "recoveredPrefix": recover_prefix && !complete,
        "failureOffset": offset,
        "verifiedOffset": reader.verified_offset(),
        "summary": observation.report(reader.summary()),
    }))
}

fn execute(action: Action) -> ToolResult<Option<Value>> {
    match action {
        Action::Help => {
            println!(
                "Usage: device-tool record-virtual --output <new file> [--frames <1..4096>]\n       device-tool replay --input <capture file> [--recover-prefix]\n\nVirtual captures are synthetic. Replay never opens or writes a physical device."
            );
            Ok(None)
        }
        Action::RecordVirtual { output, frames } => record_virtual(&output, frames).map(Some),
        Action::Replay {
            input,
            recover_prefix,
        } => replay(&input, recover_prefix).map(Some),
    }
}

fn main() {
    let result = arguments(std::env::args_os().skip(1)).and_then(execute);
    match result {
        Ok(Some(report)) => println!("{report}"),
        Ok(None) => {}
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> ToolResult<Action> {
        arguments(values.iter().map(OsString::from))
    }

    #[test]
    fn parses_only_bounded_command_specific_unique_options() {
        assert!(matches!(args(&[]).unwrap(), Action::Help));
        assert!(matches!(args(&["--help"]).unwrap(), Action::Help));
        assert!(matches!(
            args(&["record-virtual", "--output", "记录.dcap"]).unwrap(),
            Action::RecordVirtual { frames: 16, .. }
        ));
        assert!(matches!(
            args(&["replay", "--input", "记录.dcap", "--recover-prefix"]).unwrap(),
            Action::Replay {
                recover_prefix: true,
                ..
            }
        ));
        for invalid in [
            vec!["record-virtual"],
            vec!["record-virtual", "--output", "x", "--frames", "0"],
            vec!["record-virtual", "--output", "x", "--frames", "4097"],
            vec!["record-virtual", "--output", "x", "--frames", "+1"],
            vec!["record-virtual", "--output", "x", "--output", "y"],
            vec!["record-virtual", "--output", "x", "--recover-prefix"],
            vec!["replay", "--input", "--recover-prefix"],
            vec!["replay", "--input", "x", "--frames", "2"],
            vec![
                "replay",
                "--input",
                "x",
                "--recover-prefix",
                "--recover-prefix",
            ],
            vec!["unknown"],
            vec!["--help", "extra"],
        ] {
            assert!(args(&invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn output_creation_never_overwrites_an_existing_record() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("既有记录.dcap");
        fs::write(&path, b"keep existing bytes").unwrap();
        assert!(create_output(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"keep existing bytes");
        assert!(open_input(directory.path()).is_err());
    }

    #[test]
    fn capture_replays_a_slow_readers_explicit_gap_and_retained_binary_suffix() {
        use std::io::Cursor;
        let engine = DeviceEngine::new(DeviceLimits {
            max_ring_events: 2,
            ..DeviceLimits::default()
        })
        .unwrap();
        let session = engine.create_virtual().unwrap();
        let mut reader = engine.subscribe(&session, StartAt::Beginning).unwrap();
        let token = engine.connect(&session).unwrap();
        engine.push_virtual_rx(&token, &[0, 0xff]).unwrap();
        engine.push_virtual_rx(&token, &[0xc3, 0x28]).unwrap();
        engine.close(&session).unwrap();
        let batch = reader.read_batch(BatchLimit::default()).unwrap();
        assert!(batch.closed);
        assert!(
            matches!(&batch.items[0], StreamItem::Gap(gap) if gap.from_sequence == 1 && gap.to_sequence == 3)
        );
        let mut writer = CaptureWriter::new(
            Vec::new(),
            CaptureHeader::new(session, DeviceSource::Virtual),
        )
        .unwrap();
        for item in &batch.items {
            writer.append(item).unwrap();
        }
        let (bytes, written) = writer.finish().unwrap();
        let mut replay = CaptureReader::new(Cursor::new(bytes)).unwrap();
        for expected in &batch.items {
            assert_eq!(replay.next_item().unwrap().as_ref(), Some(expected));
        }
        assert!(replay.next_item().unwrap().is_none());
        assert_eq!(replay.status(), CaptureReadStatus::Complete);
        assert_eq!(replay.summary().gap_count, 1);
        assert_eq!(replay.summary().digest, written.digest);
        assert_eq!(replay.summary().byte_count, 2);
        assert!(engine.enqueue_write(&token, &[1]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn creating_a_capture_uses_private_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("capture.dcap");
        let file = create_output(&path).unwrap();
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
    }
}
