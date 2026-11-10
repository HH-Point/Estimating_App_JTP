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

#[derive(serde::Serialize)]
struct HttpResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

/// Make an HTTP request on behalf of the interface. Used only for talking to
/// AI services: going through the native side avoids the browser's
/// cross-origin rules, which block local model servers such as Ollama.
#[tauri::command]
async fn http_request(
    client: tauri::State<'_, reqwest::Client>,
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, &url);
    for (name, value) in headers {
        // The interface's own origin and length headers do not apply to this request.
        let lower = name.to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "origin" | "referer" | "content-length") {
            continue;
        }
        req = req.header(name, value);
    }
    if let Some(body) = body {
        req = req.body(body);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let headers = res
        .headers()
        .iter()
        // The body is handed over already decoded, so its original encoding and length no longer describe it.
        .filter(|(k, _)| !matches!(k.as_str(), "content-encoding" | "content-length" | "transfer-encoding"))
        .filter_map(|(k, v)| Some((k.to_string(), v.to_str().ok()?.to_string())))
        .collect();
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResponse { status, headers, body })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(
            reqwest::Client::builder()
                // Reading a large sheet can take a model several minutes.
                .timeout(std::time::Duration::from_secs(600))
                .build()
                .expect("failed to set up the HTTP client"),
        )
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_text_file,
            write_text_file,
            write_file,
            http_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running JTP Take-Off");
}
