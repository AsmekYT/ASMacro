use crate::input_types::{Button, Direction, Key};
use crate::platform;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static PRESSED_KEYS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static PRESSED_BUTTONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn pressed_keys() -> &'static Mutex<HashSet<String>> {
    PRESSED_KEYS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn pressed_buttons() -> &'static Mutex<HashSet<String>> {
    PRESSED_BUTTONS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[tauri::command]
pub fn release_all_inputs() {
    let keys: Vec<String> = pressed_keys()
        .lock()
        .map(|mut s| s.drain().collect())
        .unwrap_or_default();
    for k in keys {
        if let Ok(key) = map_key(&k) {
            platform::key(key, Direction::Release);
        }
    }
    let buttons: Vec<String> = pressed_buttons()
        .lock()
        .map(|mut s| s.drain().collect())
        .unwrap_or_default();
    for b in buttons {
        platform::button(map_mouse_btn(&b), Direction::Release);
    }
    platform::release_all();
}

pub fn map_key(k: &str) -> Result<Key, String> {
    let lower = k.to_lowercase();
    Ok(match lower.as_str() {
        "enter" => Key::Return,
        "space" => Key::Space,
        "escape" | "esc" => Key::Escape,
        "tab" => Key::Tab,
        "ctrl" => Key::Control,
        "alt" => Key::Alt,
        "shift" => Key::Shift,
        "meta" | "win" => Key::Meta,
        "backspace" => Key::Backspace,
        "capslock" | "caps" => Key::CapsLock,
        "insert" | "ins" => Key::Insert,
        "delete" | "del" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "pgup" => Key::PageUp,
        "pagedown" | "pgdn" => Key::PageDown,
        "printscreen" | "printscr" | "prtsc" => Key::PrintScreen,
        "scrolllock" | "scrlk" => Key::ScrollLock,
        "pause" => Key::Pause,
        "menu" | "contextmenu" | "apps" => Key::Menu,
        "up" | "arrowup" => Key::UpArrow,
        "down" | "arrowdown" => Key::DownArrow,
        "left" | "arrowleft" => Key::LeftArrow,
        "right" | "arrowright" => Key::RightArrow,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        _ => {
            let mut chars = k.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) => Key::Unicode(c),
                _ => return Err(format!("Unknown key: {k}")),
            }
        }
    })
}

pub fn split_combo(combo: &str) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = String::new();
    for ch in combo.chars() {
        if ch == '+' && !cur.is_empty() {
            parts.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    parts
}

pub fn map_mouse_btn(b: &str) -> Button {
    match b.to_uppercase().as_str() {
        "RIGHT" => Button::Right,
        "MIDDLE" => Button::Middle,
        "BACK" => Button::Back,
        "FORWARD" => Button::Forward,
        _ => Button::Left,
    }
}

pub(crate) fn track_key_down(k: &str) {
    let _ = pressed_keys()
        .lock()
        .map(|mut s| s.insert(k.to_lowercase()));
}
pub(crate) fn track_key_up(k: &str) {
    let _ = pressed_keys()
        .lock()
        .map(|mut s| s.remove(&k.to_lowercase()));
}
pub(crate) fn track_btn_down(b: &str) {
    let _ = pressed_buttons()
        .lock()
        .map(|mut s| s.insert(b.to_uppercase()));
}
pub(crate) fn track_btn_up(b: &str) {
    let _ = pressed_buttons()
        .lock()
        .map(|mut s| s.remove(&b.to_uppercase()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_combo_parses_modifiers_and_literal_plus() {
        assert_eq!(split_combo("Ctrl+Shift+Esc"), ["Ctrl", "Shift", "Esc"]);
        assert_eq!(split_combo("Ctrl++"), ["Ctrl", "+"]);
        assert_eq!(split_combo("F5"), ["F5"]);
        assert!(split_combo("").is_empty());
        let parts = split_combo("Ctrl+Alt+ArrowUp");
        let (trigger, mods) = parts.split_last().unwrap();
        assert_eq!(mods, ["Ctrl", "Alt"]);
        assert_eq!(map_key(trigger).unwrap(), Key::UpArrow);
    }

    #[test]
    fn map_key_named_keys() {
        assert!(matches!(map_key("enter"), Ok(Key::Return)));
        assert!(matches!(map_key("Enter"), Ok(Key::Return)));
        assert!(matches!(map_key("f5"), Ok(Key::F5)));
        assert!(matches!(map_key("F5"), Ok(Key::F5)));
        assert!(matches!(map_key("esc"), Ok(Key::Escape)));
        assert!(matches!(map_key("Delete"), Ok(Key::Delete)));
        assert!(matches!(map_key("PgUp"), Ok(Key::PageUp)));
        assert!(matches!(map_key("ContextMenu"), Ok(Key::Menu)));
        assert!(matches!(map_key("PrintScreen"), Ok(Key::PrintScreen)));
    }

    #[test]
    fn map_key_single_ascii_char() {
        assert!(matches!(map_key("a"), Ok(Key::Unicode('a'))));
    }

    #[test]
    fn map_key_single_multibyte_char() {
        assert!(matches!(map_key("ą"), Ok(Key::Unicode('ą'))));
    }

    #[test]
    fn map_key_unknown_is_error_not_enter() {
        let result = map_key("garbage");
        assert!(result.is_err());
        assert!(!matches!(result, Ok(Key::Return)));
    }
}
