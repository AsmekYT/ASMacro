use super::*;

#[test]
fn clamp_cps_bounds() {
    assert_eq!(clamp_cps(9999.0), MAX_CPS);
    assert_eq!(clamp_cps(0.0), MIN_CPS);
    assert_eq!(clamp_cps(-5.0), MIN_CPS);
    assert_eq!(clamp_cps(f64::NAN), MIN_CPS);
    assert_eq!(clamp_cps(10.0), 10.0);
}

fn base_config() -> AcConfig {
    AcConfig {
        target: AcTarget::Mouse {
            button: "LEFT".into(),
        },
        cps_min: 10.0,
        cps_max: 10.0,
        hold_ms_min: 10.0,
        hold_ms_max: 10.0,
        double_click: false,
        double_gap_ms: 60.0,
        position: None,
        points: None,
        sequence_loop: true,
        sequence_random: false,
        clicks_per_point: 1,
        limit_clicks: None,
        limit_ms: None,
        edge_stop: None,
    }
}

#[test]
fn normalize_swaps_inverted_cps() {
    let mut cfg = base_config();
    cfg.cps_min = 50.0;
    cfg.cps_max = 5.0;
    normalize(&mut cfg);
    assert!(cfg.cps_min <= cfg.cps_max);
    assert_eq!(cfg.cps_min, 5.0);
    assert_eq!(cfg.cps_max, 50.0);
}

#[test]
fn normalize_clamps_hold() {
    let mut cfg = base_config();
    cfg.hold_ms_min = -5.0;
    cfg.hold_ms_max = -10.0;
    normalize(&mut cfg);
    assert_eq!(cfg.hold_ms_min, 0.0);
    assert_eq!(cfg.hold_ms_max, 0.0);
}

#[test]
fn interval_from_fixed_cps() {
    let cfg = base_config();
    let d = interval_from(&cfg);
    assert!((d.as_secs_f64() - 0.1).abs() < 1e-9);
}

#[test]
fn interval_from_random_range_stays_in_bounds() {
    let mut cfg = base_config();
    cfg.cps_min = 10.0;
    cfg.cps_max = 100.0;
    for _ in 0..200 {
        let d = interval_from(&cfg).as_secs_f64();
        assert!((1.0 / 100.0 - 1e-9..=1.0 / 10.0 + 1e-9).contains(&d));
    }
}

#[test]
fn effective_hold_clamped_below_interval() {
    let interval = Duration::from_millis(2);
    let hold = effective_hold(160.0, interval);
    assert!(hold <= interval.mul_f64(0.8));
}

#[test]
fn effective_hold_passes_through_when_short() {
    let interval = Duration::from_millis(100);
    let hold = effective_hold(10.0, interval);
    assert_eq!(hold, Duration::from_millis(10));
}

#[test]
fn edge_hit_detects_all_sides() {
    let (w, h, m) = (1920, 1080, 5);
    assert!(edge_hit(0, 500, w, h, m, false));
    assert!(edge_hit(1919, 500, w, h, m, false));
    assert!(edge_hit(500, 0, w, h, m, false));
    assert!(edge_hit(500, 1079, w, h, m, false));
    assert!(!edge_hit(960, 540, w, h, m, false));
}

#[test]
fn edge_hit_corners_only() {
    let (w, h, m) = (1920, 1080, 5);
    assert!(edge_hit(0, 0, w, h, m, true));
    assert!(edge_hit(1919, 1079, w, h, m, true));
    assert!(!edge_hit(0, 540, w, h, m, true));
    assert!(!edge_hit(960, 0, w, h, m, true));
}

#[test]
fn next_point_index_walks_and_wraps() {
    assert_eq!(next_point_index(0, 3, true), Some(1));
    assert_eq!(next_point_index(2, 3, true), Some(0));
}

#[test]
fn next_point_index_stops_at_end_without_loop() {
    assert_eq!(next_point_index(1, 3, false), Some(2));
    assert_eq!(next_point_index(2, 3, false), None);
    assert_eq!(next_point_index(0, 0, true), None);
}

#[test]
fn normalize_drops_empty_point_list_and_fixes_clicks_per_point() {
    let mut cfg = base_config();
    cfg.points = Some(vec![]);
    cfg.clicks_per_point = 0;
    normalize(&mut cfg);
    assert!(cfg.points.is_none());
    assert_eq!(cfg.clicks_per_point, 1);
}

#[test]
fn random_point_index_stays_in_bounds() {
    for _ in 0..200 {
        assert!(random_point_index(4) < 4);
    }
    assert_eq!(random_point_index(1), 0);
    assert_eq!(random_point_index(0), 0);
}

#[test]
fn edge_hit_disabled_when_margin_zero() {
    assert!(!edge_hit(0, 0, 1920, 1080, 0, false));
}
