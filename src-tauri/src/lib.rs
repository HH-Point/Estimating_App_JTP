//! Desktop shell for JTP Take-Off.
//!
//! The interface is the web app in `../src`. This side only provides direct
//! file access so drawings are read in place from job folders and the
//! take-off is saved next to them. The window loads only the bundled app,
//! so these commands are reachable only from our own code.

use std::io::ErrorKind;
use tauri::ipc::Response;

/// Read a file as raw bytes (sent to the interface without JSON encoding, so large PDFs stay fast).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

/// Read a text file, or `None` if it does not exist.
#[tauri::command]
fn read_text_file(path: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// Write a file by writing a temporary sibling and renaming it, so a crash or
/// a dropped network share never leaves a half-written take-off behind.
fn write_atomic(path: &str, contents: &[u8]) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, contents)
        .and_then(|_| std::fs::rename(&tmp, path))
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    write_atomic(&path, contents.as_bytes())
}

#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_atomic(&path, &contents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_text_file,
            write_text_file,
            write_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running JTP Take-Off");
}
