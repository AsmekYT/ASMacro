use crate::input_types::{Axis, Button, Coordinate, Direction, Key};
use std::sync::Mutex;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod windows;

pub struct Frame {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
}

impl Frame {
    pub fn into_image(self) -> image::RgbaImage {
        image::RgbaImage::from_raw(self.w, self.h, self.rgba)
            .expect("Frame dimensions must match buffer length")
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Freshness {
    Latest,
}

#[derive(serde::Serialize)]
pub struct ScreenInfo {
    pub index: usize,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub is_primary: bool,
    pub name: Option<String>,
}

pub struct OcrWordBox {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

pub struct OcrLineBox {
    pub text: String,
    pub words: Vec<OcrWordBox>,
}

pub struct OcrLines {
    pub text: String,
    pub lines: Vec<OcrLineBox>,
    pub language: String,
}

pub trait InputSink: Send {
    fn move_mouse(&mut self, x: i32, y: i32, c: Coordinate) -> Result<(), String>;
    fn button(&mut self, b: Button, d: Direction) -> Result<(), String>;
    fn key(&mut self, k: Key, d: Direction) -> Result<(), String>;
    fn text(&mut self, s: &str) -> Result<(), String>;
    fn scroll(&mut self, amount: i32, axis: Axis) -> Result<(), String>;

    fn release_all(&mut self);
}

pub trait PointerLocator: Send + Sync {
    fn location(&self) -> Option<(i32, i32)>;

    fn note_absolute_move(&self, x: i32, y: i32);
}

pub trait CaptureBackend: Send + Sync {
    fn screens(&self) -> Result<Vec<ScreenInfo>, String>;
    fn capture_screen(&self, idx: usize) -> Result<Frame, String>;

    fn capture_region(
        &self,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        fresh: Freshness,
    ) -> Result<(Frame, i32, i32), String>;
}

pub trait OcrBackend: Send + Sync {
    fn read(&self, img: &image::RgbaImage, lang: Option<&str>) -> Result<OcrLines, String>;
    fn max_dimension(&self) -> u32;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowInfo {
    pub id: u64,
    pub title: String,
    pub pid: u32,
}

pub trait WindowManager: Send + Sync {
    fn list(&self) -> Result<Vec<WindowInfo>, String>;
    fn focus(&self, id: u64) -> Result<(), String>;
    fn process_tree(&self, root: u32) -> Vec<u32>;
    fn process_exe_name(&self, pid: u32) -> Option<String>;
    fn wait_input_idle(&self, pid: u32, timeout_ms: u64);
}

pub trait HotkeyHook: Send + Sync {
    fn start(&self, app: tauri::AppHandle);
    fn set_hotkey(&self, combo: Option<crate::hotkey::HotkeyCombo>);
    fn set_macro_hotkeys(&self, bindings: Vec<crate::hotkey::MacroHotkey>);
    fn stop(&self);
}

#[cfg(target_os = "linux")]
use self::linux as active;
#[cfg(windows)]
use self::windows as active;

pub fn input() -> Result<&'static Mutex<Box<dyn InputSink>>, String> {
    active::input_sink()
}
pub fn input_ready() -> Result<(), String> {
    input().map(|_| ())
}
pub fn pointer() -> &'static dyn PointerLocator {
    active::pointer_locator()
}
pub fn capture() -> &'static dyn CaptureBackend {
    active::capture_backend()
}
pub fn ocr() -> &'static dyn OcrBackend {
    active::ocr_backend()
}
pub fn hook() -> &'static dyn HotkeyHook {
    active::hook_backend()
}
pub fn windows_mgr() -> &'static dyn WindowManager {
    active::window_manager()
}

pub fn move_mouse(x: i32, y: i32, c: Coordinate) {
    if let Ok(i) = input() {
        let _ = i
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .move_mouse(x, y, c);
    }
    if c == Coordinate::Abs {
        pointer().note_absolute_move(x, y);
    }
}

pub fn button(b: Button, d: Direction) {
    if let Ok(i) = input() {
        let _ = i.lock().unwrap_or_else(|e| e.into_inner()).button(b, d);
    }
}

pub fn key(k: Key, d: Direction) {
    if let Ok(i) = input() {
        let _ = i.lock().unwrap_or_else(|e| e.into_inner()).key(k, d);
    }
}

pub fn text(s: &str) {
    if let Ok(i) = input() {
        let _ = i.lock().unwrap_or_else(|e| e.into_inner()).text(s);
    }
}

pub fn scroll(amount: i32, axis: Axis) {
    if let Ok(i) = input() {
        let _ = i
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .scroll(amount, axis);
    }
}

pub fn release_all() {
    if let Ok(i) = input() {
        i.lock().unwrap_or_else(|e| e.into_inner()).release_all();
    }
}

pub fn location() -> Option<(i32, i32)> {
    pointer().location()
}

#[tauri::command]
pub fn set_autoclicker_hotkey(combo: Option<crate::hotkey::HotkeyCombo>) {
    hook().set_hotkey(combo);
}

#[tauri::command]
pub fn set_macro_hotkeys(bindings: Vec<crate::hotkey::MacroHotkey>) {
    hook().set_macro_hotkeys(bindings);
}

#[derive(serde::Serialize)]
pub struct Capabilities {
    pub platform: &'static str,
    pub session: String,
    pub input_write: bool,
    pub input_read: bool,
    pub ocr: bool,
    pub notes: Vec<String>,
}

#[tauri::command]
pub fn platform_capabilities() -> Capabilities {
    active::capabilities()
}

pub fn installer_language() -> Option<String> {
    active::installer_language()
}

pub fn system_language() -> Option<String> {
    active::system_language()
}
