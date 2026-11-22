mod capture;
mod hook;
mod input;
pub mod keymap;
mod ocr;
mod pointer;
mod probe;
mod window;
mod x11conn;
mod xkb;

use crate::platform::{
    Capabilities, CaptureBackend, HotkeyHook, InputSink, OcrBackend, PointerLocator, WindowManager,
};
use std::sync::{Mutex, OnceLock};

static INPUT: OnceLock<Result<Mutex<Box<dyn InputSink>>, String>> = OnceLock::new();
static POINTER: OnceLock<Box<dyn PointerLocator>> = OnceLock::new();
static CAPTURE: OnceLock<Box<dyn CaptureBackend>> = OnceLock::new();
static OCR: OnceLock<Box<dyn OcrBackend>> = OnceLock::new();
static HOOK: OnceLock<Box<dyn HotkeyHook>> = OnceLock::new();
static WINDOWS: OnceLock<Box<dyn WindowManager>> = OnceLock::new();

pub fn input_sink() -> Result<&'static Mutex<Box<dyn InputSink>>, String> {
    INPUT
        .get_or_init(|| {
            input::LinuxInput::new().map(|i| Mutex::new(Box::new(i) as Box<dyn InputSink>))
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub fn pointer_locator() -> &'static dyn PointerLocator {
    POINTER
        .get_or_init(|| Box::new(pointer::LinuxPointer::new()) as Box<dyn PointerLocator>)
        .as_ref()
}

pub fn capture_backend() -> &'static dyn CaptureBackend {
    CAPTURE
        .get_or_init(|| Box::new(capture::LinuxCapture::new()) as Box<dyn CaptureBackend>)
        .as_ref()
}

pub fn ocr_backend() -> &'static dyn OcrBackend {
    OCR.get_or_init(|| Box::new(ocr::LinuxOcr::new()) as Box<dyn OcrBackend>)
        .as_ref()
}

pub fn hook_backend() -> &'static dyn HotkeyHook {
    HOOK.get_or_init(|| Box::new(hook::LinuxHook::new()) as Box<dyn HotkeyHook>)
        .as_ref()
}

pub fn window_manager() -> &'static dyn WindowManager {
    WINDOWS
        .get_or_init(|| Box::new(window::LinuxWindows::new()) as Box<dyn WindowManager>)
        .as_ref()
}

pub fn capabilities() -> Capabilities {
    probe::capabilities()
}

pub fn system_language() -> Option<String> {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(key) {
            let v = v.trim();
            if !v.is_empty() && v != "C" && v != "POSIX" {
                return Some(v.to_string());
            }
        }
    }
    None
}

pub fn installer_language() -> Option<String> {
    None
}
