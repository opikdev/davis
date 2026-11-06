mod commands;
mod error;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::ai::complete_onboarding,
            commands::ai::connect_provider,
            commands::ai::detect_ai_tools,
            commands::ai::disconnect_provider,
            commands::ai::install_app,
            commands::ai::onboarding_status,
            commands::ai::open_sign_in,
            commands::engine::engine_info,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Davis");
}
