use crate::executor::{failsafe_hit, MACRO_RUNNING};
use crate::input_state::{
    map_key, map_mouse_btn, track_btn_down, track_btn_up, track_key_down, track_key_up,
};
use crate::input_types::{Button, Coordinate, Direction};
use crate::platform;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

mod config;
use config::random_point_index;
pub use config::*;

const POINT_EMIT_THROTTLE: Duration = Duration::from_millis(40);

#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct AcPoint {
    pub index: usize,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct AcState {
    pub running: bool,
    pub reason: Option<StopReason>,
    pub clicks: u64,
}

static AC_RUNNING: AtomicBool = AtomicBool::new(false);
static AC_STOP: AtomicBool = AtomicBool::new(false);
static AC_CLICKS: AtomicU64 = AtomicU64::new(0);
static AC_CONFIG: OnceLock<Mutex<Option<AcConfig>>> = OnceLock::new();
static AC_HANDLE: OnceLock<Mutex<Option<JoinHandle<()>>>> = OnceLock::new();
static AC_STARTED: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn config_slot() -> &'static Mutex<Option<AcConfig>> {
    AC_CONFIG.get_or_init(|| Mutex::new(None))
}

fn handle_slot() -> &'static Mutex<Option<JoinHandle<()>>> {
    AC_HANDLE.get_or_init(|| Mutex::new(None))
}

fn started_slot() -> &'static Mutex<Option<Instant>> {
    AC_STARTED.get_or_init(|| Mutex::new(None))
}

