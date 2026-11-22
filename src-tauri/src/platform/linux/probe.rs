use crate::platform::Capabilities;
use std::path::Path;

fn session_kind() -> &'static str {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        "wayland"
    } else if std::env::var_os("DISPLAY").is_some() {
        "x11"
    } else {
        "unknown"
    }
}

fn can_write(path: &str) -> bool {
    std::fs::OpenOptions::new().write(true).open(path).is_ok()
}

fn any_input_event_readable() -> bool {
    let Ok(entries) = std::fs::read_dir("/dev/input") else {
        return false;
    };
    entries.flatten().any(|e| {
        e.file_name()
            .to_str()
            .map(|n| n.starts_with("event"))
            .unwrap_or(false)
            && std::fs::OpenOptions::new()
                .read(true)
                .open(e.path())
                .is_ok()
    })
}

fn tesseract_present() -> bool {
    if let Some(appdir) = std::env::var_os("APPDIR") {
        let bundled = Path::new(&appdir).join("usr/bin/tesseract");
        if bundled.is_file() {
            return true;
        }
    }
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join("tesseract").is_file()))
        .unwrap_or(false)
}

pub fn capabilities() -> Capabilities {
    let session = session_kind();
    let uinput_writable = can_write("/dev/uinput");
    let input_readable = any_input_event_readable();
    let ocr_present = tesseract_present();

    let mut notes = Vec::new();
    if !uinput_writable {
        notes.push(
            "/dev/uinput is not writable — clicks/keystrokes can't be synthesized. \
             Install the package's udev rule (60-asmacro.rules) or run: \
             sudo modprobe uinput"
                .to_string(),
        );
    }
    if !input_readable {
        notes.push(
            "No /dev/input/event* device is readable — the autoclicker hotkey and \
             macro start/stop hotkeys won't fire. Add your user to the 'input' group \
             (sudo usermod -aG input $USER) and log out/in."
                .to_string(),
        );
    }
    if !ocr_present {
        notes.push(
            "tesseract was not found on PATH — OCR blocks will fail. Install \
             tesseract-ocr (deb) / tesseract (rpm)."
                .to_string(),
        );
    }
    if session == "wayland" {
        notes.push(
            "Running under native Wayland: cursor position is estimated (drifts as \
             you move the mouse) and the corner failsafe is replaced by a panic \
             hotkey; screen capture requires a one-time portal permission grant."
                .to_string(),
        );
        notes.push(
            "Macro start/stop hotkeys (F5/F6 by default) are served by the evdev hook \
             under native Wayland, since tauri-plugin-global-shortcut cannot register \
             there. They need read access to /dev/input/event* — if that is missing, \
             use the tray menu or the in-app buttons."
                .to_string(),
        );
    }

    Capabilities {
        platform: "linux",
        session: session.to_string(),
        input_write: uinput_writable,
        input_read: input_readable,
        ocr: ocr_present,
        notes,
    }
}
