use super::{detect, folders, fsutil, payload, process, registry, shortcuts};
use crate::plan::{InstallPlan, PlanScope};
use std::path::{Path, PathBuf};
use std::time::Duration;
use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

const APP_EXE: &str = "ASMacro.exe";
const UNINSTALL_EXE: &str = "uninstall.exe";

pub fn wait_for_app_exit(dir: &Path) -> Result<(), String> {
    let target = dir.join(APP_EXE);
    if process::wait_for_exit(&target, Duration::from_secs(30)) {
        return Ok(());
    }
    for pid in process::find_by_path(&target) {
        process::terminate(pid);
    }
    if process::wait_for_exit(&target, Duration::from_secs(5)) {
        Ok(())
    } else {
        Err("E_APP_RUNNING: ASMacro is still running".into())
    }
}

pub fn already_installed(existing: Option<&detect::Existing>, version: &str) -> bool {
    let Some(e) = existing.filter(|e| e.is_ours) else {
        return false;
    };
    let same = e
        .version
        .as_deref()
        .map(|v| detect::compare_versions(version, v))
        == Some(detect::VersionCompare::Same);
    same && files_intact(Path::new(&e.path))
}

fn files_intact(dir: &Path) -> bool {
    let Ok(Some(payload)) = payload::read_from_current_exe() else {
        return false;
    };
    payload
        .files
        .iter()
        .all(|(name, bytes)| std::fs::read(dir.join(name)).is_ok_and(|b| b == *bytes))
}

pub fn uninstall_legacy_if_present() {
    if let Some(existing) = detect::find_existing() {
        if existing.is_ours {
            return;
        }
        let Some(uninstall_string) = existing.uninstall_string else {
            return;
        };
        let exe = uninstall_string.trim_matches('"').to_string();
        let _ = std::process::Command::new(&exe)
            .arg("/S")
            .spawn()
            .and_then(|mut c| c.wait());
    }
}

pub type Progress<'a> = &'a mut dyn FnMut(u32, &str);

fn noop_progress(_: u32, _: &str) {}

pub fn run_scoped_part(plan: &InstallPlan) -> Result<(), String> {
    run_scoped_part_with_progress(plan, &mut noop_progress)
}

