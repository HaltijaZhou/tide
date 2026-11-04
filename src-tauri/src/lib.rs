mod commands;
mod local_images;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::WatchState::default())
        .manage(commands::InitialFile::new(std::env::args_os().skip(1)))
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::watch_file,
            commands::unwatch_file,
            commands::take_initial_file,
            local_images::resolve_document_image,
            local_images::save_pasted_image,
            local_images::copy_pasted_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
