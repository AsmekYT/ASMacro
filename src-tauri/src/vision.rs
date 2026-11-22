use crate::platform::{self, Freshness};
use base64::Engine;
use image::ImageFormat;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

pub(crate) type ScreenImage = image::RgbaImage;

#[derive(Serialize)]
pub struct ScreenshotResult {
    pub data_url: String,
    pub display_x: i32,
    pub display_y: i32,
    pub display_w: u32,
    pub display_h: u32,
    pub image_w: u32,
    pub image_h: u32,
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Region {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize)]
pub struct MatchResult {
    pub x: i32,
    pub y: i32,
    pub confidence: f32,
}

static PIXEL_CACHE: OnceLock<Mutex<HashMap<String, [u8; 3]>>> = OnceLock::new();
type FrameCache = Mutex<HashMap<String, (u32, u32, Vec<u8>)>>;

static FRAME_CACHE: OnceLock<FrameCache> = OnceLock::new();
static TEMPLATE_CACHE: OnceLock<Mutex<HashMap<u64, Arc<image::RgbaImage>>>> = OnceLock::new();

fn pixel_cache() -> &'static Mutex<HashMap<String, [u8; 3]>> {
    PIXEL_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn frame_cache() -> &'static FrameCache {
    FRAME_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn primary_screen_region() -> Result<Region, String> {
    let screens = platform::capture().screens()?;
    let screen = screens
        .iter()
        .find(|s| s.is_primary)
        .or_else(|| screens.first())
        .ok_or_else(|| "No screens found".to_string())?;
    Ok(Region {
        x: screen.x,
        y: screen.y,
        w: screen.w,
        h: screen.h,
    })
}

fn capture_targets(region: Option<Region>) -> Result<Vec<(ScreenImage, i32, i32)>, String> {
    match region {
        Some(r) if r.w > 0 && r.h > 0 => {
            let (img, gx, gy, _, _) = capture_region(r)?;
            Ok(vec![(img, gx, gy)])
        }
        _ => {
            let screens = platform::capture().screens()?;
            let mut out = Vec::new();
            for s in screens {
                if let Ok(frame) = platform::capture().capture_screen(s.index) {
                    out.push((frame.into_image(), s.x, s.y));
                }
            }
            if out.is_empty() {
                return Err("No screens captured".into());
            }
            Ok(out)
        }
    }
}

pub(crate) fn capture_region(r: Region) -> Result<(ScreenImage, i32, i32, u32, u32), String> {
    let (frame, gx, gy) =
        platform::capture().capture_region(r.x, r.y, r.w, r.h, Freshness::Latest)?;
    let (w, h) = (frame.w, frame.h);
    Ok((frame.into_image(), gx, gy, w, h))
}

#[tauri::command]
pub fn list_screens() -> Result<Vec<platform::ScreenInfo>, String> {
    platform::capture().screens()
}

#[tauri::command(async)]
pub fn take_screenshot(screen_index: Option<usize>) -> Result<ScreenshotResult, String> {
    let screens = platform::capture().screens()?;
    if screens.is_empty() {
        return Err("No screens found".into());
    }

    let idx = screen_index.unwrap_or(0).min(screens.len() - 1);
    let display = &screens[idx];
    let (dx, dy, dw, dh) = (display.x, display.y, display.w, display.h);
    let frame = platform::capture().capture_screen(idx)?;
    let (iw, ih) = (frame.w, frame.h);
    let image = frame.into_image();

    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let png_bytes = buffer.into_inner();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    Ok(ScreenshotResult {
        data_url: format!("data:image/png;base64,{b64}"),
        display_x: dx,
        display_y: dy,
        display_w: dw,
        display_h: dh,
        image_w: iw,
        image_h: ih,
    })
}

