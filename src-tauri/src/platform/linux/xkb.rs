use evdev::Key as EvKey;
use std::collections::HashMap;
use std::sync::OnceLock;
use xkbcommon::xkb;

pub struct ResolvedChar {
    pub key: EvKey,
    pub shift: bool,
}

struct Keymap {
    table: HashMap<char, ResolvedChar>,
}

fn keycode_to_evdev(xkb_keycode: xkb::Keycode) -> Option<EvKey> {
    let raw: u32 = xkb_keycode.into();
    raw.checked_sub(8).map(|code| EvKey::new(code as u16))
}

fn build_keymap() -> Keymap {
    let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
    let rules = std::env::var("XKB_DEFAULT_RULES").unwrap_or_default();
    let model = std::env::var("XKB_DEFAULT_MODEL").unwrap_or_default();
    let layout = std::env::var("XKB_DEFAULT_LAYOUT").unwrap_or_else(|_| "us".to_string());
    let variant = std::env::var("XKB_DEFAULT_VARIANT").unwrap_or_default();
    let options = std::env::var("XKB_DEFAULT_OPTIONS").ok();

    let keymap = xkb::Keymap::new_from_names(
        &context,
        &rules,
        &model,
        &layout,
        &variant,
        options,
        xkb::KEYMAP_COMPILE_NO_FLAGS,
    );

    let mut table = HashMap::new();
    let Some(keymap) = keymap else {
        return Keymap { table };
    };

    let min = keymap.min_keycode();
    let max = keymap.max_keycode();
    let mut kc: u32 = min.into();
    let max_raw: u32 = max.into();
    while kc <= max_raw {
        let keycode = xkb::Keycode::new(kc);
        let Some(evkey) = keycode_to_evdev(keycode) else {
            kc += 1;
            continue;
        };
        let num_levels = keymap.num_levels_for_key(keycode, 0);
        for level in 0..num_levels {
            let syms = keymap.key_get_syms_by_level(keycode, 0, level);
            for &sym in syms {
                if let Some(ch) = xkb::keysym_to_utf8(sym).chars().next() {
                    let shift = level == 1;
                    table
                        .entry(ch)
                        .and_modify(|existing: &mut ResolvedChar| {
                            if existing.shift && !shift {
                                *existing = ResolvedChar { key: evkey, shift };
                            }
                        })
                        .or_insert(ResolvedChar { key: evkey, shift });
                }
            }
        }
        kc += 1;
    }

    Keymap { table }
}

static KEYMAP: OnceLock<Keymap> = OnceLock::new();

pub fn resolve_char(c: char) -> Option<ResolvedChar> {
    let km = KEYMAP.get_or_init(build_keymap);
    km.table.get(&c).map(|r| ResolvedChar {
        key: r.key,
        shift: r.shift,
    })
}
