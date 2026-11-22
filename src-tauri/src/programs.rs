use crate::platform;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

static CONFIRMED_PROGRAM_PATHS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn confirmed_program_paths() -> &'static Mutex<HashSet<PathBuf>> {
    CONFIRMED_PROGRAM_PATHS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub(crate) fn reset_confirmed_programs() {
    if let Ok(mut c) = confirmed_program_paths().lock() {
        c.clear();
    }
}

#[cfg(windows)]
fn is_runnable(canonical: &Path) -> Result<(), String> {
    if canonical.to_string_lossy().starts_with(r"\\?\UNC\") {
        return Err("Network (UNC) paths are not allowed".into());
    }
    let is_exe = canonical
        .extension()
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    if !is_exe {
        return Err("Only .exe programs can be run".into());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn is_runnable(canonical: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    if canonical.starts_with("/proc") || canonical.starts_with("/sys") {
        return Err("Programs under /proc or /sys cannot be run".into());
    }
    let mode = std::fs::metadata(canonical)
        .map_err(|e| e.to_string())?
        .permissions()
        .mode();
    if mode & 0o111 == 0 {
        return Err("Path is not executable".into());
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum TitleMatch {
    Contains,
    Exact,
}

impl TitleMatch {
    fn parse(s: Option<&str>) -> TitleMatch {
        match s {
            Some("EXACT") => TitleMatch::Exact,
            _ => TitleMatch::Contains,
        }
    }
}

pub(crate) fn window_matches(
    title: &str,
    needle: &str,
    mode: TitleMatch,
    case_sensitive: bool,
) -> bool {
    let needle = needle.trim();
    if needle.is_empty() {
        return false;
    }
    let (title, needle) = if case_sensitive {
        (title.trim().to_string(), needle.to_string())
    } else {
        (title.trim().to_lowercase(), needle.to_lowercase())
    };
    match mode {
        TitleMatch::Contains => title.contains(&needle),
        TitleMatch::Exact => title == needle,
    }
}

const WINDOW_POLL_MS: u64 = 150;
const MAX_WINDOW_WAIT_MS: u64 = 300_000;

fn clamp_timeout(ms: Option<u64>, default_ms: u64) -> u64 {
    ms.unwrap_or(default_ms).min(MAX_WINDOW_WAIT_MS)
}

pub(crate) fn wait_for_new_window(
    baseline: &HashSet<u64>,
    pid: u32,
    exe_name: Option<&str>,
    timeout_ms: u64,
) -> bool {
    let wm = platform::windows_mgr();
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    loop {
        let tree = wm.process_tree(pid);
        if let Ok(windows) = wm.list() {
            let ready = windows.iter().any(|w| {
                if baseline.contains(&w.id) {
                    return false;
                }
                if tree.contains(&w.pid) {
                    return true;
                }
                match (exe_name, wm.process_exe_name(w.pid)) {
                    (Some(wanted), Some(actual)) => actual.eq_ignore_ascii_case(wanted),
                    _ => false,
                }
            });
            if ready {
                return true;
            }
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(WINDOW_POLL_MS));
    }
}

#[tauri::command(async)]
pub fn switch_to_window(
    title: String,
    match_mode: Option<String>,
    case_sensitive: Option<bool>,
    timeout_ms: Option<u64>,
) -> Result<bool, String> {
    let mode = TitleMatch::parse(match_mode.as_deref());
    let case_sensitive = case_sensitive.unwrap_or(false);
    let wm = platform::windows_mgr();
    let deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(clamp_timeout(timeout_ms, 0));

    loop {
        let windows = wm.list()?;
        if let Some(win) = windows
            .iter()
            .find(|w| window_matches(&w.title, &title, mode, case_sensitive))
        {
            wm.focus(win.id)?;
            return Ok(true);
        }
        if std::time::Instant::now() >= deadline {
            return Ok(false);
        }
        std::thread::sleep(std::time::Duration::from_millis(WINDOW_POLL_MS));
    }
}

#[tauri::command(async)]
pub fn run_program(
    app: AppHandle,
    path: String,
    wait_ready: Option<bool>,
    timeout_ms: Option<u64>,
) -> Result<bool, String> {
    let canonical = std::fs::canonicalize(&path).map_err(|_| "Program not found".to_string())?;

    if !canonical.is_file() {
        return Err("Path is not a file".into());
    }
    is_runnable(&canonical)?;

    let already_confirmed = confirmed_program_paths()
        .lock()
        .map_err(|e| e.to_string())?
        .contains(&canonical);

    if !already_confirmed {
        let allowed = app
            .dialog()
            .message(crate::i18n::tr_run_program_message(
                &canonical.display().to_string(),
            ))
            .title(crate::i18n::tr("runProgram.title"))
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNo)
            .blocking_show();
        if !allowed {
            return Err("User declined to run the program".into());
        }
        confirmed_program_paths()
            .lock()
            .map_err(|e| e.to_string())?
            .insert(canonical.clone());
    }

    let wm = platform::windows_mgr();
    let wait_ready = wait_ready.unwrap_or(false);
    let baseline: HashSet<u64> = if wait_ready {
        wm.list()
            .unwrap_or_default()
            .into_iter()
            .map(|w| w.id)
            .collect()
    } else {
        HashSet::new()
    };

    let mut child = std::process::Command::new(&canonical)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    if !wait_ready {
        return Ok(true);
    }

    let timeout = clamp_timeout(timeout_ms, 15_000);
    let started = std::time::Instant::now();
    let exe_name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string());

    wm.wait_input_idle(pid, timeout);
    let remaining = timeout.saturating_sub(started.elapsed().as_millis() as u64);
    Ok(wait_for_new_window(
        &baseline,
        pid,
        exe_name.as_deref(),
        remaining,
    ))
}

#[cfg(test)]
mod live_window_tests {
    use super::wait_for_new_window;
    use crate::platform;
    use std::collections::HashSet;

    fn baseline() -> HashSet<u64> {
        platform::windows_mgr()
            .list()
            .unwrap_or_default()
            .into_iter()
            .map(|w| w.id)
            .collect()
    }

    fn spawn_windowed_child() -> std::process::Child {
        #[cfg(windows)]
        {
            std::process::Command::new("winver.exe")
                .spawn()
                .expect("spawning winver")
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--ignored",
                    "--exact",
                    "platform::linux::window::live_tests::maps_a_window_and_waits",
                ])
                .env("ASMACRO_LIVE_CHILD", "1")
                .spawn()
                .expect("re-invoking the test binary in child mode")
        }
    }

    fn spawn_windowless_child() -> std::process::Child {
        #[cfg(windows)]
        let mut cmd = {
            let mut c = std::process::Command::new("cmd.exe");
            c.args(["/c", "ping -n 8 127.0.0.1"]);
            c
        };
        #[cfg(target_os = "linux")]
        let mut cmd = {
            let mut c = std::process::Command::new("/bin/sleep");
            c.arg("8");
            c
        };
        cmd.stdout(std::process::Stdio::null())
            .spawn()
            .expect("spawning a background child")
    }

    #[test]
    #[ignore]
    fn readiness_wait_succeeds_once_a_window_is_mapped() {
        let before = baseline();
        let mut child = spawn_windowed_child();
        let ready = wait_for_new_window(&before, child.id(), None, 15_000);
        let _ = child.kill();
        let _ = child.wait();
        assert!(ready, "a child that opened a window should count as ready");
    }

    #[test]
    #[ignore]
    fn switch_to_window_finds_and_focuses_by_title() {
        let before = baseline();
        let mut child = spawn_windowed_child();
        let ready = wait_for_new_window(&before, child.id(), None, 15_000);

        let title = platform::windows_mgr()
            .list()
            .unwrap_or_default()
            .into_iter()
            .find(|w| w.pid == child.id())
            .map(|w| w.title);
        let switched = title
            .as_ref()
            .map(|t| super::switch_to_window(t.clone(), Some("EXACT".into()), None, Some(2_000)));
        let missing =
            super::switch_to_window("asmacro-no-such-window-9e1f".into(), None, None, Some(500));

        let _ = child.kill();
        let _ = child.wait();

        assert!(ready, "the child should have opened a window");
        let title = title.expect("the child's window should be listed");
        assert_eq!(
            switched.unwrap(),
            Ok(true),
            "switching to {title:?} should succeed"
        );
        assert_eq!(missing, Ok(false), "a title nobody has should not match");
    }

    #[test]
    #[ignore]
    fn readiness_wait_times_out_on_a_windowless_background_process() {
        let before = baseline();
        let mut child = spawn_windowless_child();
        let started = std::time::Instant::now();
        let ready = wait_for_new_window(&before, child.id(), None, 2_500);
        let _ = child.kill();
        let _ = child.wait();
        assert!(!ready, "a running process without a window is not 'ready'");
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(2_400),
            "it should actually have waited out the timeout"
        );
    }
}

