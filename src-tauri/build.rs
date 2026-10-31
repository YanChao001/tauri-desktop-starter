fn main() {
    // Windows 图标由构建脚本嵌入可执行文件，需补充配置文件之外的资源监听
    // 派生图标变化时重新编译资源，避免安装器复用带有旧图标的 Cargo 产物
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
