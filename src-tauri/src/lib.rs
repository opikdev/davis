mod commands;
mod error;

pub fn run() {
    tauri::Builder::default()
        .manage(commands::chat::AskRegistry::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::ai::choose_model,
            commands::ai::chosen_model,
            commands::ai::complete_onboarding,
            commands::ai::connect_provider,
            commands::ai::connected_providers,
            commands::ai::detect_ai_tools,
            commands::ai::disconnect_provider,
            commands::ai::install_app,
            commands::ai::list_models,
            commands::ai::onboarding_status,
            commands::ai::open_sign_in,
            commands::chat::answer_agent,
            commands::chat::ask_project,
            commands::chat::stop_asking,
            commands::engine::engine_info,
            commands::engine::open_table,
            commands::engine::column_values,
            commands::engine::profile_table,
            commands::engine::read_rows,
            commands::project::add_block,
            commands::project::add_project_file,
            commands::project::check_data_file,
            commands::project::combine_project_files,
            commands::project::create_project,
            commands::project::data_files_in,
            commands::project::delete_chat,
            commands::project::delete_page,
            commands::project::filter_choices,
            commands::project::filter_options,
            commands::project::last_project,
            commands::project::open_project,
            commands::project::project_links,
            commands::project::read_chat,
            commands::project::read_page,
            commands::project::recent_projects,
            commands::project::remove_project_file,
            commands::project::rename_project,
            commands::project::run_page,
            commands::project::save_chat,
            commands::project::save_page,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Davis");
}
