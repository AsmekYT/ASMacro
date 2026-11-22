use super::{detect, folders, process, registry, shortcuts};
use crate::plan::PlanScope;
use std::path::{Path, PathBuf};
use std::time::Duration;
use windows::Win32::System::Registry::HKEY_CURRENT_USER;
use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

const APP_EXE: &str = "ASMacro.exe";

pub fn run(purge: bool, silent: bool) -> Result<(), String> {
    let existing =
        detect::find_existing().ok_or("E_NOT_INSTALLED: no ASMacro installation found")?;
    let dir = PathBuf::from(&existing.path);
    let root = registry::root_for(existing.scope);

    let _ = process::wait_for_exit(&dir.join(APP_EXE), Duration::from_secs(30));

    remove_shortcut_if_ours(&dir, existing.scope, true);
    remove_shortcut_if_ours(&dir, existing.scope, false);

    let run_val = registry::read_string(
        HKEY_CURRENT_USER,
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
        "ASMacro",
    );
    if let Some(v) = run_val {
        if v.contains(&dir.to_string_lossy().to_string()) {
            registry::delete_value(
                HKEY_CURRENT_USER,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                "ASMacro",
            );
        }
    }

    if registry::read_string(root, "Software\\Classes\\.asmacro", "").as_deref()
        == Some("ASMacro.macro")
    {
        registry::delete_value(root, "Software\\Classes\\.asmacro", "");
    }
    registry::delete_value(
        root,
        "Software\\Classes\\.asmacro\\OpenWithProgids",
        "ASMacro.macro",
    );
    registry::delete_tree(root, "Software\\Classes\\ASMacro.macro");
    registry::delete_tree(root, "Software\\Classes\\Applications\\ASMacro.exe");

    registry::delete_tree(root, detect::UNINSTALL_KEY);
    registry::delete_tree(root, detect::INSTALL_KEY);
    registry::delete_tree(root, detect::LEGACY_NSIS_KEY);
    registry::delete_tree(HKEY_CURRENT_USER, detect::LEGACY_NSIS_KEY);

    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }

    if purge {
        registry::delete_tree(HKEY_CURRENT_USER, "Software\\me.asmek.asmacro");
        purge_app_data(&dir);
    }

    let _ = std::fs::remove_file(dir.join(APP_EXE));
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".old") || name.contains(".old-") {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    let _ = silent;
    schedule_self_removal(&dir);
    Ok(())
}

fn remove_shortcut_if_ours(dir: &Path, scope: PlanScope, desktop: bool) {
    let base = if desktop {
        match scope {
            PlanScope::User => folders::desktop_user(),
            PlanScope::Machine => folders::desktop_common(),
        }
    } else {
        match scope {
            PlanScope::User => folders::start_menu_user(),
            PlanScope::Machine => folders::start_menu_common(),
        }
    };
    let Some(base) = base else { return };
    let lnk = base.join("ASMacro.lnk");
    if !lnk.exists() {
        return;
    }
    if let Some(resolved) = shortcuts::read_target(&lnk) {
        let expected = dir.join(APP_EXE).to_string_lossy().to_ascii_lowercase();
        if resolved.to_ascii_lowercase() == expected {
            let _ = std::fs::remove_file(&lnk);
        }
    }
}

fn purge_app_data(install_dir: &Path) {
    const NAMES: [&str; 2] = ["asmacro", "me.asmek.asmacro"];
    let bases = [
        std::env::var_os("APPDATA").map(PathBuf::from),
        folders::local_app_data(),
    ];
    for base in bases.into_iter().flatten() {
        for name in NAMES {
            let candidate = base.join(name);
            if is_same_path(&candidate, install_dir) {
                continue;
            }
            let _ = std::fs::remove_dir_all(&candidate);
        }
    }
}

fn is_same_path(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a
            .to_string_lossy()
            .trim_end_matches('\\')
            .eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\')),
    }
}

fn schedule_self_removal(dir: &Path) {
    let Ok(self_exe) = std::env::current_exe() else {
        return;
    };
    let Some(temp) = std::env::var_os("TEMP") else {
        return;
    };
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let copy_path = PathBuf::from(temp).join(format!("asmacro-uninst-{ts}.exe"));
    if std::fs::copy(&self_exe, &copy_path).is_err() {
        return;
    }
    let _ = std::process::Command::new(&copy_path)
        .arg(format!("--finalize-remove={}", dir.display()))
        .arg(format!("--wait-pid={}", std::process::id()))
        .spawn();
}

pub fn finalize_remove(dir: &Path, wait_pid: u32) {
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{
            OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
        };
        if let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE, false, wait_pid) {
            WaitForSingleObject(h, 10_000);
            let _ = CloseHandle(h);
        }
    }
    let _ = std::fs::remove_file(dir.join("uninstall.exe"));
    for attempt in 0..10 {
        let mut leftovers = false;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if name.to_string_lossy().ends_with(".WebView2") {
                    leftovers = std::fs::remove_dir_all(entry.path()).is_err();
                }
            }
        }
        if !leftovers {
            break;
        }
        let _ = attempt;
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    let _ = std::fs::remove_dir(dir);

    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_DELAY_UNTIL_REBOOT};
    if let Ok(self_exe) = std::env::current_exe() {
        let w: Vec<u16> = self_exe
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let _ = MoveFileExW(
                PCWSTR(w.as_ptr()),
                PCWSTR::null(),
                MOVEFILE_DELAY_UNTIL_REBOOT,
            );
        }
    }
}
