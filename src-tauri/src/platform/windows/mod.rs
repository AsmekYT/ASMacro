mod capture;
mod hook;
mod input;
mod ocr;
mod pointer;
mod window;

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
            input::WindowsInput::new().map(|i| Mutex::new(Box::new(i) as Box<dyn InputSink>))
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub fn pointer_locator() -> &'static dyn PointerLocator {
    POINTER
        .get_or_init(|| Box::new(pointer::WindowsPointer::new()) as Box<dyn PointerLocator>)
        .as_ref()
}

pub fn capture_backend() -> &'static dyn CaptureBackend {
    CAPTURE
        .get_or_init(|| Box::new(capture::WindowsCapture::new()) as Box<dyn CaptureBackend>)
        .as_ref()
}

pub fn ocr_backend() -> &'static dyn OcrBackend {
    OCR.get_or_init(|| Box::new(ocr::WindowsOcr::new()) as Box<dyn OcrBackend>)
        .as_ref()
}

pub fn hook_backend() -> &'static dyn HotkeyHook {
    HOOK.get_or_init(|| Box::new(hook::WindowsHook::new()) as Box<dyn HotkeyHook>)
        .as_ref()
}

pub fn window_manager() -> &'static dyn WindowManager {
    WINDOWS
        .get_or_init(|| Box::new(window::WindowsWindows::new()) as Box<dyn WindowManager>)
        .as_ref()
}

pub fn capabilities() -> Capabilities {
    Capabilities {
        platform: "windows",
        session: "win32".to_string(),
        input_write: true,
        input_read: true,
        ocr: true,
        notes: vec![],
    }
}

pub fn system_language() -> Option<String> {
    use windows::Win32::Globalization::{GetUserDefaultLocaleName, GetUserDefaultUILanguage};

    let langid = unsafe { GetUserDefaultUILanguage() };
    match langid & 0x3ff {
        0x15 => return Some("pl".to_string()),
        0x07 => return Some("de".to_string()),
        0x09 => return Some("en".to_string()),
        _ => {}
    }

    let mut buf = [0u16; 85];
    let len = unsafe { GetUserDefaultLocaleName(&mut buf) };
    if len <= 0 {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..(len as usize)]);
    let s = s.trim_end_matches('\0').trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn installer_language() -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    let sub_key: Vec<u16> = "Software\\me.asmek.asmacro\0".encode_utf16().collect();
    let value_name: Vec<u16> = "Language\0".encode_utf16().collect();
    let mut buf = [0u16; 16];
    let mut buf_len = (buf.len() * std::mem::size_of::<u16>()) as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(sub_key.as_ptr()),
            PCWSTR(value_name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut buf_len),
        )
    };

    if status != ERROR_SUCCESS {
        return None;
    }

    let chars = buf_len as usize / std::mem::size_of::<u16>();
    let s = String::from_utf16_lossy(&buf[..chars]);
    let s = s.trim_end_matches('\0').to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}
