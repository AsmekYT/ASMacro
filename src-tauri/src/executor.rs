use crate::humanize::{
    gauss, hold_time, humanization, humanized_move_to, vary, Humanization, HUMANIZATION,
};
use crate::input_state::{
    map_key, map_mouse_btn, split_combo, track_btn_down, track_btn_up, track_key_down, track_key_up,
};
use crate::input_types::{Axis, Button, Direction};
use crate::platform;
use rand::Rng;
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Deserialize, Debug)]
pub struct MacroAction {
    pub action_type: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub duration: Option<u64>,
    pub button: Option<String>,
    pub click_type: Option<String>,
    pub amount: Option<i32>,
    pub text: Option<String>,
    pub speed: Option<u64>,
    pub key: Option<String>,
    pub modifier: Option<String>,
    pub combo: Option<String>,
}

pub(crate) static ABORT: AtomicBool = AtomicBool::new(false);
static FAILSAFE: AtomicBool = AtomicBool::new(true);
pub(crate) static MACRO_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_execution_config(humanization: Humanization, failsafe: bool) {
    *HUMANIZATION
        .get_or_init(|| Mutex::new(Humanization::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = humanization;
    FAILSAFE.store(failsafe, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_abort(value: bool) {
    ABORT.store(value, Ordering::SeqCst);
}

#[tauri::command]
pub fn set_macro_running(value: bool) {
    MACRO_RUNNING.store(value, Ordering::SeqCst);
}

pub(crate) fn aborted() -> bool {
    ABORT.load(Ordering::SeqCst)
}

pub(crate) fn failsafe_hit() -> bool {
    if !FAILSAFE.load(Ordering::SeqCst) {
        return false;
    }
    let (x, y) = platform::location().unwrap_or((100, 100));
    x <= 1 && y <= 1
}

pub(crate) fn sleep_checked(ms: u64) -> Result<(), String> {
    let mut remaining = ms;
    while remaining > 0 {
        if aborted() {
            return Err("ABORTED".into());
        }
        let chunk = remaining.min(15);
        thread::sleep(Duration::from_millis(chunk));
        remaining -= chunk;
    }
    if aborted() {
        Err("ABORTED".into())
    } else {
        Ok(())
    }
}

fn click_once(btn: Button, btn_str: &str, h: &Humanization) -> Result<(), String> {
    track_btn_down(btn_str);
    platform::button(btn, Direction::Press);
    let hold = hold_time(h, 20);
    thread::sleep(Duration::from_millis(hold));
    platform::button(btn, Direction::Release);
    track_btn_up(btn_str);
    if aborted() {
        Err("ABORTED".into())
    } else {
        Ok(())
    }
}

#[tauri::command(async)]
pub fn execute_single_action(action: MacroAction) -> Result<(), String> {
    if crate::autoclicker::is_running() {
        return Err("AUTOCLICKER_RUNNING".into());
    }
    platform::input_ready()?;
    let h = humanization();

    if aborted() {
        return Err("ABORTED".into());
    }
    if failsafe_hit() {
        ABORT.store(true, Ordering::SeqCst);
        return Err("FAILSAFE".into());
    }

    match action.action_type.as_str() {
        "action_mouse_move" => {
            if let (Some(x), Some(y)) = (action.x, action.y) {
                humanized_move_to(x, y, action.duration.unwrap_or(0), &h)?;
            }
        }
        "action_mouse_move_rel" => {
            if let (Some(x), Some(y)) = (action.x, action.y) {
                let (cx, cy) = platform::location().unwrap_or((0, 0));
                humanized_move_to(cx + x, cy + y, action.duration.unwrap_or(0), &h)?;
            }
        }
        "action_mouse_click" => {
            let btn_str = action.button.unwrap_or_else(|| "LEFT".to_string());
            let btn = map_mouse_btn(&btn_str);

            click_once(btn, &btn_str, &h)?;

            if let Some(click_type) = action.click_type {
                if click_type == "DOUBLE" {
                    let gap = if h.enabled {
                        gauss(100.0, 25.0).clamp(55.0, 180.0) as u64
                    } else {
                        60
                    };
                    sleep_checked(gap)?;
                    click_once(btn, &btn_str, &h)?;
                }
            }
        }
        "action_mouse_down" => {
            let btn_str = action.button.unwrap_or_else(|| "LEFT".to_string());
            track_btn_down(&btn_str);
            platform::button(map_mouse_btn(&btn_str), Direction::Press);
        }
        "action_mouse_up" => {
            let btn_str = action.button.unwrap_or_else(|| "LEFT".to_string());
            platform::button(map_mouse_btn(&btn_str), Direction::Release);
            track_btn_up(&btn_str);
        }
        "action_mouse_scroll" => {
            if let Some(amt) = action.amount {
                if h.enabled && amt.abs() > 2 {
                    let mut remaining = amt;
                    let dir = if amt > 0 { 1 } else { -1 };
                    while remaining != 0 {
                        let chunk = rand::thread_rng().gen_range(1..=2).min(remaining.abs()) * dir;
                        platform::scroll(chunk, Axis::Vertical);
                        remaining -= chunk;
                        sleep_checked(gauss(45.0, 15.0).clamp(15.0, 110.0) as u64)?;
                    }
                } else {
                    platform::scroll(amt, Axis::Vertical);
                }
            }
        }
        "action_keyboard_type" => {
            if let Some(text) = action.text {
                let speed = action.speed.unwrap_or(10);
                if speed > 0 || h.enabled {
                    let base = speed.max(1) as f64;
                    let mut rng = rand::thread_rng();
                    for ch in text.chars() {
                        if aborted() {
                            return Err("ABORTED".into());
                        }
                        platform::text(&ch.to_string());
                        let mut delay = if h.enabled {
                            vary(base, h.variance_pct.max(25.0))
                        } else {
                            base
                        };
                        if h.enabled && rng.gen_bool(0.02) {
                            delay += rng.gen_range(150.0..400.0);
                        }
                        sleep_checked(delay as u64)?;
                    }
                } else {
                    platform::text(&text);
                }
            }
        }
        "action_keyboard_press" => {
            if let Some(k) = action.key {
                let mapped_key = map_key(&k)?;
                track_key_down(&k);
                platform::key(mapped_key, Direction::Press);
                let hold = if h.enabled {
                    gauss(55.0, 15.0).clamp(25.0, 130.0) as u64
                } else {
                    20
                };
                thread::sleep(Duration::from_millis(hold));
                platform::key(mapped_key, Direction::Release);
                track_key_up(&k);
            }
        }
        "action_keyboard_down" => {
            if let Some(k) = action.key {
                let mapped_key = map_key(&k)?;
                track_key_down(&k);
                platform::key(mapped_key, Direction::Press);
            }
        }
        "action_keyboard_up" => {
            if let Some(k) = action.key {
                platform::key(map_key(&k)?, Direction::Release);
                track_key_up(&k);
            }
        }
        "action_keyboard_hotkey" => {
            let combo = action.combo.filter(|c| !c.trim().is_empty()).or_else(|| {
                match (action.modifier.as_deref(), action.key.as_deref()) {
                    (Some(m), Some(k)) => Some(format!("{m}+{k}")),
                    _ => None,
                }
            });
            if let Some(combo) = combo {
                let parts = split_combo(&combo);
                if let Some((trigger, mods)) = parts.split_last() {
                    let mapped_mods = mods
                        .iter()
                        .map(|m| map_key(m))
                        .collect::<Result<Vec<_>, _>>()?;
                    let mapped_trigger = map_key(trigger)?;
                    let gap = |h: &Humanization| {
                        if h.enabled {
                            gauss(25.0, 8.0).clamp(10.0, 60.0) as u64
                        } else {
                            10
                        }
                    };

                    for (name, key) in mods.iter().zip(&mapped_mods) {
                        track_key_down(name);
                        platform::key(*key, Direction::Press);
                        thread::sleep(Duration::from_millis(gap(&h)));
                    }

                    track_key_down(trigger);
                    platform::key(mapped_trigger, Direction::Press);
                    thread::sleep(Duration::from_millis(hold_time(&h, 20)));
                    platform::key(mapped_trigger, Direction::Release);
                    track_key_up(trigger);

                    for (name, key) in mods.iter().zip(&mapped_mods).rev() {
                        thread::sleep(Duration::from_millis(gap(&h)));
                        platform::key(*key, Direction::Release);
                        track_key_up(name);
                    }
                }
            }
        }
        other => return Err(format!("Unknown action type: {other}")),
    }
    Ok(())
}
