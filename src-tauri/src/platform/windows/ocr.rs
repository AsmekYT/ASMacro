use crate::platform::{OcrBackend, OcrLineBox, OcrLines, OcrWordBox};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

static OCR_ENGINES: OnceLock<Mutex<HashMap<String, OcrEngine>>> = OnceLock::new();

fn ocr_engines() -> &'static Mutex<HashMap<String, OcrEngine>> {
    OCR_ENGINES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn available_langs() -> Vec<String> {
    OcrEngine::AvailableRecognizerLanguages()
        .map(|langs| {
            langs
                .into_iter()
                .filter_map(|l| l.LanguageTag().ok())
                .map(|t| t.to_string_lossy())
                .collect()
        })
        .unwrap_or_default()
}

fn lang_error(requested: Option<&str>) -> String {
    let avail = available_langs();
    if avail.is_empty() {
        "No OCR language packs are installed. Open Windows Settings > Time & Language > \
         Language & region, pick a language, open its Options, and install \
         'Optical character recognition'."
            .to_string()
    } else {
        match requested {
            Some(tag) => format!(
                "OCR language '{}' is not installed. Installed OCR languages: {}.",
                tag,
                avail.join(", ")
            ),
            None => format!(
                "No OCR engine is available for your Windows display languages. \
                 Installed OCR languages: {}. Set the block's Language field explicitly.",
                avail.join(", ")
            ),
        }
    }
}

fn engine_for(lang: Option<&str>) -> Result<OcrEngine, String> {
    let key = lang.unwrap_or_default().to_ascii_lowercase();
    let cache = ocr_engines();
    if let Ok(guard) = cache.lock() {
        if let Some(engine) = guard.get(&key) {
            return Ok(engine.clone());
        }
    }

    let engine = match lang {
        Some(tag) => {
            let language = Language::CreateLanguage(&HSTRING::from(tag))
                .map_err(|_| format!("'{tag}' is not a valid BCP-47 language tag"))?;
            OcrEngine::TryCreateFromLanguage(&language).map_err(|_| lang_error(Some(tag)))?
        }
        None => OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| lang_error(None))?,
    };

    if let Ok(mut guard) = cache.lock() {
        if guard.len() >= 8 {
            guard.clear();
        }
        guard.insert(key, engine.clone());
    }
    Ok(engine)
}

fn to_software_bitmap(img: &image::RgbaImage) -> Result<SoftwareBitmap, String> {
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Err("Empty capture".into());
    }
    let mut buf = img.as_raw().clone();
    for px in buf.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }

    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&buf).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
    SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)
        .map_err(|e| e.to_string())
}

pub struct WindowsOcr;

impl WindowsOcr {
    pub fn new() -> Self {
        WindowsOcr
    }
}

impl OcrBackend for WindowsOcr {
    fn max_dimension(&self) -> u32 {
        OcrEngine::MaxImageDimension().unwrap_or(4096)
    }

    fn read(&self, img: &image::RgbaImage, lang: Option<&str>) -> Result<OcrLines, String> {
        let engine = engine_for(lang)?;
        let bitmap = to_software_bitmap(img)?;
        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| format!("OCR failed to start: {e}"))?
            .join()
            .map_err(|e| format!("OCR failed: {e}"))?;

        let mut lines = Vec::new();
        for line in result.Lines().map_err(|e| e.to_string())?.into_iter() {
            let mut words = Vec::new();
            for word in line.Words().map_err(|e| e.to_string())?.into_iter() {
                let rect = word.BoundingRect().map_err(|e| e.to_string())?;
                words.push(OcrWordBox {
                    text: word.Text().map_err(|e| e.to_string())?.to_string_lossy(),
                    x: rect.X.round() as i32,
                    y: rect.Y.round() as i32,
                    w: rect.Width.round() as i32,
                    h: rect.Height.round() as i32,
                });
            }
            lines.push(OcrLineBox {
                text: line.Text().map_err(|e| e.to_string())?.to_string_lossy(),
                words,
            });
        }

        let language = engine
            .RecognizerLanguage()
            .ok()
            .and_then(|l| l.LanguageTag().ok())
            .map(|t| t.to_string_lossy())
            .unwrap_or_default();

        Ok(OcrLines {
            text: result.Text().map_err(|e| e.to_string())?.to_string_lossy(),
            lines,
            language,
        })
    }
}
