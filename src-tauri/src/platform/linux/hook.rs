use crate::hotkey::{
    HookHotkeyEvent, HotkeyCombo, HotkeyMatcher, MacroHotkey, MouseTrigger, Trigger,
};
use crate::platform::HotkeyHook;
use evdev::{Device, EventType, InputEventKind, Key as EvKey, RelativeAxisType};
use nix::sys::epoll::{Epoll, EpollCreateFlags, EpollEvent, EpollFlags};
use nix::sys::eventfd::{EfdFlags, EventFd};
use std::collections::HashMap;
use std::os::fd::{AsRawFd, BorrowedFd, RawFd};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

const OWN_DEVICE_PREFIX: &str = "ASMacro Virtual";
const RESCAN_TIMEOUT_MS: u16 = 2000;

static HOTKEY: OnceLock<Mutex<Option<HotkeyCombo>>> = OnceLock::new();
static MATCHER: OnceLock<Mutex<HotkeyMatcher>> = OnceLock::new();
static MACRO: OnceLock<Mutex<MacroBindings>> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static HOOK_RUNNING: AtomicBool = AtomicBool::new(false);
static STOP_FD: OnceLock<Mutex<Option<EventFd>>> = OnceLock::new();

#[derive(Default, Clone, Copy)]
struct Modifiers {
    ctrl: bool,
    alt: bool,
    shift: bool,
    win: bool,
}

type MacroBindings = Vec<(MacroHotkey, HotkeyMatcher)>;

#[derive(Clone, serde::Serialize)]
struct MacroHotkeyEvent {
    id: String,
    action: String,
}

fn hotkey_slot() -> &'static Mutex<Option<HotkeyCombo>> {
    HOTKEY.get_or_init(|| Mutex::new(None))
}
fn macro_slot() -> &'static Mutex<MacroBindings> {
    MACRO.get_or_init(|| Mutex::new(Vec::new()))
}
fn matcher_slot() -> &'static Mutex<HotkeyMatcher> {
    MATCHER.get_or_init(|| Mutex::new(HotkeyMatcher::new()))
}
fn stop_fd_slot() -> &'static Mutex<Option<EventFd>> {
    STOP_FD.get_or_init(|| Mutex::new(None))
}

fn current_hotkey() -> Option<HotkeyCombo> {
    *hotkey_slot().lock().unwrap_or_else(|e| e.into_inner())
}

fn emit_state(pressed: bool) {
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(
            "autoclicker-hotkey",
            HookHotkeyEvent {
                state: if pressed { "Pressed" } else { "Released" },
            },
        );
    }
}

fn modifiers_match(combo: &HotkeyCombo, is_down: bool, mods: Modifiers) -> bool {
    !is_down
        || (mods.ctrl == combo.ctrl
            && mods.alt == combo.alt
            && mods.shift == combo.shift
            && mods.win == combo.win)
}

fn handle_trigger_event(trigger: Trigger, is_down: bool, mods: Modifiers) {
    let Some(combo) = current_hotkey() else {
        return;
    };
    let matches = modifiers_match(&combo, is_down, mods);
    let emitted = {
        let mut matcher = matcher_slot().lock().unwrap_or_else(|e| e.into_inner());
        matcher.feed(&combo, trigger, is_down, matches)
    };
    if let Some(pressed) = emitted {
        emit_state(pressed);
    }
}

fn handle_macro_event(trigger: Trigger, is_down: bool, mods: Modifiers) {
    let mut fired: Vec<MacroHotkeyEvent> = Vec::new();
    {
        let mut bindings = macro_slot().lock().unwrap_or_else(|e| e.into_inner());
        for (binding, matcher) in bindings.iter_mut() {
            let matches = modifiers_match(&binding.combo, is_down, mods);
            if matcher.feed(&binding.combo, trigger, is_down, matches) == Some(true) {
                fired.push(MacroHotkeyEvent {
                    id: binding.id.clone(),
                    action: binding.action.clone(),
                });
            }
        }
    }
    if fired.is_empty() {
        return;
    }
    if let Some(app) = APP_HANDLE.get() {
        for event in fired {
            let _ = app.emit("macro-hotkey", event);
        }
    }
}

fn dispatch(trigger: Trigger, is_down: bool, mods: Modifiers) {
    handle_trigger_event(trigger, is_down, mods);
    handle_macro_event(trigger, is_down, mods);
}

fn is_own_device(device: &Device) -> bool {
    device
        .name()
        .map(|n| n.starts_with(OWN_DEVICE_PREFIX))
        .unwrap_or(false)
}

fn seed_modifiers(device: &Device, mods: &mut Modifiers) {
    if let Ok(state) = device.get_key_state() {
        if state.contains(EvKey::KEY_LEFTCTRL) || state.contains(EvKey::KEY_RIGHTCTRL) {
            mods.ctrl = true;
        }
        if state.contains(EvKey::KEY_LEFTALT) || state.contains(EvKey::KEY_RIGHTALT) {
            mods.alt = true;
        }
        if state.contains(EvKey::KEY_LEFTSHIFT) || state.contains(EvKey::KEY_RIGHTSHIFT) {
            mods.shift = true;
        }
        if state.contains(EvKey::KEY_LEFTMETA) || state.contains(EvKey::KEY_RIGHTMETA) {
            mods.win = true;
        }
    }
}

