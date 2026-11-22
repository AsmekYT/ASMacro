use crate::executor::{aborted, failsafe_hit, sleep_checked, ABORT};
use crate::input_types::Coordinate;
use crate::platform;
use rand::Rng;
use serde::Deserialize;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Humanization {
    pub enabled: bool,
    pub speed_mult: f64,
    pub jitter_px: f64,
    pub variance_pct: f64,
    pub overshoot: bool,
}

impl Default for Humanization {
    fn default() -> Self {
        Humanization {
            enabled: false,
            speed_mult: 1.0,
            jitter_px: 2.0,
            variance_pct: 20.0,
            overshoot: true,
        }
    }
}

pub(crate) static HUMANIZATION: OnceLock<Mutex<Humanization>> = OnceLock::new();

pub(crate) fn humanization() -> Humanization {
    *HUMANIZATION
        .get_or_init(|| Mutex::new(Humanization::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn gauss(mean: f64, sigma: f64) -> f64 {
    let mut rng = rand::thread_rng();
    let u1: f64 = rng.gen_range(f64::EPSILON..1.0);
    let u2: f64 = rng.gen_range(0.0..1.0);
    mean + sigma * (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos()
}

pub(crate) fn vary(value: f64, pct: f64) -> f64 {
    (value * (1.0 + gauss(0.0, pct / 100.0))).max(value * 0.4)
}

pub(crate) fn hold_time(h: &Humanization, default_ms: u64) -> u64 {
    if !h.enabled {
        return default_ms;
    }
    gauss(70.0, 22.0).clamp(35.0, 160.0) as u64
}

fn min_jerk(t: f64) -> f64 {
    t * t * t * (10.0 - 15.0 * t + 6.0 * t * t)
}

fn cubic_bezier(
    p0: (f64, f64),
    p1: (f64, f64),
    p2: (f64, f64),
    p3: (f64, f64),
    t: f64,
) -> (f64, f64) {
    let u = 1.0 - t;
    let x = u * u * u * p0.0 + 3.0 * u * u * t * p1.0 + 3.0 * u * t * t * p2.0 + t * t * t * p3.0;
    let y = u * u * u * p0.1 + 3.0 * u * u * t * p1.1 + 3.0 * u * t * t * p2.1 + t * t * t * p3.1;
    (x, y)
}

fn fitts_duration(distance: f64) -> f64 {
    80.0 + 130.0 * (distance / 20.0 + 1.0).log2()
}

fn curved_move(
    from: (i32, i32),
    to: (f64, f64),
    duration_ms: f64,
    h: &Humanization,
) -> Result<(), String> {
    let p0 = (from.0 as f64, from.1 as f64);
    let p3 = to;
    let dx = p3.0 - p0.0;
    let dy = p3.1 - p0.1;
    let dist = (dx * dx + dy * dy).sqrt();

    if dist < 1.0 {
        return Ok(());
    }

    let (nx, ny) = (-dy / dist, dx / dist);
    let bend = dist * 0.08;
    let o1 = gauss(0.0, bend);
    let o2 = gauss(0.0, bend);
    let p1 = (p0.0 + dx * 0.3 + nx * o1, p0.1 + dy * 0.3 + ny * o1);
    let p2 = (p0.0 + dx * 0.7 + nx * o2, p0.1 + dy * 0.7 + ny * o2);

    let step_ms = 8.0;
    let steps = ((duration_ms / step_ms).round() as i32).max(2);

    for i in 1..=steps {
        if aborted() {
            return Err("ABORTED".into());
        }
        if i % 8 == 0 && failsafe_hit() {
            ABORT.store(true, Ordering::SeqCst);
            return Err("FAILSAFE".into());
        }
        let t = min_jerk(i as f64 / steps as f64);
        let (x, y) = cubic_bezier(p0, p1, p2, p3, t);
        let (jx, jy) = if h.enabled && i < steps {
            (gauss(0.0, 0.6), gauss(0.0, 0.6))
        } else {
            (0.0, 0.0)
        };
        platform::move_mouse(
            (x + jx).round() as i32,
            (y + jy).round() as i32,
            Coordinate::Abs,
        );
        thread::sleep(Duration::from_millis(step_ms as u64));
    }
    platform::move_mouse(p3.0.round() as i32, p3.1.round() as i32, Coordinate::Abs);
    Ok(())
}

pub(crate) fn humanized_move_to(
    tx: i32,
    ty: i32,
    base_duration: u64,
    h: &Humanization,
) -> Result<(), String> {
    let start = platform::location().unwrap_or((0, 0));

    let (fx, fy) = if h.enabled && h.jitter_px > 0.0 {
        (
            tx as f64 + gauss(0.0, h.jitter_px),
            ty as f64 + gauss(0.0, h.jitter_px),
        )
    } else {
        (tx as f64, ty as f64)
    };

    let dx = fx - start.0 as f64;
    let dy = fy - start.1 as f64;
    let dist = (dx * dx + dy * dy).sqrt();

    let mut duration = if base_duration > 0 {
        base_duration as f64
    } else if h.enabled {
        fitts_duration(dist)
    } else {
        0.0
    };
    if h.enabled {
        duration = vary(duration, h.variance_pct) / h.speed_mult.max(0.1);
    }

    if duration < 16.0 {
        if !h.enabled {
            platform::move_mouse(fx.round() as i32, fy.round() as i32, Coordinate::Abs);
            return Ok(());
        }
        duration = 16.0;
    }

    let mut rng = rand::thread_rng();
    if h.enabled && h.overshoot && dist > 150.0 && rng.gen_bool(0.3) {
        let over = gauss(8.0, 3.0).clamp(3.0, 18.0);
        let ox = fx + dx / dist * over;
        let oy = fy + dy / dist * over;
        curved_move(start, (ox, oy), duration * 0.85, h)?;
        sleep_checked(gauss(40.0, 12.0).clamp(15.0, 90.0) as u64)?;
        let mid = platform::location().unwrap_or((ox.round() as i32, oy.round() as i32));
        curved_move(mid, (fx, fy), (duration * 0.2).max(40.0), h)?;
    } else {
        curved_move(start, (fx, fy), duration, h)?;
    }
    Ok(())
}
