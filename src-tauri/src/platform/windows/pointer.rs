use crate::platform::PointerLocator;
use enigo::{Enigo, Mouse, Settings};
use std::sync::Mutex;

pub struct WindowsPointer(Mutex<Enigo>);

impl WindowsPointer {
    pub fn new() -> Self {
        WindowsPointer(Mutex::new(
            Enigo::new(&Settings::default()).expect("enigo init failed"),
        ))
    }
}

impl PointerLocator for WindowsPointer {
    fn location(&self) -> Option<(i32, i32)> {
        self.0.lock().ok()?.location().ok()
    }
    fn note_absolute_move(&self, _x: i32, _y: i32) {}
}
