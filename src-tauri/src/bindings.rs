use tauri_specta::{Builder, collect_commands};

use crate::commands;

pub fn builder() -> Builder<tauri::Wry> {
    Builder::new()
        .commands(collect_commands![
            commands::greet,
            commands::load_settings_snapshot,
            commands::save_settings_snapshot,
            commands::list_notes,
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::open_secondary_window,
            commands::complete_frontend_startup,
            commands::get_window_geometry,
            commands::set_window_size,
            commands::reset_window_geometry,
            commands::get_desktop_status,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
            commands::record_frontend_error,
            commands::get_diagnostics_report,
            commands::check_for_update,
            commands::get_update_snapshot,
            commands::download_and_install_update,
            commands::relaunch_app,
            commands::quit_app,
        ])
        .typ::<crate::updater::UpdateProgress>()
}

pub fn export(path: &std::path::Path) -> Result<(), Box<dyn std::error::Error>> {
    builder().export(specta_typescript::Typescript::default(), path)?;
    Ok(())
}
