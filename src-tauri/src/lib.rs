mod commands;
mod error;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::engine::engine_info])
        .run(tauri::generate_context!())
        .expect("failed to run Davis");
}
