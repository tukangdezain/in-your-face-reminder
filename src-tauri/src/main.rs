// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::fs;
use std::env;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewWindow,
};

// --- Calendar Logic (Powered by Swift) ---

#[tauri::command]
fn get_calendar_events() -> String {
    // We use Swift's EventKit because JXA (AppleScript) fails to fetch 
    // recurring events (like Daily Standups) properly.
    let swift_script = r#"
import EventKit
import Foundation

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

// Request Access
if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { (granted, error) in
        if !granted {
            print("[]")
            semaphore.signal()
            return
        }
        fetchEvents()
    }
} else {
    store.requestAccess(to: .event) { (granted, error) in
        if !granted {
            print("[]")
            semaphore.signal()
            return
        }
        fetchEvents()
    }
}

func fetchEvents() {
    let now = Date()
    // Look ahead 24 hours
    let end = Date().addingTimeInterval(24 * 3600)
    
    // Fetch all calendars
    let predicate = store.predicateForEvents(withStart: now, end: end, calendars: nil)
    let events = store.events(matching: predicate)
    
    struct JsonEvent: Codable {
        let title: String
        let start: String
        let end: String
        let location: String?
        let description: String?
        let url: String?
        let isAllDay: Bool
    }
    
    let formatter = ISO8601DateFormatter()
    // Ensure we use local time for string output to match user expectation
    formatter.timeZone = TimeZone.current 
    
    let jsonEvents = events.map { event in
        return JsonEvent(
            title: event.title,
            start: formatter.string(from: event.startDate),
            end: formatter.string(from: event.endDate),
            location: event.location,
            description: event.notes,
            url: event.url?.absoluteString,
            isAllDay: event.isAllDay
        )
    }
    
    let encoder = JSONEncoder()
    if let data = try? encoder.encode(jsonEvents),
       let string = String(data: data, encoding: .utf8) {
        print(string)
    } else {
        print("[]")
    }
    semaphore.signal()
}

semaphore.wait()
    "#;

    // 1. Write Swift script to a temporary file
    let temp_dir = env::temp_dir();
    let script_path = temp_dir.join("fetch_calendar.swift");
    
    if let Err(_) = fs::write(&script_path, swift_script) {
        return "[]".to_string();
    }

    // 2. Run the Swift script
    let output = Command::new("/usr/bin/swift")
        .arg(&script_path)
        .output();

    // 3. Cleanup (Optional, but good practice)
    let _ = fs::remove_file(script_path);

    match output {
        Ok(o) => {
            let result = String::from_utf8(o.stdout).unwrap_or("[]".to_string());
            result.trim().to_string()
        },
        Err(_) => "[]".to_string(),
    }
}

// --- Window Logic ---

#[tauri::command]
fn enter_alert_mode(window: WebviewWindow) {
    window.show().unwrap();
    window.set_fullscreen(true).unwrap();
    window.set_always_on_top(true).unwrap();
    window.set_focus().unwrap();
}

#[tauri::command]
fn exit_alert_mode(window: WebviewWindow) {
    window.set_always_on_top(false).unwrap();
    window.set_fullscreen(false).unwrap();
}

#[tauri::command]
fn open_link(url: String) {
    let _ = open::that(url);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { button: MouseButton::Left, .. } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_calendar_events, 
            enter_alert_mode, 
            exit_alert_mode, 
            open_link
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}