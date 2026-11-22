use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static UI_STRINGS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

fn fallback() -> &'static HashMap<String, String> {
    static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
    EN.get_or_init(|| {
        #[derive(serde::Deserialize)]
        struct Locale {
            strings: HashMap<String, String>,
        }
        serde_json::from_str::<Locale>(include_str!("../../src/i18n/locales/en.json"))
            .map(|l| l.strings)
            .unwrap_or_default()
    })
}

pub fn set_strings(strings: HashMap<String, String>) {
    if let Ok(mut s) = UI_STRINGS.lock() {
        *s = Some(strings);
    }
}

pub fn tr(key: &str) -> String {
    let current = UI_STRINGS
        .lock()
        .ok()
        .and_then(|s| s.as_ref().and_then(|m| m.get(key).cloned()));
    current
        .or_else(|| fallback().get(key).cloned())
        .unwrap_or_else(|| key.to_string())
}

pub fn tr_run_program_message(path: &str) -> String {
    tr("runProgram.message").replace("{path}", path)
}

fn user_locales_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("locales"))
}

#[tauri::command]
pub fn user_locales(app: AppHandle) -> Vec<String> {
    let Some(dir) = user_locales_dir(&app) else {
        return Vec::new();
    };
    let _ = std::fs::create_dir_all(&dir);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("json"))
        })
        .filter_map(|p| std::fs::read_to_string(p).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn english_fallback_has_tray_text() {
        assert_eq!(tr("tray.quit"), "Quit");
        assert!(tr_run_program_message("/opt/x").contains("/opt/x"));
    }
}