#[cfg(test)]
mod window_match_tests {
    use super::{window_matches, TitleMatch};

    #[test]
    fn contains_is_case_insensitive_by_default() {
        assert!(window_matches(
            "Mozilla Firefox",
            "firefox",
            TitleMatch::Contains,
            false
        ));
        assert!(!window_matches(
            "Mozilla Firefox",
            "firefox",
            TitleMatch::Contains,
            true
        ));
    }

    #[test]
    fn exact_requires_the_whole_title() {
        assert!(window_matches(
            "Notepad",
            "notepad",
            TitleMatch::Exact,
            false
        ));
        assert!(!window_matches(
            "Untitled - Notepad",
            "notepad",
            TitleMatch::Exact,
            false
        ));
    }

    #[test]
    fn trims_both_sides() {
        assert!(window_matches(
            "  Calculator  ",
            " Calculator ",
            TitleMatch::Exact,
            true
        ));
    }

    #[test]
    fn empty_needle_never_matches() {
        assert!(!window_matches(
            "Anything",
            "   ",
            TitleMatch::Contains,
            false
        ));
    }

    #[test]
    fn parses_match_mode_defaulting_to_contains() {
        assert_eq!(TitleMatch::parse(Some("EXACT")), TitleMatch::Exact);
        assert_eq!(TitleMatch::parse(Some("CONTAINS")), TitleMatch::Contains);
        assert_eq!(TitleMatch::parse(None), TitleMatch::Contains);
        assert_eq!(TitleMatch::parse(Some("nonsense")), TitleMatch::Contains);
    }

    #[test]
    fn timeouts_are_capped() {
        use super::{clamp_timeout, MAX_WINDOW_WAIT_MS};
        assert_eq!(clamp_timeout(None, 15_000), 15_000);
        assert_eq!(clamp_timeout(Some(500), 15_000), 500);
        assert_eq!(clamp_timeout(Some(u64::MAX), 15_000), MAX_WINDOW_WAIT_MS);
    }
}