fn mouse_trigger_for(key: EvKey) -> Option<MouseTrigger> {
    match key {
        EvKey::BTN_MIDDLE => Some(MouseTrigger::Middle),
        EvKey::BTN_SIDE => Some(MouseTrigger::XButton1),
        EvKey::BTN_EXTRA => Some(MouseTrigger::XButton2),
        _ => None,
    }
}

fn enumerate_devices() -> Vec<Device> {
    evdev::enumerate()
        .map(|(_, dev)| dev)
        .filter(|d| !is_own_device(d))
        .filter(|d| {
            d.supported_events().contains(EventType::KEY)
                || d.supported_events().contains(EventType::RELATIVE)
        })
        .collect()
}

fn run_hook_thread(stop_fd: RawFd) {
    let mut mods = Modifiers::default();
    let mut devices: HashMap<RawFd, Device> = HashMap::new();
    let epoll = match Epoll::new(EpollCreateFlags::empty()) {
        Ok(e) => e,
        Err(_) => return,
    };
    let stop_borrowed: BorrowedFd = unsafe { BorrowedFd::borrow_raw(stop_fd) };
    let _ = epoll.add(
        stop_borrowed,
        EpollEvent::new(EpollFlags::EPOLLIN, stop_fd as u64),
    );

    let rescan = |epoll: &Epoll, devices: &mut HashMap<RawFd, Device>| {
        for dev in enumerate_devices() {
            let fd = dev.as_raw_fd();
            if !devices.contains_key(&fd) {
                let borrowed: BorrowedFd = unsafe { BorrowedFd::borrow_raw(fd) };
                let _ = epoll.add(borrowed, EpollEvent::new(EpollFlags::EPOLLIN, fd as u64));
                devices.insert(fd, dev);
            }
        }
    };

    rescan(&epoll, &mut devices);
    for dev in devices.values() {
        seed_modifiers(dev, &mut mods);
    }

    let mut events_buf = [EpollEvent::empty(); 32];
    while let Ok(n) = epoll.wait(&mut events_buf, RESCAN_TIMEOUT_MS) {
        if n == 0 {
            rescan(&epoll, &mut devices);
            continue;
        }
        let mut stop_requested = false;
        for ev in &events_buf[..n] {
            let fd = ev.data() as RawFd;
            if fd == stop_fd {
                stop_requested = true;
                continue;
            }
            let Some(dev) = devices.get_mut(&fd) else {
                continue;
            };
            let Ok(events) = dev.fetch_events() else {
                continue;
            };
            for input_event in events {
                match input_event.kind() {
                    InputEventKind::Key(key) => {
                        let value = input_event.value();
                        if value == 2 {
                            continue;
                        }
                        let is_down = value == 1;
                        match key {
                            EvKey::KEY_LEFTCTRL | EvKey::KEY_RIGHTCTRL => mods.ctrl = is_down,
                            EvKey::KEY_LEFTALT | EvKey::KEY_RIGHTALT => mods.alt = is_down,
                            EvKey::KEY_LEFTSHIFT | EvKey::KEY_RIGHTSHIFT => mods.shift = is_down,
                            EvKey::KEY_LEFTMETA | EvKey::KEY_RIGHTMETA => mods.win = is_down,
                            _ => {}
                        }
                        if let Some(button) = mouse_trigger_for(key) {
                            dispatch(Trigger::Mouse { button }, is_down, mods);
                        } else if let Some(vk) = super::keymap::evdev_to_vk(key) {
                            dispatch(Trigger::Key { vk }, is_down, mods);
                        }
                    }
                    InputEventKind::RelAxis(axis) => {
                        let v = input_event.value();
                        match axis {
                            RelativeAxisType::REL_X => {
                                super::pointer::fused_tracker().note_relative_delta(v, 0)
                            }
                            RelativeAxisType::REL_Y => {
                                super::pointer::fused_tracker().note_relative_delta(0, v)
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
        if stop_requested {
            break;
        }
    }
    HOOK_RUNNING.store(false, Ordering::SeqCst);
}

pub struct LinuxHook;

impl LinuxHook {
    pub fn new() -> Self {
        LinuxHook
    }
}

impl HotkeyHook for LinuxHook {
    fn start(&self, app: AppHandle) {
        if HOOK_RUNNING.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = APP_HANDLE.set(app);

        let Ok(evfd) = EventFd::from_flags(EfdFlags::EFD_NONBLOCK) else {
            HOOK_RUNNING.store(false, Ordering::SeqCst);
            return;
        };
        let stop_fd = evfd.as_raw_fd();
        *stop_fd_slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(evfd);

        thread::spawn(move || run_hook_thread(stop_fd));
    }

    fn set_hotkey(&self, combo: Option<HotkeyCombo>) {
        *hotkey_slot().lock().unwrap_or_else(|e| e.into_inner()) = combo;
        matcher_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reset();
    }

    fn set_macro_hotkeys(&self, bindings: Vec<MacroHotkey>) {
        *macro_slot().lock().unwrap_or_else(|e| e.into_inner()) = bindings
            .into_iter()
            .map(|b| (b, HotkeyMatcher::new()))
            .collect();
    }

    fn stop(&self) {
        if let Some(evfd) = stop_fd_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = evfd.write(1);
        }
    }
}
