//! 扩展注册表、包缓存和私有数据共用的真实路径检查。
use std::{
    fs::{self, Metadata},
    path::{Component, Path},
};

use crate::error::{ErrorCode, NativeError, NativeResult};

fn invalid(message: &str) -> NativeError {
    NativeError::new(ErrorCode::InvalidArgument, message)
}

fn io(message: &str, error: impl std::fmt::Display) -> NativeError {
    NativeError::operation(ErrorCode::StorageIo, message, error)
}

fn linked(metadata: &Metadata) -> bool {
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

/// 每次访问都检查所有祖先，避免合法末级目录藏在链接或 Windows junction 下。
pub(crate) fn directory(path: &Path, create: bool) -> NativeResult<bool> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(invalid("扩展路径必须是没有上级跳转的绝对目录"));
    }
    let mut missing = false;
    for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if metadata.is_dir() && !linked(&metadata) => {}
            Ok(_) => return Err(invalid("扩展路径不接受目录链接或重解析点")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !create {
                    missing = true;
                    continue;
                }
                match fs::create_dir(ancestor) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(io("无法创建扩展目录", error)),
                }
                let metadata = fs::symlink_metadata(ancestor)
                    .map_err(|error| io("无法检查扩展目录", error))?;
                if !metadata.is_dir() || linked(&metadata) {
                    return Err(invalid("扩展路径不接受目录链接或重解析点"));
                }
            }
            Err(error) => return Err(io("无法检查扩展目录", error)),
        }
    }
    Ok(!missing)
}

pub(crate) fn regular(path: &Path) -> NativeResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !linked(&metadata) => Ok(true),
        Ok(_) => Err(invalid("扩展文件路径不接受链接、重解析点或目录")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io("无法检查扩展文件", error)),
    }
}
