use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum MouseTrigger {
    #[serde(rename = "x1")]
    XButton1,
    #[serde(rename = "x2")]
    XButton2,
    #[serde(rename = "middle")]
    Middle,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Trigger {
    Key { vk: u32 },
    Mouse { button: MouseTrigger },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct HotkeyCombo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
    pub trigger: Trigger,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MacroHotkey {
    pub id: String,
    pub action: String,
    pub combo: HotkeyCombo,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct HookHotkeyEvent {
    pub state: &'static str,
}

pub struct HotkeyMatcher {
    held: bool,
}

impl Default for HotkeyMatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl HotkeyMatcher {
    pub const fn new() -> Self {
        HotkeyMatcher { held: false }
    }

    pub fn feed(
        &mut self,
        combo: &HotkeyCombo,
        trigger: Trigger,
        is_down: bool,
        modifiers_match: bool,
    ) -> Option<bool> {
        if combo.trigger != trigger {
            return None;
        }
        if is_down {
            if !modifiers_match {
                return None;
            }
            if self.held {
                return None;
            }
            self.held = true;
            Some(true)
        } else {
            if !self.held {
                return None;
            }
            self.held = false;
            Some(false)
        }
    }

    pub fn reset(&mut self) {
        self.held = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn combo(vk: u32) -> HotkeyCombo {
        HotkeyCombo {
            ctrl: false,
            alt: false,
            shift: false,
            win: false,
            trigger: Trigger::Key { vk },
        }
    }

    #[test]
    fn emits_pressed_then_released() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(
            m.feed(&c, Trigger::Key { vk: 0x74 }, true, true),
            Some(true)
        );
        assert_eq!(
            m.feed(&c, Trigger::Key { vk: 0x74 }, false, true),
            Some(false)
        );
    }

    #[test]
    fn suppresses_auto_repeat() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(
            m.feed(&c, Trigger::Key { vk: 0x74 }, true, true),
            Some(true)
        );
        assert_eq!(m.feed(&c, Trigger::Key { vk: 0x74 }, true, true), None);
    }

    #[test]
    fn ignores_wrong_trigger() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(m.feed(&c, Trigger::Key { vk: 0x75 }, true, true), None);
    }

    #[test]
    fn ignores_mismatched_modifiers_on_press() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(m.feed(&c, Trigger::Key { vk: 0x74 }, true, false), None);
    }

    #[test]
    fn stray_release_with_no_prior_press_is_ignored() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(m.feed(&c, Trigger::Key { vk: 0x74 }, false, true), None);
    }

    #[test]
    fn released_modifiers_dont_matter() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(
            m.feed(&c, Trigger::Key { vk: 0x74 }, true, true),
            Some(true)
        );
        assert_eq!(
            m.feed(&c, Trigger::Key { vk: 0x74 }, false, false),
            Some(false)
        );
    }

    #[test]
    fn reset_clears_held_state() {
        let mut m = HotkeyMatcher::new();
        let c = combo(0x74);
        assert_eq!(
            m.feed(&c, Trigger::Key { vk: 0x74 }, true, true),
            Some(true)
        );
        m.reset();

        assert_eq!(m.feed(&c, Trigger::Key { vk: 0x74 }, false, true), None);
    }
}
