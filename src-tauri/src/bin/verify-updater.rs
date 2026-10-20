fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("Usage: verify-updater <verification-input.json>")?;
    tauri_desktop_starter_lib::update_signature::verify_manifest(std::path::Path::new(&path))
}
