use crate::platform;
use crate::vision::{capture_region, primary_screen_region, Region};
use image::imageops::{resize, FilterType};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct OcrWordBox {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Serialize, Clone)]
pub struct OcrLineBox {
    pub text: String,
    pub words: Vec<OcrWordBox>,
}

#[derive(Serialize)]
pub struct OcrResultDto {
    pub text: String,
    pub lines: Vec<OcrLineBox>,
    pub language: String,
}

fn choose_scale(w0: u32, h0: u32, max_dim: u32) -> f32 {
    let mut scale: f32 = if h0 < 200 {
        3.0
    } else if h0 < 500 {
        2.0
    } else {
        1.0
    };
    while scale > 1.0
        && ((w0 as f32 * scale) as u32 > max_dim || (h0 as f32 * scale) as u32 > max_dim)
    {
        scale -= 1.0;
    }
    scale
}

#[tauri::command(async)]
pub fn ocr_read_region(
    region: Option<Region>,
    lang: Option<String>,
) -> Result<OcrResultDto, String> {
    let target = match region {
        Some(r) if r.w > 0 && r.h > 0 => r,
        _ => primary_screen_region()?,
    };
    let (img, ox, oy, _, _) = capture_region(target)?;
    let lang = lang.as_deref().map(str::trim).filter(|t| !t.is_empty());

    let backend = platform::ocr();
    let (w0, h0) = img.dimensions();
    let max_dim = backend.max_dimension();
    if w0.max(h0) > max_dim {
        return Err(format!(
            "Region {w0}x{h0} exceeds the OCR engine's max dimension of {max_dim}px. Pick a smaller region."
        ));
    }
    let scale = choose_scale(w0, h0, max_dim);

    let scaled;
    let src: &image::RgbaImage = if scale > 1.0 {
        scaled = resize(
            &img,
            (w0 as f32 * scale) as u32,
            (h0 as f32 * scale) as u32,
            FilterType::CatmullRom,
        );
        &scaled
    } else {
        &img
    };

    let result = backend.read(src, lang)?;

    let to_global_x = |v: i32| ox + (v as f32 / scale).round() as i32;
    let to_global_y = |v: i32| oy + (v as f32 / scale).round() as i32;
    let scale_back = |v: i32| (v as f32 / scale).round() as i32;

    let lines = result
        .lines
        .into_iter()
        .map(|line| OcrLineBox {
            text: line.text,
            words: line
                .words
                .into_iter()
                .map(|w| OcrWordBox {
                    text: w.text,
                    x: to_global_x(w.x),
                    y: to_global_y(w.y),
                    w: scale_back(w.w),
                    h: scale_back(w.h),
                })
                .collect(),
        })
        .collect();

    Ok(OcrResultDto {
        text: result.text,
        lines,
        language: result.language,
    })
}
