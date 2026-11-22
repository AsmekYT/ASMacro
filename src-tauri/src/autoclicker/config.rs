use serde::Deserialize;
use std::time::Duration;

pub const MIN_CPS: f64 = 0.01;
pub const MAX_CPS: f64 = 500.0;

#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AcTarget {
    Mouse { button: String },
    Key { key: String, case_sensitive: bool },
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct EdgeStop {
    pub margin_px: i32,
    pub corners_only: bool,
}

#[derive(Deserialize, Clone, Debug)]
pub struct AcConfig {
    pub target: AcTarget,
    pub cps_min: f64,
    pub cps_max: f64,
    pub hold_ms_min: f64,
    pub hold_ms_max: f64,
    pub double_click: bool,
    pub double_gap_ms: f64,
    pub position: Option<(i32, i32)>,
    #[serde(default)]
    pub points: Option<Vec<(i32, i32)>>,
    #[serde(default = "default_true")]
    pub sequence_loop: bool,
    #[serde(default)]
    pub sequence_random: bool,
    #[serde(default = "default_clicks_per_point")]
    pub clicks_per_point: u32,
    pub limit_clicks: Option<u64>,
    pub limit_ms: Option<u64>,
    pub edge_stop: Option<EdgeStop>,
}

fn default_true() -> bool {
    true
}

fn default_clicks_per_point() -> u32 {
    1
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct AcStatus {
    pub running: bool,
    pub clicks: u64,
    pub elapsed_ms: u64,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    User,
    ClickLimit,
    TimeLimit,
    Failsafe,
    Edge,
    SequenceEnd,
}

pub fn clamp_cps(v: f64) -> f64 {
    if !v.is_finite() {
        return MIN_CPS;
    }
    v.clamp(MIN_CPS, MAX_CPS)
}

pub fn normalize(cfg: &mut AcConfig) {
    cfg.cps_min = clamp_cps(cfg.cps_min);
    cfg.cps_max = clamp_cps(cfg.cps_max);
    if cfg.cps_min > cfg.cps_max {
        std::mem::swap(&mut cfg.cps_min, &mut cfg.cps_max);
    }
    cfg.hold_ms_min = cfg.hold_ms_min.max(0.0);
    cfg.hold_ms_max = cfg.hold_ms_max.max(cfg.hold_ms_min);
    if cfg.clicks_per_point == 0 {
        cfg.clicks_per_point = 1;
    }
    if let Some(points) = &cfg.points {
        if points.is_empty() {
            cfg.points = None;
        }
    }
}

pub fn next_point_index(idx: usize, len: usize, loop_back: bool) -> Option<usize> {
    if len == 0 {
        return None;
    }
    let next = idx + 1;
    if next < len {
        Some(next)
    } else if loop_back {
        Some(0)
    } else {
        None
    }
}

pub(super) fn random_point_index(len: usize) -> usize {
    if len <= 1 {
        0
    } else {
        rand::Rng::gen_range(&mut rand::thread_rng(), 0..len)
    }
}

pub fn interval_from(cfg: &AcConfig) -> Duration {
    let cps = if cfg.cps_min >= cfg.cps_max {
        cfg.cps_min
    } else {
        rand::Rng::gen_range(&mut rand::thread_rng(), cfg.cps_min..=cfg.cps_max)
    };
    Duration::from_secs_f64(1.0 / clamp_cps(cps))
}

pub fn effective_hold(hold_ms: f64, interval: Duration) -> Duration {
    let cap = interval.mul_f64(0.8);
    let hold = Duration::from_secs_f64((hold_ms.max(0.0) / 1000.0).max(0.0));
    hold.min(cap)
}

pub fn edge_hit(x: i32, y: i32, w: i32, h: i32, margin: i32, corners_only: bool) -> bool {
    if margin <= 0 {
        return false;
    }
    let near_left = x <= margin;
    let near_right = x >= w - margin;
    let near_top = y <= margin;
    let near_bottom = y >= h - margin;
    if corners_only {
        (near_left || near_right) && (near_top || near_bottom)
    } else {
        near_left || near_right || near_top || near_bottom
    }
}