pub fn run_scoped_part_with_progress(
    plan: &InstallPlan,
    progress: Progress<'_>,
) -> Result<(), String> {
    let dir = PathBuf::from(&plan.dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all {dir:?}: {e}"))?;

    progress(20, "extract");
    let payload = payload::read_from_current_exe()?
        .ok_or_else(|| "E_NO_PAYLOAD: this build has no embedded payload".to_string())?;

    let app_bytes = payload
        .files
        .get(APP_EXE)
        .ok_or_else(|| format!("payload missing {APP_EXE}"))?;
    let placed_directly = fsutil::replace_file(&dir.join(APP_EXE), app_bytes)?;

    progress(60, "extract");
    if let Some(uninst_bytes) = payload.files.get(UNINSTALL_EXE) {
        fsutil::replace_file(&dir.join(UNINSTALL_EXE), uninst_bytes)?;
    }

    let scope_root = registry::root_for(plan.scope);
    let target = dir.join(APP_EXE);
    let icon = target.clone();

    progress(80, "shortcuts");
    if plan.shortcut_startmenu {
        let base = match plan.scope {
            PlanScope::User => folders::start_menu_user(),
            PlanScope::Machine => folders::start_menu_common(),
        };
        if let Some(base) = base {
            let _ = shortcuts::create(&base.join("ASMacro.lnk"), &target, &dir, &icon, 0);
        }
    }
    if plan.shortcut_desktop {
        let base = match plan.scope {
            PlanScope::User => folders::desktop_user(),
            PlanScope::Machine => folders::desktop_common(),
        };
        if let Some(base) = base {
            let _ = shortcuts::create(&base.join("ASMacro.lnk"), &target, &dir, &icon, 0);
        }
    }

    progress(85, "registry");
    write_uninstall_entry(scope_root, &dir, plan)?;
    write_install_record(scope_root, &dir, plan)?;

    if plan.assoc {
        write_assoc(scope_root, &target, &plan.lang)?;
    } else {
        remove_assoc(scope_root);
    }

    progress(95, "finalize");
    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
    }

    if !placed_directly {
        REBOOT_REQUIRED.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    Ok(())
}

pub static REBOOT_REQUIRED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn run_user_part(plan: &InstallPlan) -> Result<(), String> {
    use windows::Win32::System::Registry::HKEY_CURRENT_USER;

    if !plan.update {
        registry::write_string(
            HKEY_CURRENT_USER,
            "Software\\me.asmek.asmacro",
            "Language",
            &plan.lang,
        )?;
    }

    let run_key = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
    if plan.autostart {
        let dir = PathBuf::from(&plan.dir);
        let exe = format!("\"{}\"", dir.join(APP_EXE).display());
        registry::write_string(HKEY_CURRENT_USER, run_key, "ASMacro", &exe)?;
        registry::write_binary(
            HKEY_CURRENT_USER,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
            "ASMacro",
            &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        )?;
    } else if !plan.update {
        registry::delete_value(HKEY_CURRENT_USER, run_key, "ASMacro");
    }

    Ok(())
}

fn write_uninstall_entry(
    root: windows::Win32::System::Registry::HKEY,
    dir: &Path,
    plan: &InstallPlan,
) -> Result<(), String> {
    let key = detect::UNINSTALL_KEY;
    let exe = dir.join(APP_EXE);
    let uninst = dir.join(UNINSTALL_EXE);
    let size_kb = (fsutil::dir_size_bytes(dir) / 1024).max(1) as u32;

    registry::write_string(root, key, "DisplayName", "ASMacro")?;
    registry::write_string(root, key, "DisplayVersion", &plan.version)?;
    registry::write_string(root, key, "DisplayIcon", &format!("{},0", exe.display()))?;
    registry::write_string(root, key, "Publisher", "Asmek")?;
    registry::write_string(root, key, "InstallLocation", &dir.to_string_lossy())?;
    registry::write_string(
        root,
        key,
        "UninstallString",
        &format!("\"{}\"", uninst.display()),
    )?;
    registry::write_string(
        root,
        key,
        "QuietUninstallString",
        &format!("\"{}\" /S", uninst.display()),
    )?;
    registry::write_dword(root, key, "EstimatedSize", size_kb)?;
    registry::write_dword(root, key, "NoModify", 1)?;
    registry::write_dword(root, key, "NoRepair", 1)?;
    registry::write_string(
        root,
        key,
        "URLInfoAbout",
        "https://github.com/AsmekYT/ASMacro",
    )?;
    registry::write_string(root, key, "HelpLink", "https://github.com/AsmekYT/ASMacro")?;
    Ok(())
}

fn write_install_record(
    root: windows::Win32::System::Registry::HKEY,
    dir: &Path,
    plan: &InstallPlan,
) -> Result<(), String> {
    let key = detect::INSTALL_KEY;
    registry::write_string(
        root,
        key,
        "Scope",
        &format!("{:?}", plan.scope).to_lowercase(),
    )?;
    registry::write_string(root, key, "Path", &dir.to_string_lossy())?;
    registry::write_string(root, key, "Version", &plan.version)?;
    registry::write_string(root, key, "Installer", "custom")?;
    registry::write_dword(root, key, "ShortcutDesktop", plan.shortcut_desktop as u32)?;
    registry::write_dword(
        root,
        key,
        "ShortcutStartMenu",
        plan.shortcut_startmenu as u32,
    )?;
    registry::write_dword(root, key, "Assoc", plan.assoc as u32)?;
    registry::write_dword(root, key, "Autostart", plan.autostart as u32)?;
    Ok(())
}

fn write_assoc(
    root: windows::Win32::System::Registry::HKEY,
    exe: &Path,
    lang: &str,
) -> Result<(), String> {
    let display_name = match lang {
        "pl" => "Makro ASMacro",
        _ => "ASMacro macro",
    };
    let open_label = match lang {
        "pl" => "Otwórz za pomocą ASMacro",
        _ => "Open with ASMacro",
    };
    let cmd = format!("\"{}\" \"%1\"", exe.display());
    let icon = format!("{},0", exe.display());

    registry::write_string(root, "Software\\Classes\\.asmacro", "", "ASMacro.macro")?;
    registry::write_string(
        root,
        "Software\\Classes\\.asmacro\\OpenWithProgids",
        "ASMacro.macro",
        "",
    )?;
    registry::write_string(root, "Software\\Classes\\ASMacro.macro", "", display_name)?;
    registry::write_string(
        root,
        "Software\\Classes\\ASMacro.macro\\DefaultIcon",
        "",
        &icon,
    )?;
    registry::write_string(
        root,
        "Software\\Classes\\ASMacro.macro\\shell\\open",
        "",
        open_label,
    )?;
    registry::write_string(
        root,
        "Software\\Classes\\ASMacro.macro\\shell\\open\\command",
        "",
        &cmd,
    )?;
    registry::write_string(
        root,
        "Software\\Classes\\Applications\\ASMacro.exe\\shell\\open\\command",
        "",
        &cmd,
    )?;
    registry::write_string(
        root,
        "Software\\Classes\\Applications\\ASMacro.exe\\SupportedTypes",
        ".asmacro",
        "",
    )?;
    registry::write_string(
        root,
        "Software\\Classes\\Applications\\ASMacro.exe",
        "FriendlyAppName",
        "ASMacro",
    )?;
    Ok(())
}

fn remove_assoc(root: windows::Win32::System::Registry::HKEY) {
    if registry::read_string(root, "Software\\Classes\\.asmacro", "").as_deref()
        == Some("ASMacro.macro")
    {
        registry::delete_value(root, "Software\\Classes\\.asmacro", "");
    }
    registry::delete_tree(root, "Software\\Classes\\ASMacro.macro");
    registry::delete_tree(root, "Software\\Classes\\Applications\\ASMacro.exe");
}
