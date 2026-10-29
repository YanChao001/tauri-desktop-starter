//! 扩展注册表、包缓存和私有数据共用的真实路径检查。
use std::{
    fs::{self, File, Metadata, OpenOptions},
    path::{Component, Path},
};

use crate::error::{ErrorCode, NativeError, NativeResult};

/// 测试也使用真实根目录，避免 macOS 的 /var 临时目录别名触发链接拒绝。
#[cfg(test)]
pub(crate) fn temporary_directory() -> tempfile::TempDir {
    tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap()
}

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
            // Windows 扩展路径会把 .. 保留为 Normal，不能只检查 ParentDir。
            .any(|part| matches!(part, Component::ParentDir) || part.as_os_str() == "..")
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

/// 拒绝末级链接，并对打开的句柄再次检查，避免只依赖打开前的路径元数据。
pub(crate) fn open_regular(path: &Path) -> NativeResult<File> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid("Extension file requires a parent directory"))?;
    if !directory(parent, false)? || !regular(path)? {
        return Err(NativeError::new(
            ErrorCode::NotFound,
            "Extension file is missing",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        #[cfg(target_os = "macos")]
        options.custom_flags(0x0100 | 0x0004); // O_NOFOLLOW | O_NONBLOCK
        #[cfg(not(target_os = "macos"))]
        options.custom_flags(0x0002_0000 | 0x0800); // O_NOFOLLOW | O_NONBLOCK (Linux/Android)
    }
    let file = options
        .open(path)
        .map_err(|error| io("Cannot open extension file", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| io("Cannot inspect open extension file", error))?;
    if !metadata.is_file() || linked(&metadata) {
        return Err(invalid(
            "Extension file must be a regular file without links or reparse points",
        ));
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn opens_regular_files_and_refuses_missing_files_directories_and_parent_traversal() {
        let root = temporary_directory();
        let directory_path = root.path().join("nested");
        assert!(directory(&directory_path, true).unwrap());
        let path = directory_path.join("module.wasm");
        assert_eq!(open_regular(&path).unwrap_err().code, ErrorCode::NotFound);
        fs::write(&path, b"module").unwrap();
        let mut value = String::new();
        open_regular(&path)
            .unwrap()
            .read_to_string(&mut value)
            .unwrap();
        assert_eq!(value, "module");
        assert!(open_regular(&directory_path).is_err());
        // Windows 的 verbatim PathBuf::join 会先折叠 ..；原始输入保留该片段再校验。
        let mut traversal = directory_path.as_os_str().to_os_string();
        traversal.push(std::path::MAIN_SEPARATOR_STR);
        traversal.push("..");
        assert!(directory(Path::new(&traversal), false).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_file_links_and_links_in_ancestors() {
        use std::os::unix::fs::symlink;
        let root = temporary_directory();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        let module = target.join("module.wasm");
        fs::write(&module, b"external").unwrap();
        let linked_file = root.path().join("linked.wasm");
        symlink(&module, &linked_file).unwrap();
        assert!(open_regular(&linked_file).is_err());
        let linked_directory = root.path().join("linked-directory");
        symlink(&target, &linked_directory).unwrap();
        assert!(directory(&linked_directory.join("nested"), true).is_err());
        assert!(open_regular(&linked_directory.join("module.wasm")).is_err());
        assert!(!target.join("nested").exists());
    }

    #[cfg(windows)]
    #[test]
    fn refuses_junctions_in_ancestors_without_touching_the_target() {
        let root = temporary_directory();
        let target = root.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("module.wasm"), b"external").unwrap();
        let junction = root.path().join("junction");
        assert!(
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&junction)
                .arg(&target)
                .output()
                .unwrap()
                .status
                .success()
        );
        assert!(directory(&junction.join("nested"), true).is_err());
        assert!(open_regular(&junction.join("module.wasm")).is_err());
        assert!(!target.join("nested").exists());
        fs::remove_dir(junction).unwrap();
        assert_eq!(fs::read(target.join("module.wasm")).unwrap(), b"external");
    }
}
