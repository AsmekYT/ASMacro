use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static LOG_PATH: Mutex<Option<String>> = Mutex::new(None);

pub fn init(explicit: Option<&str>) {
    let path = explicit.map(|s| s.to_string()).unwrap_or_else(default_path);
    *LOG_PATH.lock().unwrap() = Some(path);
}

fn default_path() -> String {
    let dir = std::env::var("TEMP").unwrap_or_else(|_| ".".to_string());
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{dir}\\ASMacro-setup-{ts}.log")
}

pub fn line(msg: &str) {
    let guard = LOG_PATH.lock().unwrap();
    if let Some(path) = guard.as_ref() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{msg}");
        }
    }
}

pub fn path() -> Option<String> {
    LOG_PATH.lock().unwrap().clone()
}
