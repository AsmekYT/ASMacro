use evdev::Key;

pub fn evdev_to_vk(key: Key) -> Option<u32> {
    Some(match key {
        Key::KEY_ESC => 0x1b,
        Key::KEY_TAB => 0x09,
        Key::KEY_SPACE => 0x20,
        Key::KEY_ENTER => 0x0d,
        Key::KEY_BACKSPACE => 0x08,
        Key::KEY_DELETE => 0x2e,
        Key::KEY_CAPSLOCK => 0x14,
        Key::KEY_INSERT => 0x2d,
        Key::KEY_UP => 0x26,
        Key::KEY_DOWN => 0x28,
        Key::KEY_LEFT => 0x25,
        Key::KEY_RIGHT => 0x27,
        Key::KEY_HOME => 0x24,
        Key::KEY_END => 0x23,
        Key::KEY_PAGEUP => 0x21,
        Key::KEY_PAGEDOWN => 0x22,
        Key::KEY_COMMA => 0xbc,
        Key::KEY_DOT => 0xbe,
        Key::KEY_SLASH => 0xbf,
        Key::KEY_SEMICOLON => 0xba,
        Key::KEY_APOSTROPHE => 0xde,
        Key::KEY_LEFTBRACE => 0xdb,
        Key::KEY_RIGHTBRACE => 0xdd,
        Key::KEY_BACKSLASH => 0xdc,
        Key::KEY_MINUS => 0xbd,
        Key::KEY_EQUAL => 0xbb,
        Key::KEY_GRAVE => 0xc0,

        Key::KEY_A => 0x41,
        Key::KEY_B => 0x42,
        Key::KEY_C => 0x43,
        Key::KEY_D => 0x44,
        Key::KEY_E => 0x45,
        Key::KEY_F => 0x46,
        Key::KEY_G => 0x47,
        Key::KEY_H => 0x48,
        Key::KEY_I => 0x49,
        Key::KEY_J => 0x4a,
        Key::KEY_K => 0x4b,
        Key::KEY_L => 0x4c,
        Key::KEY_M => 0x4d,
        Key::KEY_N => 0x4e,
        Key::KEY_O => 0x4f,
        Key::KEY_P => 0x50,
        Key::KEY_Q => 0x51,
        Key::KEY_R => 0x52,
        Key::KEY_S => 0x53,
        Key::KEY_T => 0x54,
        Key::KEY_U => 0x55,
        Key::KEY_V => 0x56,
        Key::KEY_W => 0x57,
        Key::KEY_X => 0x58,
        Key::KEY_Y => 0x59,
        Key::KEY_Z => 0x5a,

        Key::KEY_0 => 0x30,
        Key::KEY_1 => 0x31,
        Key::KEY_2 => 0x32,
        Key::KEY_3 => 0x33,
        Key::KEY_4 => 0x34,
        Key::KEY_5 => 0x35,
        Key::KEY_6 => 0x36,
        Key::KEY_7 => 0x37,
        Key::KEY_8 => 0x38,
        Key::KEY_9 => 0x39,

        Key::KEY_F1 => 0x70,
        Key::KEY_F2 => 0x71,
        Key::KEY_F3 => 0x72,
        Key::KEY_F4 => 0x73,
        Key::KEY_F5 => 0x74,
        Key::KEY_F6 => 0x75,
        Key::KEY_F7 => 0x76,
        Key::KEY_F8 => 0x77,
        Key::KEY_F9 => 0x78,
        Key::KEY_F10 => 0x79,
        Key::KEY_F11 => 0x7a,
        Key::KEY_F12 => 0x7b,
        Key::KEY_F13 => 0x7c,
        Key::KEY_F14 => 0x7d,
        Key::KEY_F15 => 0x7e,
        Key::KEY_F16 => 0x7f,
        Key::KEY_F17 => 0x80,
        Key::KEY_F18 => 0x81,
        Key::KEY_F19 => 0x82,
        Key::KEY_F20 => 0x83,
        Key::KEY_F21 => 0x84,
        Key::KEY_F22 => 0x85,
        Key::KEY_F23 => 0x86,
        Key::KEY_F24 => 0x87,

        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frontend_vk_map() -> Vec<(Key, u32)> {
        let mut m = vec![
            (Key::KEY_ESC, 0x1b),
            (Key::KEY_TAB, 0x09),
            (Key::KEY_SPACE, 0x20),
            (Key::KEY_ENTER, 0x0d),
            (Key::KEY_BACKSPACE, 0x08),
            (Key::KEY_DELETE, 0x2e),
            (Key::KEY_CAPSLOCK, 0x14),
            (Key::KEY_INSERT, 0x2d),
            (Key::KEY_UP, 0x26),
            (Key::KEY_DOWN, 0x28),
            (Key::KEY_LEFT, 0x25),
            (Key::KEY_RIGHT, 0x27),
            (Key::KEY_HOME, 0x24),
            (Key::KEY_END, 0x23),
            (Key::KEY_PAGEUP, 0x21),
            (Key::KEY_PAGEDOWN, 0x22),
            (Key::KEY_COMMA, 0xbc),
            (Key::KEY_DOT, 0xbe),
            (Key::KEY_SLASH, 0xbf),
            (Key::KEY_SEMICOLON, 0xba),
            (Key::KEY_APOSTROPHE, 0xde),
            (Key::KEY_LEFTBRACE, 0xdb),
            (Key::KEY_RIGHTBRACE, 0xdd),
            (Key::KEY_BACKSLASH, 0xdc),
            (Key::KEY_MINUS, 0xbd),
            (Key::KEY_EQUAL, 0xbb),
            (Key::KEY_GRAVE, 0xc0),
        ];
        let letters = [
            Key::KEY_A,
            Key::KEY_B,
            Key::KEY_C,
            Key::KEY_D,
            Key::KEY_E,
            Key::KEY_F,
            Key::KEY_G,
            Key::KEY_H,
            Key::KEY_I,
            Key::KEY_J,
            Key::KEY_K,
            Key::KEY_L,
            Key::KEY_M,
            Key::KEY_N,
            Key::KEY_O,
            Key::KEY_P,
            Key::KEY_Q,
            Key::KEY_R,
            Key::KEY_S,
            Key::KEY_T,
            Key::KEY_U,
            Key::KEY_V,
            Key::KEY_W,
            Key::KEY_X,
            Key::KEY_Y,
            Key::KEY_Z,
        ];
        for (i, k) in letters.into_iter().enumerate() {
            m.push((k, 0x41 + i as u32));
        }
        let digits = [
            Key::KEY_0,
            Key::KEY_1,
            Key::KEY_2,
            Key::KEY_3,
            Key::KEY_4,
            Key::KEY_5,
            Key::KEY_6,
            Key::KEY_7,
            Key::KEY_8,
            Key::KEY_9,
        ];

        for (i, k) in digits.into_iter().enumerate() {
            m.push((k, 0x30 + i as u32));
        }
        let fkeys = [
            Key::KEY_F1,
            Key::KEY_F2,
            Key::KEY_F3,
            Key::KEY_F4,
            Key::KEY_F5,
            Key::KEY_F6,
            Key::KEY_F7,
            Key::KEY_F8,
            Key::KEY_F9,
            Key::KEY_F10,
            Key::KEY_F11,
            Key::KEY_F12,
            Key::KEY_F13,
            Key::KEY_F14,
            Key::KEY_F15,
            Key::KEY_F16,
            Key::KEY_F17,
            Key::KEY_F18,
            Key::KEY_F19,
            Key::KEY_F20,
            Key::KEY_F21,
            Key::KEY_F22,
            Key::KEY_F23,
            Key::KEY_F24,
        ];
        for (i, k) in fkeys.into_iter().enumerate() {
            m.push((k, 0x70 + i as u32));
        }
        m
    }

    #[test]
    fn matches_frontend_vk_map() {
        for (key, vk) in frontend_vk_map() {
            assert_eq!(evdev_to_vk(key), Some(vk), "mismatch for {key:?}");
        }
    }

    #[test]
    fn unmapped_key_returns_none() {
        assert_eq!(evdev_to_vk(Key::KEY_ZENKAKUHANKAKU), None);
    }
}
