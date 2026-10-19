//! Current-user Windows startup entries, with an unambiguous quoted executable path.

use crate::error::{ErrorCode, NativeError, NativeResult};
use windows_registry::{CURRENT_USER, Type};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const MISSING: u32 = 0x80070002;

fn quoted_command(path: &str) -> NativeResult<String> {
    if path.contains(['"', '\0']) {
        return Err(NativeError::new(
            ErrorCode::AutostartError,
            "Application path cannot be used for autostart",
        ));
    }
    Ok(format!("\"{path}\""))
}

fn command() -> NativeResult<String> {
    let path = std::env::current_exe().map_err(|e| {
        NativeError::operation(
            ErrorCode::AutostartError,
            "Cannot locate application executable",
            e,
        )
    })?;
    let text = path.to_str().ok_or_else(|| {
        NativeError::new(
            ErrorCode::AutostartError,
            "Application path is not valid Unicode",
        )
    })?;
    quoted_command(text)
}

fn approved(bytes: &[u8]) -> bool {
    bytes.len() >= 4
        && matches!(
            u32::from_le_bytes(bytes[..4].try_into().expect("four bytes")),
            2 | 6
        )
}

pub fn enabled(identifier: &str) -> NativeResult<bool> {
    let stored = match CURRENT_USER
        .open(RUN)
        .and_then(|key| key.get_string(identifier))
    {
        Ok(value) => value,
        Err(error) if error.code().0 as u32 == MISSING => return Ok(false),
        Err(error) => {
            return Err(NativeError::operation(
                ErrorCode::AutostartError,
                "Cannot read current-user autostart entry",
                error,
            ));
        }
    };
    if !stored.trim().eq_ignore_ascii_case(&command()?) {
        return Ok(false);
    }
    match CURRENT_USER
        .open(APPROVED)
        .and_then(|key| key.get_value(identifier))
    {
        Ok(value) => Ok(approved(&value)),
        Err(error) if error.code().0 as u32 == MISSING => Ok(true),
        Err(error) => Err(NativeError::operation(
            ErrorCode::AutostartError,
            "Cannot read system startup approval",
            error,
        )),
    }
}

pub fn set(identifier: &str, enable: bool) -> NativeResult<bool> {
    if enable {
        let value = command()?;
        let run = CURRENT_USER.create(RUN).map_err(|e| {
            NativeError::operation(
                ErrorCode::AutostartError,
                "Cannot open current-user autostart",
                e,
            )
        })?;
        let previous = match run.get_string(identifier) {
            Ok(value) => Some(value),
            Err(error) if error.code().0 as u32 == MISSING => None,
            Err(error) => {
                return Err(NativeError::operation(
                    ErrorCode::AutostartError,
                    "Cannot read previous autostart entry",
                    error,
                ));
            }
        };
        run.set_string(identifier, value).map_err(|e| {
            NativeError::operation(
                ErrorCode::AutostartError,
                "Cannot register current-user autostart",
                e,
            )
        })?;
        if let Err(error) = CURRENT_USER.create(APPROVED).and_then(|key| {
            key.set_bytes(
                identifier,
                Type::Bytes,
                &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            )
        }) {
            let restored = match previous {
                Some(value) => run.set_string(identifier, value),
                None => run.remove_value(identifier),
            };
            if let Err(rollback) = restored {
                log::error!("Cannot restore previous autostart entry: {rollback}");
            }
            return Err(NativeError::operation(
                ErrorCode::AutostartError,
                "Cannot enable system startup approval",
                error,
            ));
        }
    } else {
        for path in [RUN, APPROVED] {
            match CURRENT_USER
                .options()
                .write()
                .open(path)
                .and_then(|key| key.remove_value(identifier))
            {
                Ok(()) => {}
                Err(error) if error.code().0 as u32 == MISSING => {}
                Err(error) => {
                    if path == APPROVED {
                        log::warn!(
                            "Autostart disabled; stale startup approval could not be removed: {error}"
                        );
                        continue;
                    }
                    return Err(NativeError::operation(
                        ErrorCode::AutostartError,
                        "Cannot remove current-user autostart",
                        error,
                    ));
                }
            }
        }
    }
    enabled(identifier)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_commands_quote_paths_and_reject_embedded_quotes() {
        assert_eq!(
            quoted_command(r"C:\Program Files\Starter App.exe").unwrap(),
            r#""C:\Program Files\Starter App.exe""#
        );
        assert!(quoted_command("bad\"path").is_err());
        assert!(approved(&[2, 0, 0, 0]));
        assert!(!approved(&[3, 0, 0, 0]));
        assert!(!approved(&[]));
    }
}
