use crate::input_types::{Axis, Button, Coordinate, Direction, Key};
use crate::platform::InputSink;
use enigo::{Enigo, Keyboard, Mouse, Settings};

fn conv_key(k: Key) -> enigo::Key {
    match k {
        Key::Return => enigo::Key::Return,
        Key::Space => enigo::Key::Space,
        Key::Escape => enigo::Key::Escape,
        Key::Tab => enigo::Key::Tab,
        Key::Control => enigo::Key::Control,
        Key::Alt => enigo::Key::Alt,
        Key::Shift => enigo::Key::Shift,
        Key::Meta => enigo::Key::Meta,
        Key::Backspace => enigo::Key::Backspace,
        Key::CapsLock => enigo::Key::CapsLock,
        Key::Insert => enigo::Key::Insert,
        Key::Delete => enigo::Key::Delete,
        Key::Home => enigo::Key::Home,
        Key::End => enigo::Key::End,
        Key::PageUp => enigo::Key::PageUp,
        Key::PageDown => enigo::Key::PageDown,
        Key::PrintScreen => enigo::Key::PrintScr,
        Key::ScrollLock => enigo::Key::Scroll,
        Key::Pause => enigo::Key::Pause,
        Key::Menu => enigo::Key::Apps,
        Key::UpArrow => enigo::Key::UpArrow,
        Key::DownArrow => enigo::Key::DownArrow,
        Key::LeftArrow => enigo::Key::LeftArrow,
        Key::RightArrow => enigo::Key::RightArrow,
        Key::F1 => enigo::Key::F1,
        Key::F2 => enigo::Key::F2,
        Key::F3 => enigo::Key::F3,
        Key::F4 => enigo::Key::F4,
        Key::F5 => enigo::Key::F5,
        Key::F6 => enigo::Key::F6,
        Key::F7 => enigo::Key::F7,
        Key::F8 => enigo::Key::F8,
        Key::F9 => enigo::Key::F9,
        Key::F10 => enigo::Key::F10,
        Key::F11 => enigo::Key::F11,
        Key::F12 => enigo::Key::F12,
        Key::Unicode(c) => enigo::Key::Unicode(c),
    }
}

fn conv_button(b: Button) -> enigo::Button {
    match b {
        Button::Left => enigo::Button::Left,
        Button::Right => enigo::Button::Right,
        Button::Middle => enigo::Button::Middle,
        Button::Back => enigo::Button::Back,
        Button::Forward => enigo::Button::Forward,
    }
}

fn conv_dir(d: Direction) -> enigo::Direction {
    match d {
        Direction::Press => enigo::Direction::Press,
        Direction::Release => enigo::Direction::Release,
    }
}

fn conv_coord(c: Coordinate) -> enigo::Coordinate {
    match c {
        Coordinate::Abs => enigo::Coordinate::Abs,
    }
}

fn conv_axis(a: Axis) -> enigo::Axis {
    match a {
        Axis::Vertical => enigo::Axis::Vertical,
    }
}

pub struct WindowsInput(Enigo);

impl WindowsInput {
    pub fn new() -> Result<Self, String> {
        Enigo::new(&Settings::default())
            .map(WindowsInput)
            .map_err(|e| format!("enigo init failed: {e}"))
    }
}

impl InputSink for WindowsInput {
    fn move_mouse(&mut self, x: i32, y: i32, c: Coordinate) -> Result<(), String> {
        self.0
            .move_mouse(x, y, conv_coord(c))
            .map_err(|e| e.to_string())
    }
    fn button(&mut self, b: Button, d: Direction) -> Result<(), String> {
        self.0
            .button(conv_button(b), conv_dir(d))
            .map_err(|e| e.to_string())
    }
    fn key(&mut self, k: Key, d: Direction) -> Result<(), String> {
        self.0
            .key(conv_key(k), conv_dir(d))
            .map_err(|e| e.to_string())
    }
    fn text(&mut self, s: &str) -> Result<(), String> {
        self.0.text(s).map_err(|e| e.to_string())
    }
    fn scroll(&mut self, amount: i32, axis: Axis) -> Result<(), String> {
        self.0
            .scroll(amount, conv_axis(axis))
            .map_err(|e| e.to_string())
    }
    fn release_all(&mut self) {}
}
