use crate::input_types::{Axis, Button, Coordinate, Direction, Key as NKey};
use crate::platform::InputSink;
use evdev::uinput::{VirtualDevice, VirtualDeviceBuilder};
use evdev::{
    AbsInfo, AbsoluteAxisType, AttributeSet, EventType, InputEvent, InputId, Key, RelativeAxisType,
    UinputAbsSetup,
};

fn device_name(kind: &str) -> String {
    format!("ASMacro Virtual {kind} ({})", std::process::id())
}

fn conv_named_key(k: NKey) -> Option<Key> {
    Some(match k {
        NKey::Return => Key::KEY_ENTER,
        NKey::Space => Key::KEY_SPACE,
        NKey::Escape => Key::KEY_ESC,
        NKey::Tab => Key::KEY_TAB,
        NKey::Control => Key::KEY_LEFTCTRL,
        NKey::Alt => Key::KEY_LEFTALT,
        NKey::Shift => Key::KEY_LEFTSHIFT,
        NKey::Meta => Key::KEY_LEFTMETA,
        NKey::Backspace => Key::KEY_BACKSPACE,
        NKey::CapsLock => Key::KEY_CAPSLOCK,
        NKey::Insert => Key::KEY_INSERT,
        NKey::Delete => Key::KEY_DELETE,
        NKey::Home => Key::KEY_HOME,
        NKey::End => Key::KEY_END,
        NKey::PageUp => Key::KEY_PAGEUP,
        NKey::PageDown => Key::KEY_PAGEDOWN,
        NKey::PrintScreen => Key::KEY_SYSRQ,
        NKey::ScrollLock => Key::KEY_SCROLLLOCK,
        NKey::Pause => Key::KEY_PAUSE,
        NKey::Menu => Key::KEY_COMPOSE,
        NKey::UpArrow => Key::KEY_UP,
        NKey::DownArrow => Key::KEY_DOWN,
        NKey::LeftArrow => Key::KEY_LEFT,
        NKey::RightArrow => Key::KEY_RIGHT,
        NKey::F1 => Key::KEY_F1,
        NKey::F2 => Key::KEY_F2,
        NKey::F3 => Key::KEY_F3,
        NKey::F4 => Key::KEY_F4,
        NKey::F5 => Key::KEY_F5,
        NKey::F6 => Key::KEY_F6,
        NKey::F7 => Key::KEY_F7,
        NKey::F8 => Key::KEY_F8,
        NKey::F9 => Key::KEY_F9,
        NKey::F10 => Key::KEY_F10,
        NKey::F11 => Key::KEY_F11,
        NKey::F12 => Key::KEY_F12,
        NKey::Unicode(_) => return None,
    })
}

fn conv_button(b: Button) -> Key {
    match b {
        Button::Left => Key::BTN_LEFT,
        Button::Right => Key::BTN_RIGHT,
        Button::Middle => Key::BTN_MIDDLE,
        Button::Back => Key::BTN_SIDE,
        Button::Forward => Key::BTN_EXTRA,
    }
}

fn all_keyboard_keys() -> AttributeSet<Key> {
    let mut keys = AttributeSet::<Key>::new();

    for code in 1..0x2ffu16 {
        keys.insert(Key::new(code));
    }
    keys
}

fn build_keyboard() -> Result<VirtualDevice, String> {
    VirtualDeviceBuilder::new()
        .map_err(|e| format!("uinput unavailable: {e}"))?
        .name(&device_name("Keyboard"))
        .input_id(InputId::new(evdev::BusType::BUS_VIRTUAL, 0x1209, 0x0001, 1))
        .with_keys(&all_keyboard_keys())
        .map_err(|e| format!("failed to register keyboard keys: {e}"))?
        .build()
        .map_err(|e| format!("failed to create virtual keyboard: is /dev/uinput writable?: {e}"))
}

fn build_mouse() -> Result<VirtualDevice, String> {
    let mut keys = AttributeSet::<Key>::new();
    for k in [
        Key::BTN_LEFT,
        Key::BTN_RIGHT,
        Key::BTN_MIDDLE,
        Key::BTN_SIDE,
        Key::BTN_EXTRA,
    ] {
        keys.insert(k);
    }
    let mut axes = AttributeSet::<RelativeAxisType>::new();
    for a in [
        RelativeAxisType::REL_X,
        RelativeAxisType::REL_Y,
        RelativeAxisType::REL_WHEEL,
        RelativeAxisType::REL_HWHEEL,
    ] {
        axes.insert(a);
    }
    VirtualDeviceBuilder::new()
        .map_err(|e| format!("uinput unavailable: {e}"))?
        .name(&device_name("Mouse"))
        .input_id(InputId::new(evdev::BusType::BUS_VIRTUAL, 0x1209, 0x0002, 1))
        .with_keys(&keys)
        .map_err(|e| format!("failed to register mouse buttons: {e}"))?
        .with_relative_axes(&axes)
        .map_err(|e| format!("failed to register relative axes: {e}"))?
        .build()
        .map_err(|e| format!("failed to create virtual mouse: is /dev/uinput writable?: {e}"))
}

const ABS_MAX: i32 = 65535;

