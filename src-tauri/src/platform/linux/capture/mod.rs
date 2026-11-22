pub mod wayland;
pub mod x11;

use crate::platform::{CaptureBackend, Frame, Freshness, ScreenInfo};

fn is_wayland_session() -> bool {
    std::env::var_os("WAYLAND_DISPLAY").is_some()
        && std::env::var("XDG_SESSION_TYPE")
            .map(|v| v != "x11")
            .unwrap_or(true)
}

pub struct LinuxCapture;

impl LinuxCapture {
    pub fn new() -> Self {
        LinuxCapture
    }
}

impl Default for LinuxCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureBackend for LinuxCapture {
    fn screens(&self) -> Result<Vec<ScreenInfo>, String> {
        if is_wayland_session() {
            wayland::screens()
        } else {
            x11::screens()
        }
    }

    fn capture_screen(&self, idx: usize) -> Result<Frame, String> {
        if is_wayland_session() {
            wayland::capture_screen(idx)
        } else {
            let screens = x11::screens()?;
            let s = screens.get(idx).ok_or("Screen index out of range")?;
            x11::capture_region(s.x, s.y, s.w, s.h)
        }
    }

    fn capture_region(
        &self,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        fresh: Freshness,
    ) -> Result<(Frame, i32, i32), String> {
        if is_wayland_session() {
            wayland::capture_region(x, y, w, h, fresh)
        } else {
            let frame = x11::capture_region(x, y, w, h)?;
            Ok((frame, x, y))
        }
    }
}
