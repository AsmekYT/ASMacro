use crate::hotkey::{HookHotkeyEvent, HotkeyCombo, HotkeyMatcher, MouseTrigger, Trigger};
use crate::platform::HotkeyHook;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
    LLKHF_LOWER_IL_INJECTED, LLMHF_INJECTED, LLMHF_LOWER_IL_INJECTED, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_QUIT,
    WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

const XBUTTON1: u16 = 1;
const XBUTTON2: u16 = 2;

static HOTKEY: OnceLock<Mutex<Option<HotkeyCombo>>> = OnceLock::new();
static MATCHER: OnceLock<Mutex<HotkeyMatcher>> = OnceLock::new();
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static HOOK_RUNNING: AtomicBool = AtomicBool::new(false);
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

fn hotkey_slot() -> &'static Mutex<Option<HotkeyCombo>> {
    HOTKEY.get_or_init(|| Mutex::new(None))
}

fn matcher_slot() -> &'static Mutex<HotkeyMatcher> {
    MATCHER.get_or_init(|| Mutex::new(HotkeyMatcher::new()))
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

fn modifiers_match(combo: &HotkeyCombo) -> bool {
    unsafe {
        let down = |vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY| {
            (GetKeyState(vk.0 as i32) as u16 & 0x8000) != 0
        };
        let ctrl = down(VK_CONTROL);
        let alt = down(VK_MENU);
        let shift = down(VK_SHIFT);
        let win = down(VK_LWIN) || down(VK_RWIN);
        ctrl == combo.ctrl && alt == combo.alt && shift == combo.shift && win == combo.win
    }
}

fn handle_trigger_event(trigger: Trigger, is_down: bool) {
    let Some(combo) = current_hotkey() else {
        return;
    };
    let matches = !is_down || modifiers_match(&combo);
    let emitted = {
        let mut matcher = matcher_slot().lock().unwrap_or_else(|e| e.into_inner());
        matcher.feed(&combo, trigger, is_down, matches)
    };
    if let Some(pressed) = emitted {
        emit_state(pressed);
    }
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let injected = (info.flags.0 & (LLKHF_INJECTED.0 | LLKHF_LOWER_IL_INJECTED.0)) != 0;
        if !injected {
            let msg = wparam.0 as u32;
            let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
            if is_down || is_up {
                handle_trigger_event(Trigger::Key { vk: info.vkCode }, is_down);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let injected = (info.flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0;
        if !injected {
            let msg = wparam.0 as u32;
            match msg {
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    let xbutton = ((info.mouseData >> 16) & 0xFFFF) as u16;
                    let button = if xbutton == XBUTTON1 {
                        MouseTrigger::XButton1
                    } else if xbutton == XBUTTON2 {
                        MouseTrigger::XButton2
                    } else {
                        return CallNextHookEx(None, code, wparam, lparam);
                    };
                    handle_trigger_event(Trigger::Mouse { button }, msg == WM_XBUTTONDOWN);
                }
                WM_MBUTTONDOWN | WM_MBUTTONUP => {
                    handle_trigger_event(
                        Trigger::Mouse {
                            button: MouseTrigger::Middle,
                        },
                        msg == WM_MBUTTONDOWN,
                    );
                }
                _ => {}
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub struct WindowsHook;

impl WindowsHook {
    pub fn new() -> Self {
        WindowsHook
    }
}

impl HotkeyHook for WindowsHook {
    fn start(&self, app: AppHandle) {
        if HOOK_RUNNING.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = APP_HANDLE.set(app);

        thread::spawn(|| unsafe {
            HOOK_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);

            let kb_hook = match SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                Some(HINSTANCE::default()),
                0,
            ) {
                Ok(h) => h,
                Err(_) => {
                    HOOK_RUNNING.store(false, Ordering::SeqCst);
                    return;
                }
            };
            let mouse_hook = match SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                Some(HINSTANCE::default()),
                0,
            ) {
                Ok(h) => h,
                Err(_) => {
                    let _ = UnhookWindowsHookEx(kb_hook);
                    HOOK_RUNNING.store(false, Ordering::SeqCst);
                    return;
                }
            };

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            let _ = UnhookWindowsHookEx(kb_hook);
            let _ = UnhookWindowsHookEx(mouse_hook);
            HOOK_RUNNING.store(false, Ordering::SeqCst);
        });
    }

    fn set_hotkey(&self, combo: Option<HotkeyCombo>) {
        *hotkey_slot().lock().unwrap_or_else(|e| e.into_inner()) = combo;
        matcher_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reset();
    }

    fn set_macro_hotkeys(&self, _bindings: Vec<crate::hotkey::MacroHotkey>) {}

    fn stop(&self) {
        let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
        if tid == 0 {
            return;
        }
        unsafe {
            let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}