fn build_pen() -> Result<VirtualDevice, String> {
    let mut keys = AttributeSet::<Key>::new();
    keys.insert(Key::BTN_TOOL_PEN);
    keys.insert(Key::BTN_TOUCH);
    keys.insert(Key::BTN_LEFT);
    keys.insert(Key::BTN_RIGHT);

    let abs_info = AbsInfo::new(0, 0, ABS_MAX, 0, 0, 1);
    VirtualDeviceBuilder::new()
        .map_err(|e| format!("uinput unavailable: {e}"))?
        .name(&device_name("Pen"))
        .input_id(InputId::new(evdev::BusType::BUS_VIRTUAL, 0x1209, 0x0003, 1))
        .with_keys(&keys)
        .map_err(|e| format!("failed to register pen buttons: {e}"))?
        .with_absolute_axis(&UinputAbsSetup::new(AbsoluteAxisType::ABS_X, abs_info))
        .map_err(|e| format!("failed to register ABS_X: {e}"))?
        .with_absolute_axis(&UinputAbsSetup::new(AbsoluteAxisType::ABS_Y, abs_info))
        .map_err(|e| format!("failed to register ABS_Y: {e}"))?
        .build()
        .map_err(|e| format!("failed to create virtual pen: is /dev/uinput writable?: {e}"))
}

fn desktop_size() -> (u32, u32) {
    super::capture::x11::screens()
        .ok()
        .and_then(|screens| {
            let w = screens.iter().map(|s| s.x + s.w as i32).max()?;
            let h = screens.iter().map(|s| s.y + s.h as i32).max()?;
            Some((w.max(1) as u32, h.max(1) as u32))
        })
        .unwrap_or((1920, 1080))
}

pub struct LinuxInput {
    keyboard: VirtualDevice,
    mouse: VirtualDevice,
    pen: VirtualDevice,
    screen_w: u32,
    screen_h: u32,
}

impl LinuxInput {
    pub fn new() -> Result<Self, String> {
        let (screen_w, screen_h) = desktop_size();
        Ok(LinuxInput {
            keyboard: build_keyboard()?,
            mouse: build_mouse()?,
            pen: build_pen()?,
            screen_w,
            screen_h,
        })
    }

    fn key_event(dev: &mut VirtualDevice, key: Key, pressed: bool) -> Result<(), String> {
        dev.emit(&[InputEvent::new(EventType::KEY, key.code(), pressed as i32)])
            .map_err(|e| e.to_string())
    }

    fn type_char(&mut self, c: char) -> Result<(), String> {
        let Some(resolved) = super::xkb::resolve_char(c) else {
            return Err(format!(
                "Cannot type '{c}': no key on the active (or best-guess) keyboard \
                 layout produces this character. On Wayland this is a known gap — \
                 layout detection there is best-effort (see platform::linux::xkb)."
            ));
        };
        if resolved.shift {
            Self::key_event(&mut self.keyboard, Key::KEY_LEFTSHIFT, true)?;
        }
        Self::key_event(&mut self.keyboard, resolved.key, true)?;
        Self::key_event(&mut self.keyboard, resolved.key, false)?;
        if resolved.shift {
            Self::key_event(&mut self.keyboard, Key::KEY_LEFTSHIFT, false)?;
        }
        Ok(())
    }
}

impl InputSink for LinuxInput {
    fn move_mouse(&mut self, x: i32, y: i32, c: Coordinate) -> Result<(), String> {
        let Coordinate::Abs = c;
        let ax = ((x.clamp(0, self.screen_w as i32 - 1) as i64 * ABS_MAX as i64)
            / (self.screen_w as i64).max(1)) as i32;
        let ay = ((y.clamp(0, self.screen_h as i32 - 1) as i64 * ABS_MAX as i64)
            / (self.screen_h as i64).max(1)) as i32;
        self.pen
            .emit(&[
                InputEvent::new(EventType::ABSOLUTE, AbsoluteAxisType::ABS_X.0, ax),
                InputEvent::new(EventType::ABSOLUTE, AbsoluteAxisType::ABS_Y.0, ay),
                InputEvent::new(EventType::SYNCHRONIZATION, 0, 0),
            ])
            .map_err(|e| e.to_string())
    }

    fn button(&mut self, b: Button, d: Direction) -> Result<(), String> {
        let pressed = matches!(d, Direction::Press);
        self.mouse
            .emit(&[InputEvent::new(
                EventType::KEY,
                conv_button(b).code(),
                pressed as i32,
            )])
            .map_err(|e| e.to_string())
    }

    fn key(&mut self, k: NKey, d: Direction) -> Result<(), String> {
        let pressed = matches!(d, Direction::Press);
        match conv_named_key(k) {
            Some(evkey) => Self::key_event(&mut self.keyboard, evkey, pressed),
            None => {
                if let NKey::Unicode(c) = k {
                    if pressed {
                        self.type_char(c)?;
                    }
                    Ok(())
                } else {
                    Err("unmapped key".into())
                }
            }
        }
    }

    fn text(&mut self, s: &str) -> Result<(), String> {
        for c in s.chars() {
            self.type_char(c)?;
        }
        Ok(())
    }

    fn scroll(&mut self, amount: i32, axis: Axis) -> Result<(), String> {
        let Axis::Vertical = axis;
        self.mouse
            .emit(&[InputEvent::new(
                EventType::RELATIVE,
                RelativeAxisType::REL_WHEEL.0,
                amount,
            )])
            .map_err(|e| e.to_string())
    }

    fn release_all(&mut self) {
        for k in [
            Key::BTN_LEFT,
            Key::BTN_RIGHT,
            Key::BTN_MIDDLE,
            Key::BTN_SIDE,
            Key::BTN_EXTRA,
        ] {
            let _ = self
                .mouse
                .emit(&[InputEvent::new(EventType::KEY, k.code(), 0)]);
        }
        for k in [
            Key::KEY_LEFTCTRL,
            Key::KEY_LEFTALT,
            Key::KEY_LEFTSHIFT,
            Key::KEY_LEFTMETA,
            Key::KEY_RIGHTCTRL,
            Key::KEY_RIGHTALT,
            Key::KEY_RIGHTSHIFT,
            Key::KEY_RIGHTMETA,
        ] {
            let _ = self
                .keyboard
                .emit(&[InputEvent::new(EventType::KEY, k.code(), 0)]);
        }
    }
}
