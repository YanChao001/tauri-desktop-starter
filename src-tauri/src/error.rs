use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidArgument,
    UserCancelled,
    CredentialError,
    NameRequired,
    InputTooLong,
    StorageIo,
    StorageCorrupt,
    SettingsConflict,
    DatabaseError,
    NotFound,
    Conflict,
    PlatformUnavailable,
    NativeBusy,
    HttpTimeout,
    AutostartError,
    UpdateNotConfigured,
    UpdateBusy,
    UpdateCheckFailed,
    UpdateCheckTimeout,
    UpdateFeedUnavailable,
    UpdatePlatformUnavailable,
    UpdateDownloadFailed,
    UpdateInstallFailed,
    WindowError,
    ExtensionIncompatible,
    ExtensionRunFailed,
    ExtensionTimeout,
    ExtensionBusy,
    ExtensionUnavailable,
    ExtensionNetworkBlocked,
    ExtensionImageRedirect,
    ExtensionImageSourceRejected,
    ExtensionImageInvalid,
    ExtensionImageTooLarge,
    ExtensionAttachmentTooLarge,
    ExtensionAttachmentCacheFull,
    ExtensionTransferInterrupted,
    MarketNotConfigured,
    MarketUnavailable,
    MarketIncompatible,
    MarketExpired,
    MarketInvalid,
    MarketChanged,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

impl NativeError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: matches!(
                code,
                ErrorCode::NativeBusy
                    | ErrorCode::HttpTimeout
                    | ErrorCode::UpdateBusy
                    | ErrorCode::UpdateCheckFailed
                    | ErrorCode::UpdateCheckTimeout
                    | ErrorCode::UpdateFeedUnavailable
                    | ErrorCode::UpdatePlatformUnavailable
                    | ErrorCode::UpdateDownloadFailed
                    | ErrorCode::ExtensionBusy
                    | ErrorCode::ExtensionTimeout
                    | ErrorCode::MarketUnavailable
                    | ErrorCode::MarketChanged
            ),
        }
    }

    pub fn operation(code: ErrorCode, message: &str, error: impl std::fmt::Display) -> Self {
        log::error!(
            "{}",
            crate::redaction::redact(&format!("{message}: {error}"))
        );
        Self::new(code, message)
    }
}

impl std::fmt::Display for NativeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for NativeError {}

pub type NativeResult<T> = Result<T, NativeError>;

pub fn bounded_text(value: &str, maximum: usize, field: &str) -> NativeResult<()> {
    if value.len() > maximum {
        return Err(NativeError::new(
            ErrorCode::InputTooLong,
            format!("{field} exceeds {maximum} UTF-8 bytes"),
        ));
    }
    if value.contains('\0') {
        return Err(NativeError::new(
            ErrorCode::InvalidArgument,
            format!("{field} contains a null character"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retryability_uses_the_code_instead_of_the_constructor() {
        for code in [
            ErrorCode::InvalidArgument,
            ErrorCode::StorageCorrupt,
            ErrorCode::StorageIo,
            ErrorCode::Conflict,
            ErrorCode::UserCancelled,
            ErrorCode::UpdateInstallFailed,
        ] {
            assert!(!NativeError::new(code, "Failure").retryable);
            assert!(!NativeError::operation(code, "Failure", "detail").retryable);
        }
        for code in [
            ErrorCode::NativeBusy,
            ErrorCode::HttpTimeout,
            ErrorCode::ExtensionBusy,
            ErrorCode::UpdateCheckTimeout,
            ErrorCode::MarketUnavailable,
        ] {
            assert!(NativeError::new(code, "Failure").retryable);
            assert!(NativeError::operation(code, "Failure", "detail").retryable);
        }
    }
}