fn pixel_rgb_at(x: i32, y: i32) -> Result<[u8; 3], String> {
    let (frame, _, _) = platform::capture().capture_region(x, y, 1, 1, Freshness::Latest)?;
    let img = frame.into_image();
    let pixel = img.get_pixel(0, 0);
    Ok([pixel[0], pixel[1], pixel[2]])
}

#[tauri::command(async)]
pub fn get_pixel_color(x: i32, y: i32) -> Result<String, String> {
    let [r, g, b] = pixel_rgb_at(x, y)?;
    Ok(format!("#{r:02X}{g:02X}{b:02X}"))
}

#[tauri::command(async)]
pub fn pixel_changed(
    x: i32,
    y: i32,
    tolerance: u32,
    cache_key: Option<String>,
) -> Result<bool, String> {
    let rgb = pixel_rgb_at(x, y)?;
    let key = format!("{}:{},{}", cache_key.unwrap_or_default(), x, y);
    let mut cache = pixel_cache().lock().map_err(|e| e.to_string())?;
    match cache.insert(key, rgb) {
        Some(prev) => Ok(rgb_diff(&prev, 0, &rgb, 0) > tolerance),
        None => Ok(false),
    }
}

#[tauri::command(async)]
pub fn region_change_percent(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    tolerance: u32,
    cache_key: Option<String>,
) -> Result<f32, String> {
    let (img, _, _, cw, ch) = capture_region(Region { x, y, w, h })?;
    let raw = img.into_raw();
    let key = format!("{}:{},{},{},{}", cache_key.unwrap_or_default(), x, y, w, h);

    let mut cache = frame_cache().lock().map_err(|e| e.to_string())?;
    let pct = match cache.get(&key) {
        Some((pw, ph, prev)) if *pw == cw && *ph == ch && prev.len() == raw.len() => {
            let total = (cw as u64) * (ch as u64);
            let mut changed: u64 = 0;
            for (a, b) in prev.as_chunks::<4>().0.iter().zip(raw.as_chunks::<4>().0) {
                if rgb_diff(a, 0, b, 0) > tolerance {
                    changed += 1;
                }
            }
            if total > 0 {
                (changed as f32 / total as f32) * 100.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    cache.insert(key, (cw, ch, raw));
    Ok(pct)
}

#[tauri::command]
pub fn reset_vision_caches() {
    if let Ok(mut c) = pixel_cache().lock() {
        c.clear();
    }
    if let Ok(mut c) = frame_cache().lock() {
        c.clear();
    }
    crate::programs::reset_confirmed_programs();
}

#[tauri::command(async)]
pub fn find_color_on_screen(
    hex: String,
    tolerance: u32,
    region: Option<Region>,
) -> Result<Option<(i32, i32)>, String> {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return Ok(None);
    }
    let tr = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
    let tg = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
    let tb = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
    let target = [tr, tg, tb];

    let step: usize = if region.map(|r| r.w > 0 && r.h > 0).unwrap_or(false) {
        1
    } else {
        2
    };

    for (img, ox, oy) in capture_targets(region)? {
        let (s_w, s_h) = img.dimensions();
        let raw = img.as_raw();
        let stride = s_w as usize * 4;
        for y in (0..s_h as usize).step_by(step) {
            let row = y * stride;
            for x in (0..s_w as usize).step_by(step) {
                let i = row + x * 4;
                if rgb_diff(raw, i, &target, 0) <= tolerance {
                    return Ok(Some((ox + x as i32, oy + y as i32)));
                }
            }
        }
    }
    Ok(None)
}

fn decode_template_cached(template_b64: &str) -> Result<Arc<image::RgbaImage>, String> {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    template_b64.hash(&mut hasher);
    let key = hasher.finish();

    let cache = TEMPLATE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(tpl) = guard.get(&key) {
            return Ok(tpl.clone());
        }
    }

    let b64_data = template_b64.split(',').next_back().unwrap_or(template_b64);
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(b64_data)
        .map_err(|e| e.to_string())?;
    let template_img = image::load_from_memory(&decoded).map_err(|e| e.to_string())?;
    let tpl = Arc::new(template_img.to_rgba8());

    if let Ok(mut guard) = cache.lock() {
        if guard.len() >= 32 {
            guard.clear();
        }
        guard.insert(key, tpl.clone());
    }
    Ok(tpl)
}

#[inline]
fn rgb_diff(a: &[u8], i: usize, b: &[u8], j: usize) -> u32 {
    a[i].abs_diff(b[j]) as u32
        + a[i + 1].abs_diff(b[j + 1]) as u32
        + a[i + 2].abs_diff(b[j + 2]) as u32
}

fn scan_step(t_w: u32, t_h: u32) -> usize {
    if t_w.min(t_h) <= 24 {
        1
    } else {
        2
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn find_template_in_frame(
    s_raw: &[u8],
    s_w: u32,
    s_h: u32,
    tpl_raw: &[u8],
    t_w: u32,
    t_h: u32,
    tolerance: u32,
    min_conf: f32,
) -> Option<(u32, u32, f32)> {
    if t_w == 0 || t_h == 0 || t_w > s_w || t_h > s_h {
        return None;
    }

    let s_stride = s_w as usize * 4;
    let t_stride = t_w as usize * 4;
    let reject = (tolerance * 2).max(60);
    let test_points = [
        (0u32, 0u32),
        (t_w - 1, 0),
        (0, t_h - 1),
        (t_w - 1, t_h - 1),
        (t_w / 2, t_h / 2),
    ];

    let step = scan_step(t_w, t_h);
    let sample = step;

    let found_near_perfect = AtomicBool::new(false);
    let ys: Vec<u32> = (0..=(s_h - t_h)).step_by(step).collect();

    ys.par_iter()
        .filter_map(|&y| {
            if found_near_perfect.load(Ordering::Relaxed) {
                return None;
            }
            let mut row_best: Option<(u32, u32, f32)> = None;

            'pos: for x in (0..=(s_w - t_w) as usize).step_by(step) {
                for &(tx, ty) in &test_points {
                    let si = (y + ty) as usize * s_stride + (x + tx as usize) * 4;
                    let ti = ty as usize * t_stride + tx as usize * 4;
                    if rgb_diff(s_raw, si, tpl_raw, ti) > reject {
                        continue 'pos;
                    }
                }

                let mut total: u64 = 0;
                let mut count: u64 = 0;
                for ty in (0..t_h as usize).step_by(sample) {
                    let s_row = (y as usize + ty) * s_stride + x * 4;
                    let t_row = ty * t_stride;
                    for tx in (0..t_w as usize).step_by(sample) {
                        total += rgb_diff(s_raw, s_row + tx * 4, tpl_raw, t_row + tx * 4) as u64;
                        count += 1;
                    }
                }
                if count == 0 {
                    continue;
                }
                let avg = total as f32 / count as f32;
                let confidence = (1.0 - avg / 765.0) * 100.0;

                if confidence >= min_conf {
                    let better = row_best.map(|b| confidence > b.2).unwrap_or(true);
                    if better {
                        row_best = Some((x as u32, y, confidence));
                        if confidence >= 97.0 {
                            found_near_perfect.store(true, Ordering::Relaxed);
                            break;
                        }
                    }
                }
            }
            row_best
        })
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
}

#[tauri::command(async)]
pub fn find_template_on_screen(
    template_b64: String,
    tolerance: u32,
    min_confidence: Option<f32>,
    region: Option<Region>,
) -> Result<Option<MatchResult>, String> {
    let min_conf = min_confidence.unwrap_or(70.0).clamp(0.0, 100.0);

    let tpl = decode_template_cached(&template_b64)?;
    let (t_w, t_h) = tpl.dimensions();
    if t_w == 0 || t_h == 0 {
        return Ok(None);
    }
    let tpl_raw = tpl.as_raw();

    let mut best: Option<MatchResult> = None;

    for (screen_img, ox, oy) in capture_targets(region)? {
        let (s_w, s_h) = screen_img.dimensions();
        let screen_best = find_template_in_frame(
            screen_img.as_raw(),
            s_w,
            s_h,
            tpl_raw,
            t_w,
            t_h,
            tolerance,
            min_conf,
        );

        if let Some((x, y, confidence)) = screen_best {
            let candidate = MatchResult {
                x: ox + (x + t_w / 2) as i32,
                y: oy + (y + t_h / 2) as i32,
                confidence,
            };
            let better = best
                .as_ref()
                .map(|b| confidence > b.confidence)
                .unwrap_or(true);
            if better {
                let near_perfect = confidence >= 97.0;
                best = Some(candidate);
                if near_perfect {
                    return Ok(best);
                }
            }
        }
    }
    Ok(best)
}

#[tauri::command]
pub fn get_mouse_pos() -> (i32, i32) {
    platform::location().unwrap_or((0, 0))
}

#[tauri::command]
pub fn get_screen_size() -> (u32, u32) {
    if let Ok(screens) = platform::capture().screens() {
        if let Some(s) = screens.first() {
            return (s.w, s.h);
        }
    }
    (1920, 1080)
}

#[cfg(test)]
mod template_tests {
    use super::*;

    fn frame(w: u32, h: u32, colour: [u8; 4]) -> Vec<u8> {
        colour
            .iter()
            .cycle()
            .take(w as usize * h as usize * 4)
            .copied()
            .collect()
    }

    fn blit(dst: &mut [u8], dst_w: u32, src: &[u8], src_w: u32, src_h: u32, x: u32, y: u32) {
        for row in 0..src_h as usize {
            let d = (y as usize + row) * dst_w as usize * 4 + x as usize * 4;
            let s = row * src_w as usize * 4;
            dst[d..d + src_w as usize * 4].copy_from_slice(&src[s..s + src_w as usize * 4]);
        }
    }

    #[test]
    fn finds_small_template_at_an_odd_offset() {
        let (s_w, s_h) = (80u32, 60u32);
        let (t_w, t_h) = (6u32, 6u32);

        let mut screen = frame(s_w, s_h, [10, 10, 10, 255]);
        let mut tpl = frame(t_w, t_h, [250, 30, 30, 255]);
        tpl[0..4].copy_from_slice(&[0, 0, 250, 255]);

        blit(&mut screen, s_w, &tpl, t_w, t_h, 7, 5);

        let hit = find_template_in_frame(&screen, s_w, s_h, &tpl, t_w, t_h, 30, 80.0);
        assert_eq!(hit.map(|(x, y, _)| (x, y)), Some((7, 5)));
    }

    #[test]
    fn reports_no_match_when_the_template_is_absent() {
        let screen = frame(40, 40, [10, 10, 10, 255]);
        let tpl = frame(5, 5, [250, 30, 30, 255]);
        assert!(find_template_in_frame(&screen, 40, 40, &tpl, 5, 5, 30, 80.0).is_none());
    }

    #[test]
    fn large_templates_keep_the_faster_scan_step() {
        assert_eq!(scan_step(8, 8), 1);
        assert_eq!(scan_step(24, 200), 1);
        assert_eq!(scan_step(25, 25), 2);
    }

    #[test]
    fn webp_template_decodes_lossless() {
        let mut rgba = frame(7, 5, [10, 200, 30, 255]);
        rgba[0] = 250;
        let mut buf = Vec::new();
        image::codecs::webp::WebPEncoder::new_lossless(&mut buf)
            .encode(&rgba, 7, 5, image::ExtendedColorType::Rgba8)
            .unwrap();
        let url = format!(
            "data:image/webp;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&buf)
        );
        let tpl = decode_template_cached(&url).unwrap();
        assert_eq!(tpl.as_raw(), &rgba);
    }
}
