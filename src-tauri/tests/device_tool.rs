//! 启动本轮构建的无头 CLI，只使用测试创建的目录，不连接设备或初始化桌面。
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    fs,
    process::{Command, Output},
};

fn tool(args: &[&OsStr]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_device-tool"));
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().unwrap()
}

fn report(output: Output) -> Value {
    assert!(
        output.status.success(),
        "CLI failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn record(path: &std::path::Path, frames: &str) -> Value {
    report(tool(&[
        OsStr::new("record-virtual"),
        OsStr::new("--output"),
        path.as_os_str(),
        OsStr::new("--frames"),
        OsStr::new(frames),
    ]))
}

#[test]
fn virtual_capture_and_read_only_replay_roundtrip_real_binary_bytes() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("虚拟数据记录.dcap");
    let recorded = record(&path, "4");
    assert_eq!(recorded["source"], "virtual");
    assert_eq!(recorded["complete"], true);
    assert_eq!(recorded["synced"], true);
    assert_eq!(recorded["summary"]["events"], 15);
    assert_eq!(recorded["summary"]["bytes"], 72);
    assert_eq!(recorded["summary"]["rxBytes"], 48);
    assert_eq!(recorded["summary"]["txBytes"], 24);
    assert_eq!(recorded["summary"]["gaps"], 0);
    let mut payload = Sha256::new();
    for index in 0..4 {
        let bytes = [0, 0xff, index, 0, b'\r', b'\n'];
        for _ in 0..3 {
            payload.update(bytes);
        }
    }
    assert_eq!(
        recorded["summary"]["payloadSha256"],
        format!("{:x}", payload.finalize())
    );
    let before = fs::read(&path).unwrap();
    assert_eq!(recorded["fileBytes"], before.len() as u64);
    let replayed = report(tool(&[
        OsStr::new("replay"),
        OsStr::new("--input"),
        path.as_os_str(),
    ]));
    assert_eq!(replayed["source"], "replay");
    assert_eq!(replayed["recordedSource"], "virtual");
    assert_eq!(replayed["status"], "complete");
    assert_eq!(replayed["verifiedOffset"], before.len() as u64);
    assert_eq!(replayed["summary"], recorded["summary"]);
    assert_eq!(replayed["sessionId"], recorded["sessionId"]);
    assert_eq!(fs::read(&path).unwrap(), before);

    let repeated = tool(&[
        OsStr::new("record-virtual"),
        OsStr::new("--output"),
        path.as_os_str(),
    ]);
    assert!(!repeated.status.success());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn strict_replay_rejects_interruption_while_explicit_recovery_reports_only_verified_prefix() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("完整.dcap");
    let recorded = record(&path, "2");
    let mut interrupted = fs::read(&path).unwrap();
    interrupted.pop();
    let partial = directory.path().join("中断.dcap");
    fs::write(&partial, &interrupted).unwrap();
    let failed = tool(&[
        OsStr::new("replay"),
        OsStr::new("--input"),
        partial.as_os_str(),
    ]);
    assert!(!failed.status.success());
    assert!(failed.stdout.is_empty());
    let recovered = report(tool(&[
        OsStr::new("replay"),
        OsStr::new("--input"),
        partial.as_os_str(),
        OsStr::new("--recover-prefix"),
    ]));
    assert_eq!(recovered["complete"], false);
    assert_eq!(recovered["recoveredPrefix"], true);
    assert_eq!(recovered["status"], "incomplete");
    assert!(recovered["failureOffset"].is_u64());
    assert_eq!(
        recovered["summary"]["events"],
        recorded["summary"]["events"]
    );
    assert_eq!(fs::read(&partial).unwrap(), interrupted);
}

#[test]
fn corrupted_payload_is_not_replayed_or_silently_treated_as_complete() {
    let directory = tempfile::tempdir().unwrap();
    let original = directory.path().join("原始.dcap");
    record(&original, "2");
    let mut bytes = fs::read(&original).unwrap();
    // 独立寻找确定性二进制测试载荷，不复制内部帧长度和校验实现。
    let payload = [0, 0xff, 0, 0, b'\r', b'\n'];
    let position = bytes
        .windows(payload.len())
        .position(|part| part == payload)
        .unwrap();
    bytes[position + 1] ^= 0x80;
    let corrupt = directory.path().join("坏记录.dcap");
    fs::write(&corrupt, &bytes).unwrap();
    let failed = tool(&[
        OsStr::new("replay"),
        OsStr::new("--input"),
        corrupt.as_os_str(),
    ]);
    assert!(!failed.status.success());
    let recovered = report(tool(&[
        OsStr::new("replay"),
        OsStr::new("--input"),
        corrupt.as_os_str(),
        OsStr::new("--recover-prefix"),
    ]));
    assert_eq!(recovered["status"], "corrupt");
    assert_eq!(recovered["complete"], false);
    assert_eq!(recovered["recoveredPrefix"], true);
    assert_eq!(recovered["summary"]["rxBytes"], 0);
    assert_eq!(recovered["summary"]["txBytes"], 0);
    assert_eq!(fs::read(&corrupt).unwrap(), bytes);
}

#[test]
fn unknown_format_and_invalid_options_never_modify_input_or_create_output() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("当前.dcap");
    record(&path, "1");
    let mut future = fs::read(&path).unwrap();
    future[8..10].copy_from_slice(&2_u16.to_le_bytes());
    let path = directory.path().join("未来.dcap");
    fs::write(&path, &future).unwrap();
    for recover in [false, true] {
        let mut args = vec![
            OsStr::new("replay"),
            OsStr::new("--input"),
            path.as_os_str(),
        ];
        if recover {
            args.push(OsStr::new("--recover-prefix"));
        }
        let output = tool(&args);
        assert!(!output.status.success());
        assert_eq!(fs::read(&path).unwrap(), future);
    }
    let missing = directory.path().join("不应创建.dcap");
    let output = tool(&[
        OsStr::new("record-virtual"),
        OsStr::new("--output"),
        missing.as_os_str(),
        OsStr::new("--frames"),
        OsStr::new("4097"),
    ]);
    assert!(!output.status.success());
    assert!(!missing.exists());
    assert!(
        !tool(&[OsStr::new("replay"), OsStr::new("--unknown")])
            .status
            .success()
    );
}

#[cfg(unix)]
#[test]
fn replay_refuses_a_symbolic_link_without_modifying_its_target() {
    use std::os::unix::fs::symlink;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("capture.dcap");
    record(&path, "1");
    let before = fs::read(&path).unwrap();
    let link = directory.path().join("link.dcap");
    symlink(&path, &link).unwrap();
    assert!(
        !tool(&[
            OsStr::new("replay"),
            OsStr::new("--input"),
            link.as_os_str()
        ])
        .status
        .success()
    );
    assert_eq!(fs::read(&path).unwrap(), before);
}
