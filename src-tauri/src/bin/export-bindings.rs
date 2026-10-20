fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Usage: export-bindings <output.ts>")?;
    tauri_desktop_starter_lib::bindings::export(std::path::Path::new(&path))
}