fn snapshot_config() -> Option<AcConfig> {
    config_slot()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub(crate) fn is_running() -> bool {
    AC_RUNNING.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn start_autoclicker(app: AppHandle, mut config: AcConfig) -> Result<(), String> {
    if MACRO_RUNNING.load(Ordering::SeqCst) {
        return Err("MACRO_RUNNING".into());
    }
    platform::input_ready()?;
    normalize(&mut config);
    *config_slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(config);

    if AC_RUNNING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    AC_STOP.store(false, Ordering::SeqCst);
    AC_CLICKS.store(0, Ordering::SeqCst);
    *started_slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());

    let handle = thread::spawn(move || run_loop(app));
    *handle_slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn update_autoclicker_config(mut config: AcConfig) {
    normalize(&mut config);
    *config_slot().lock().unwrap_or_else(|e| e.into_inner()) = Some(config);
}

#[tauri::command(async)]
pub fn stop_autoclicker() {
    AC_STOP.store(true, Ordering::SeqCst);
    let handle = handle_slot()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some(h) = handle {
        let _ = h.join();
    }
}

#[tauri::command]
pub fn autoclicker_status() -> AcStatus {
    let elapsed_ms = started_slot()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .map(|i| i.elapsed().as_millis() as u64)
        .unwrap_or(0);
    AcStatus {
        running: AC_RUNNING.load(Ordering::SeqCst),
        clicks: AC_CLICKS.load(Ordering::SeqCst),
        elapsed_ms,
    }
}

fn press_release_mouse(btn: Button, btn_str: &str, hold: Duration) {
    track_btn_down(btn_str);
    platform::button(btn, Direction::Press);
    precise_sleep_until(Instant::now() + hold);
    platform::button(btn, Direction::Release);
    track_btn_up(btn_str);
}

fn press_release_key(key_str: &str, case_sensitive: bool, hold: Duration) {
    let normalized = if case_sensitive {
        key_str.to_string()
    } else {
        key_str.to_lowercase()
    };
    let Ok(key) = map_key(&normalized) else {
        return;
    };
    track_key_down(&normalized);
    platform::key(key, Direction::Press);
    precise_sleep_until(Instant::now() + hold);
    platform::key(key, Direction::Release);
    track_key_up(&normalized);
}

fn emit_click(cfg: &AcConfig, interval: Duration) {
    let hold_ms = if cfg.hold_ms_max > cfg.hold_ms_min {
        rand::Rng::gen_range(&mut rand::thread_rng(), cfg.hold_ms_min..=cfg.hold_ms_max)
    } else {
        cfg.hold_ms_min
    };
    let hold = effective_hold(hold_ms, interval);
    let gap = Duration::from_secs_f64(cfg.double_gap_ms.max(0.0) / 1000.0);

    match &cfg.target {
        AcTarget::Mouse { button } => {
            let btn = map_mouse_btn(button);
            press_release_mouse(btn, button, hold);
            if cfg.double_click && precise_sleep_until(Instant::now() + gap) {
                press_release_mouse(btn, button, hold);
            }
        }
        AcTarget::Key {
            key,
            case_sensitive,
        } => {
            press_release_key(key, *case_sensitive, hold);
            if cfg.double_click && precise_sleep_until(Instant::now() + gap) {
                press_release_key(key, *case_sensitive, hold);
            }
        }
    }
}

fn precise_sleep_until(deadline: Instant) -> bool {
    const SPIN: Duration = Duration::from_micros(600);
    loop {
        let now = Instant::now();
        if now >= deadline {
            return true;
        }
        let remaining = deadline - now;
        if remaining > SPIN {
            let sleep_for = (remaining - SPIN).min(Duration::from_millis(10));
            thread::sleep(sleep_for);
            if AC_STOP.load(Ordering::Relaxed) {
                return false;
            }
        } else {
            while Instant::now() < deadline {
                std::hint::spin_loop();
            }
            return true;
        }
    }
}

fn run_loop(app: AppHandle) {
    let (sw, sh) = crate::vision::get_screen_size();
    let (sw, sh) = (sw as i32, sh as i32);
    let started = Instant::now();
    let mut next = Instant::now();
    let mut seq_idx: usize = 0;
    let mut point_clicks: u32 = 0;
    let mut emitted_idx: Option<usize> = None;
    let mut last_emit = Instant::now() - POINT_EMIT_THROTTLE;
    let reason;

    loop {
        if AC_STOP.load(Ordering::Relaxed) {
            reason = StopReason::User;
            break;
        }
        let Some(cfg) = snapshot_config() else {
            reason = StopReason::User;
            break;
        };

        if let Some(limit) = cfg.limit_clicks {
            if AC_CLICKS.load(Ordering::Relaxed) >= limit {
                reason = StopReason::ClickLimit;
                break;
            }
        }
        if let Some(limit_ms) = cfg.limit_ms {
            if started.elapsed().as_millis() as u64 >= limit_ms {
                reason = StopReason::TimeLimit;
                break;
            }
        }

        if failsafe_hit() {
            reason = StopReason::Failsafe;
            break;
        }
        let (mx, my) = platform::location().unwrap_or((0, 0));
        if let Some(edge) = cfg.edge_stop {
            if edge_hit(mx, my, sw, sh, edge.margin_px, edge.corners_only) {
                reason = StopReason::Edge;
                break;
            }
        }

        let points = cfg.points.clone().unwrap_or_default();
        if !points.is_empty() {
            if seq_idx >= points.len() {
                seq_idx = 0;
                point_clicks = 0;
            }
            let (x, y) = points[seq_idx];
            if (mx, my) != (x, y) {
                platform::move_mouse(x, y, Coordinate::Abs);
            }
            if emitted_idx != Some(seq_idx) && last_emit.elapsed() >= POINT_EMIT_THROTTLE {
                emitted_idx = Some(seq_idx);
                last_emit = Instant::now();
                let _ = app.emit("autoclicker-point", AcPoint { index: seq_idx });
            }
        } else if let Some((x, y)) = cfg.position {
            if (mx, my) != (x, y) {
                platform::move_mouse(x, y, Coordinate::Abs);
            }
        }

        let interval = interval_from(&cfg);
        emit_click(&cfg, interval);
        AC_CLICKS.fetch_add(1, Ordering::Relaxed);

        if !points.is_empty() {
            point_clicks += 1;
            if point_clicks >= cfg.clicks_per_point.max(1) {
                point_clicks = 0;
                if cfg.sequence_random {
                    seq_idx = random_point_index(points.len());
                } else {
                    match next_point_index(seq_idx, points.len(), cfg.sequence_loop) {
                        Some(i) => seq_idx = i,
                        None => {
                            reason = StopReason::SequenceEnd;
                            break;
                        }
                    }
                }
            }
        }

        next += interval;
        let now = Instant::now();
        if next < now {
            next = now;
        }
        if !precise_sleep_until(next) {
            reason = StopReason::User;
            break;
        }
    }

    AC_RUNNING.store(false, Ordering::SeqCst);
    let clicks = AC_CLICKS.load(Ordering::SeqCst);
    let _ = app.emit(
        "autoclicker-state",
        AcState {
            running: false,
            reason: Some(reason),
            clicks,
        },
    );
}

#[cfg(test)]
mod tests;
