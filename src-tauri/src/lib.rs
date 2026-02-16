// This file is a stub to satisfy the compiler because we moved
// the main logic to main.rs for this specific project structure.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}