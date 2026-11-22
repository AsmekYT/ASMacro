use crate::platform::{Frame, ScreenInfo};
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat};

use super::super::x11conn::x11;

pub fn screens() -> Result<Vec<ScreenInfo>, String> {
    let x = x11().ok_or("No X11 display available")?;
    let root = x.root_screen().root;
    let monitors = x
        .conn
        .randr_get_monitors(root, true)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;

    if monitors.monitors.is_empty() {
        let geom = x
            .conn
            .get_geometry(root)
            .map_err(|e| e.to_string())?
            .reply()
            .map_err(|e| e.to_string())?;
        return Ok(vec![ScreenInfo {
            index: 0,
            x: 0,
            y: 0,
            w: geom.width as u32,
            h: geom.height as u32,
            is_primary: true,
            name: None,
        }]);
    }

    Ok(monitors
        .monitors
        .into_iter()
        .enumerate()
        .map(|(i, m)| ScreenInfo {
            index: i,
            x: m.x as i32,
            y: m.y as i32,
            w: m.width as u32,
            h: m.height as u32,
            is_primary: m.primary,
            name: x
                .conn
                .get_atom_name(m.name)
                .ok()
                .and_then(|c| c.reply().ok())
                .map(|r| String::from_utf8_lossy(&r.name).into_owned())
                .filter(|n| !n.is_empty()),
        })
        .collect())
}

pub fn capture_region(x_pos: i32, y_pos: i32, w: u32, h: u32) -> Result<Frame, String> {
    let x = x11().ok_or("No X11 display available")?;
    let root = x.root_screen().root;
    let reply = x
        .conn
        .get_image(
            ImageFormat::Z_PIXMAP,
            root,
            x_pos as i16,
            y_pos as i16,
            w as u16,
            h as u16,
            !0,
        )
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;

    let mut rgba = vec![0u8; (w * h * 4) as usize];
    let src = &reply.data;
    let expected = (w as usize) * (h as usize) * 4;
    if src.len() < expected {
        return Err(format!(
            "GetImage returned {} bytes, expected {expected} (depth mismatch?)",
            src.len()
        ));
    }
    for i in 0..(w as usize * h as usize) {
        let s = i * 4;
        let d = i * 4;
        rgba[d] = src[s + 2];
        rgba[d + 1] = src[s + 1];
        rgba[d + 2] = src[s];
        rgba[d + 3] = 255;
    }
    Ok(Frame { w, h, rgba })
}
