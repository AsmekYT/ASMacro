use crate::platform::PointerLocator;
use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};
use std::sync::OnceLock;

use super::x11conn::x11;

fn pack(x: i32, y: i32) -> i64 {
    ((x as i64) << 32) | (y as u32 as i64)
}
fn unpack(v: i64) -> (i32, i32) {
    ((v >> 32) as i32, v as i32)
}

pub struct FusedTracker {
    pos: AtomicI64,
    bbox_w: AtomicU32,
    bbox_h: AtomicU32,
}

impl FusedTracker {
    pub fn new() -> Self {
        FusedTracker {
            pos: AtomicI64::new(pack(0, 0)),
            bbox_w: AtomicU32::new(1920),
            bbox_h: AtomicU32::new(1080),
        }
    }

    #[cfg(test)]
    pub fn set_bbox(&self, w: u32, h: u32) {
        self.bbox_w.store(w.max(1), Ordering::Relaxed);
        self.bbox_h.store(h.max(1), Ordering::Relaxed);
    }

    fn clamp(&self, x: i32, y: i32) -> (i32, i32) {
        let w = self.bbox_w.load(Ordering::Relaxed) as i32;
        let h = self.bbox_h.load(Ordering::Relaxed) as i32;
        (
            x.clamp(0, w.saturating_sub(1)),
            y.clamp(0, h.saturating_sub(1)),
        )
    }

    pub fn note_relative_delta(&self, dx: i32, dy: i32) {
        let (x, y) = unpack(self.pos.load(Ordering::Relaxed));
        let (cx, cy) = self.clamp(x + dx, y + dy);
        self.pos.store(pack(cx, cy), Ordering::Relaxed);
    }
}

impl Default for FusedTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl PointerLocator for FusedTracker {
    fn location(&self) -> Option<(i32, i32)> {
        Some(unpack(self.pos.load(Ordering::Relaxed)))
    }
    fn note_absolute_move(&self, x: i32, y: i32) {
        let (cx, cy) = self.clamp(x, y);
        self.pos.store(pack(cx, cy), Ordering::Relaxed);
    }
}

pub struct X11Pointer;

impl PointerLocator for X11Pointer {
    fn location(&self) -> Option<(i32, i32)> {
        let x11 = x11()?;
        let root = x11.root_screen().root;
        let reply = x11rb::protocol::xproto::ConnectionExt::query_pointer(&x11.conn, root)
            .ok()?
            .reply()
            .ok()?;
        Some((reply.root_x as i32, reply.root_y as i32))
    }
    fn note_absolute_move(&self, _x: i32, _y: i32) {}
}

enum LinuxPointerImpl {
    X11(X11Pointer),
    Estimated,
}

pub struct LinuxPointer(LinuxPointerImpl);

static FUSED: OnceLock<FusedTracker> = OnceLock::new();

pub fn fused_tracker() -> &'static FusedTracker {
    FUSED.get_or_init(FusedTracker::new)
}

impl LinuxPointer {
    pub fn new() -> Self {
        if x11().is_some() {
            LinuxPointer(LinuxPointerImpl::X11(X11Pointer))
        } else {
            LinuxPointer(LinuxPointerImpl::Estimated)
        }
    }
}

impl Default for LinuxPointer {
    fn default() -> Self {
        Self::new()
    }
}

impl PointerLocator for LinuxPointer {
    fn location(&self) -> Option<(i32, i32)> {
        match &self.0 {
            LinuxPointerImpl::X11(p) => p.location(),
            LinuxPointerImpl::Estimated => fused_tracker().location(),
        }
    }
    fn note_absolute_move(&self, x: i32, y: i32) {
        fused_tracker().note_absolute_move(x, y);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_move_rezeroes_estimate() {
        let t = FusedTracker::new();
        t.set_bbox(1920, 1080);
        t.note_relative_delta(500, 500);
        t.note_absolute_move(100, 200);
        assert_eq!(t.location(), Some((100, 200)));
    }

    #[test]
    fn relative_delta_clamped_to_bbox() {
        let t = FusedTracker::new();
        t.set_bbox(1920, 1080);
        t.note_absolute_move(1900, 1070);
        t.note_relative_delta(100, 100);
        assert_eq!(t.location(), Some((1919, 1079)));
    }

    #[test]
    fn relative_delta_clamped_below_zero() {
        let t = FusedTracker::new();
        t.set_bbox(1920, 1080);
        t.note_absolute_move(5, 5);
        t.note_relative_delta(-100, -100);
        assert_eq!(t.location(), Some((0, 0)));
    }
}
