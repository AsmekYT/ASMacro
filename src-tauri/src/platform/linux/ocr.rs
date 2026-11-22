use crate::platform::{OcrBackend, OcrLineBox, OcrLines, OcrWordBox};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub struct LinuxOcr;

impl LinuxOcr {
    pub fn new() -> Self {
        LinuxOcr
    }
}

impl Default for LinuxOcr {
    fn default() -> Self {
        Self::new()
    }
}

fn tesseract_bin() -> String {
    if let Some(appdir) = std::env::var_os("APPDIR") {
        let bundled = Path::new(&appdir).join("usr/bin/tesseract");
        if bundled.is_file() {
            return bundled.to_string_lossy().to_string();
        }
    }
    "tesseract".to_string()
}

const LANG_TABLE: &[(&str, &str)] = &[
    ("en", "eng"),
    ("de", "deu"),
    ("fr", "fra"),
    ("es", "spa"),
    ("it", "ita"),
    ("pt", "por"),
    ("nl", "nld"),
    ("pl", "pol"),
    ("ru", "rus"),
    ("ja", "jpn"),
    ("ko", "kor"),
    ("zh", "chi_sim"),
    ("uk", "ukr"),
    ("cs", "ces"),
    ("sv", "swe"),
    ("tr", "tur"),
    ("ar", "ara"),
    ("hi", "hin"),
    ("vi", "vie"),
    ("ro", "ron"),
];

fn bcp47_to_tesseract(lang: &str) -> String {
    let primary = lang.split('-').next().unwrap_or(lang).to_ascii_lowercase();
    LANG_TABLE
        .iter()
        .find(|(bcp, _)| *bcp == primary)
        .map(|(_, t)| t.to_string())
        .unwrap_or(primary)
}

fn tesseract_to_bcp47(code: &str) -> String {
    LANG_TABLE
        .iter()
        .find(|(_, t)| *t == code)
        .map(|(bcp, _)| bcp.to_string())
        .unwrap_or_else(|| code.to_string())
}

fn list_langs() -> Vec<String> {
    let Ok(output) = Command::new(tesseract_bin())
        .arg("--list-langs")
        .stderr(Stdio::null())
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .skip(1)
        .filter(|l| !l.trim().is_empty())
        .map(|l| tesseract_to_bcp47(l.trim()))
        .collect()
}

struct TsvWord {
    block: i32,
    par: i32,
    line: i32,
    left: i32,
    top: i32,
    width: i32,
    height: i32,
    text: String,
}

fn parse_tsv(tsv: &str) -> Vec<TsvWord> {
    let mut words = Vec::new();
    for line in tsv.lines().skip(1) {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 12 {
            continue;
        }
        let level: i32 = cols[0].parse().unwrap_or(0);
        if level != 5 {
            continue;
        }
        let text = cols[11].trim();
        if text.is_empty() {
            continue;
        }
        words.push(TsvWord {
            block: cols[2].parse().unwrap_or(0),
            par: cols[3].parse().unwrap_or(0),
            line: cols[4].parse().unwrap_or(0),
            left: cols[6].parse().unwrap_or(0),
            top: cols[7].parse().unwrap_or(0),
            width: cols[8].parse().unwrap_or(0),
            height: cols[9].parse().unwrap_or(0),
            text: text.to_string(),
        });
    }
    words
}

fn group_into_lines(words: Vec<TsvWord>) -> Vec<OcrLineBox> {
    let mut order: Vec<(i32, i32, i32)> = Vec::new();
    let mut grouped: HashMap<(i32, i32, i32), Vec<TsvWord>> = HashMap::new();
    for w in words {
        let key = (w.block, w.par, w.line);
        if !grouped.contains_key(&key) {
            order.push(key);
        }
        grouped.entry(key).or_default().push(w);
    }
    order
        .into_iter()
        .map(|key| {
            let ws = grouped.remove(&key).unwrap_or_default();
            let text = ws
                .iter()
                .map(|w| w.text.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            let words = ws
                .into_iter()
                .map(|w| OcrWordBox {
                    text: w.text,
                    x: w.left,
                    y: w.top,
                    w: w.width,
                    h: w.height,
                })
                .collect();
            OcrLineBox { text, words }
        })
        .collect()
}

impl LinuxOcr {
    fn language_error(&self, requested: Option<&str>) -> String {
        let avail = list_langs();
        if avail.is_empty() {
            "tesseract was not found (or has no language packs installed). Install it with: \
             sudo apt install tesseract-ocr tesseract-ocr-eng   (Debian/Ubuntu)  or  \
             sudo dnf install tesseract tesseract-langpack-eng   (Fedora/RHEL)."
                .to_string()
        } else {
            match requested {
                Some(tag) => format!(
                    "OCR language '{tag}' is not installed. Installed OCR languages: {}. \
                     Install the matching language pack, e.g.: sudo apt install tesseract-ocr-{} \
                     or sudo dnf install tesseract-langpack-{}.",
                    avail.join(", "),
                    bcp47_to_tesseract(tag),
                    bcp47_to_tesseract(tag)
                ),
                None => format!(
                    "No OCR language specified and no default is configured. Installed OCR \
                     languages: {}. Set the block's Language field explicitly.",
                    avail.join(", ")
                ),
            }
        }
    }
}

impl OcrBackend for LinuxOcr {
    fn max_dimension(&self) -> u32 {
        8192
    }

    fn read(&self, img: &image::RgbaImage, lang: Option<&str>) -> Result<OcrLines, String> {
        let tess_lang = lang
            .map(bcp47_to_tesseract)
            .unwrap_or_else(|| "eng".to_string());

        let mut png_bytes = Vec::new();
        {
            let mut cursor = std::io::Cursor::new(&mut png_bytes);
            img.write_to(&mut cursor, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }

        let mut child = Command::new(tesseract_bin())
            .args(["stdin", "stdout", "tsv", "-l", &tess_lang, "--psm", "6"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to launch tesseract: {e}"))?;

        child
            .stdin
            .take()
            .ok_or("Failed to open tesseract stdin")?
            .write_all(&png_bytes)
            .map_err(|e| e.to_string())?;

        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("Failed loading language")
                || stderr.contains("Error opening data file")
            {
                return Err(self.language_error(lang));
            }
            return Err(format!("tesseract failed: {}", stderr.trim()));
        }

        let tsv = String::from_utf8_lossy(&output.stdout);
        let words = parse_tsv(&tsv);
        let text = words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let lines = group_into_lines(words);

        Ok(OcrLines {
            text,
            lines,
            language: lang.unwrap_or("en").to_string(),
        })
    }
}
