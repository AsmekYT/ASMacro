use crate::platform::{CaptureBackend, Frame, Freshness, ScreenInfo};
use screenshots::Screen;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows::core::BOOL;
use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
    DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
    DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
};
use windows::Win32::Foundation::{ERROR_SUCCESS, LPARAM, RECT, TRUE};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};

pub struct WindowsCapture;

impl WindowsCapture {
    pub fn new() -> Self {
        WindowsCapture
    }
}

static SCREENS_CACHE: OnceLock<Mutex<Option<(Instant, Vec<Screen>)>>> = OnceLock::new();

fn screens_cached() -> Result<Vec<Screen>, String> {
    let cache = SCREENS_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cache.lock().map_err(|e| e.to_string())?;
    if let Some((at, screens)) = guard.as_ref() {
        if at.elapsed() < Duration::from_secs(2) && !screens.is_empty() {
            return Ok(screens.clone());
        }
    }
    let screens = Screen::all().map_err(|e| e.to_string())?;
    *guard = Some((Instant::now(), screens.clone()));
    Ok(screens)
}

fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn friendly_names() -> HashMap<String, String> {
    let mut map = HashMap::new();
    unsafe {
        let (mut paths_n, mut modes_n) = (0u32, 0u32);
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut paths_n, &mut modes_n)
            != ERROR_SUCCESS
        {
            return map;
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); paths_n as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); modes_n as usize];
        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut paths_n,
            paths.as_mut_ptr(),
            &mut modes_n,
            modes.as_mut_ptr(),
            None,
        ) != ERROR_SUCCESS
        {
            return map;
        }
        for path in paths.iter().take(paths_n as usize) {
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;
            if DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                continue;
            }
            let mut target = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            target.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            target.header.adapterId = path.targetInfo.adapterId;
            target.header.id = path.targetInfo.id;
            if DisplayConfigGetDeviceInfo(&mut target.header) != 0 {
                continue;
            }
            let gdi = wide_to_string(&source.viewGdiDeviceName);
            let friendly = wide_to_string(&target.monitorFriendlyDeviceName);
            if !gdi.is_empty() && !friendly.is_empty() {
                map.insert(gdi, friendly);
            }
        }
    }
    map
}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _dc: HDC,
    _rect: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let out = &mut *(data.0 as *mut Vec<(RECT, String)>);
    let mut info = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    if GetMonitorInfoW(monitor, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
        out.push((info.monitorInfo.rcMonitor, wide_to_string(&info.szDevice)));
    }
    TRUE
}

fn names_by_rect() -> Vec<(RECT, String)> {
    let friendly = friendly_names();
    let mut found: Vec<(RECT, String)> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(collect_monitor),
            LPARAM(&mut found as *mut _ as isize),
        );
    }
    found
        .into_iter()
        .map(|(rect, gdi)| {
            let name = friendly.get(&gdi).cloned().unwrap_or(gdi);
            (rect, name)
        })
        .collect()
}

fn frame_from(img: screenshots::image::RgbaImage) -> Frame {
    let (w, h) = img.dimensions();
    Frame {
        w,
        h,
        rgba: img.into_raw(),
    }
}

impl CaptureBackend for WindowsCapture {
    fn screens(&self) -> Result<Vec<ScreenInfo>, String> {
        let screens = screens_cached()?;
        let names = names_by_rect();
        Ok(screens
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let d = &s.display_info;
                ScreenInfo {
                    index: i,
                    x: d.x,
                    y: d.y,
                    w: d.width,
                    h: d.height,
                    is_primary: d.is_primary,
                    name: names
                        .iter()
                        .find(|(r, _)| {
                            r.left == d.x
                                && r.top == d.y
                                && (r.right - r.left) as u32 == d.width
                                && (r.bottom - r.top) as u32 == d.height
                        })
                        .map(|(_, n)| n.clone()),
                }
            })
            .collect())
    }

    fn capture_screen(&self, idx: usize) -> Result<Frame, String> {
        let screens = screens_cached()?;
        let screen = *screens
            .get(idx)
            .or_else(|| screens.first())
            .ok_or("No screens found")?;
        let img = screen.capture().map_err(|e| e.to_string())?;
        Ok(frame_from(img))
    }

    fn capture_region(
        &self,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
        _fresh: Freshness,
    ) -> Result<(Frame, i32, i32), String> {
        let screens = screens_cached()?;
        let screen = screens
            .iter()
            .find(|s| {
                let d = s.display_info;
                x >= d.x && x < d.x + d.width as i32 && y >= d.y && y < d.y + d.height as i32
            })
            .ok_or("Point outside all screens")?;
        let d = screen.display_info;
        let rel_x = (x - d.x).max(0);
        let rel_y = (y - d.y).max(0);
        let max_w = (d.width as i32 - rel_x).max(0) as u32;
        let max_h = (d.height as i32 - rel_y).max(0) as u32;
        let cw = w.min(max_w);
        let ch = h.min(max_h);
        if cw == 0 || ch == 0 {
            return Err("Region outside screen bounds".into());
        }
        let img = screen
            .capture_area(rel_x, rel_y, cw, ch)
            .map_err(|e| e.to_string())?;
        Ok((frame_from(img), d.x + rel_x, d.y + rel_y))
    }
}
