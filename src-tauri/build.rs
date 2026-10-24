fn main() {
    let demo = "../examples/extensions/text-tools.wat";
    println!("cargo:rerun-if-changed={demo}");
    let wasm = wat::parse_file(demo).expect("Compile the bundled Extism example");
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo OUT_DIR"));
    std::fs::write(output.join("text-tools.wasm"), wasm).expect("Write bundled Extism example");
    // Windows 图标由构建脚本嵌入可执行文件，需补充配置文件之外的资源监听
    // 派生图标变化时重新编译资源，避免安装器复用带有旧图标的 Cargo 产物
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
