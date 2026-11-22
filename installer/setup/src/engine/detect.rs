use super::registry;
use crate::plan::PlanScope;
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

pub const INSTALL_KEY: &str = "Software\\me.asmek.asmacro\\Install";
pub const UNINSTALL_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ASMacro";
pub const LEGACY_NSIS_KEY: &str = "Software\\asmek\\ASMacro";

#[derive(Debug, Clone)]
pub struct Existing {
    pub scope: PlanScope,
    pub path: String,
    pub version: Option<String>,
    pub shortcut_desktop: bool,
    pub shortcut_startmenu: bool,
    pub assoc: bool,
    pub autostart: bool,
    pub is_ours: bool,
    pub uninstall_string: Option<String>,
}

fn installed_at(path: &str) -> bool {
    !path.is_empty() && std::path::Path::new(path).join("ASMacro.exe").is_file()
}

pub fn find_existing() -> Option<Existing> {
    for scope in [PlanScope::User, PlanScope::Machine] {
        let root = registry::root_for(scope);
        if registry::key_exists(root, INSTALL_KEY) {
            let path = registry::read_string(root, INSTALL_KEY, "Path").unwrap_or_default();
            if !installed_at(&path) {
                continue;
            }
            return Some(Existing {
                scope,
                path,
                version: registry::read_string(root, INSTALL_KEY, "Version"),
                shortcut_desktop: registry::read_dword(root, INSTALL_KEY, "ShortcutDesktop")
                    .unwrap_or(1)
                    != 0,
                shortcut_startmenu: registry::read_dword(root, INSTALL_KEY, "ShortcutStartMenu")
                    .unwrap_or(1)
                    != 0,
                assoc: registry::read_dword(root, INSTALL_KEY, "Assoc").unwrap_or(1) != 0,
                autostart: registry::read_dword(root, INSTALL_KEY, "Autostart").unwrap_or(0) != 0,
                is_ours: true,
                uninstall_string: registry::read_string(root, UNINSTALL_KEY, "UninstallString"),
            });
        }
    }

    for scope in [PlanScope::User, PlanScope::Machine] {
        let root = registry::root_for(scope);
        if let Some(path) = registry::read_string(root, UNINSTALL_KEY, "InstallLocation") {
            if installed_at(&path) {
                return Some(Existing {
                    scope,
                    path,
                    version: registry::read_string(root, UNINSTALL_KEY, "DisplayVersion"),
                    shortcut_desktop: true,
                    shortcut_startmenu: true,
                    assoc: false,
                    autostart: false,
                    is_ours: false,
                    uninstall_string: registry::read_string(root, UNINSTALL_KEY, "UninstallString"),
                });
            }
        }
    }

    if let Some(path) = registry::read_string(HKEY_CURRENT_USER, LEGACY_NSIS_KEY, "") {
        if installed_at(&path) {
            return Some(Existing {
                scope: PlanScope::User,
                path,
                version: None,
                shortcut_desktop: true,
                shortcut_startmenu: true,
                assoc: false,
                autostart: false,
                is_ours: false,
                uninstall_string: registry::read_string(
                    HKEY_CURRENT_USER,
                    UNINSTALL_KEY,
                    "UninstallString",
                ),
            });
        }
    }
    if let Some(path) = registry::read_string(HKEY_LOCAL_MACHINE, LEGACY_NSIS_KEY, "") {
        if installed_at(&path) {
            return Some(Existing {
                scope: PlanScope::Machine,
                path,
                version: None,
                shortcut_desktop: true,
                shortcut_startmenu: true,
                assoc: false,
                autostart: false,
                is_ours: false,
                uninstall_string: registry::read_string(
                    HKEY_LOCAL_MACHINE,
                    UNINSTALL_KEY,
                    "UninstallString",
                ),
            });
        }
    }

    None
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionCompare {
    Newer,
    Same,
    Older,
    Unknown,
}

pub fn compare_versions(new: &str, old: &str) -> VersionCompare {
    fn parts(v: &str) -> Vec<u32> {
        v.split('.').filter_map(|p| p.parse().ok()).collect()
    }
    let (a, b) = (parts(new), parts(old));
    if a.is_empty() || b.is_empty() {
        return VersionCompare::Unknown;
    }
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x > y {
            return VersionCompare::Newer;
        }
        if x < y {
            return VersionCompare::Older;
        }
    }
    VersionCompare::Same
}

#[cfg(test)]
mod tests {
    use super::{compare_versions, VersionCompare::*};

    #[test]
    fn same_version_blocks_reinstall() {
        assert_eq!(compare_versions("1.0.1", "1.0.1"), Same);
        assert_eq!(compare_versions("1.0.1", "1.0.1.0"), Same);
        assert_eq!(compare_versions("1.0.1", "1.0.0"), Newer);
        assert_eq!(compare_versions("1.0.0", "1.0.1"), Older);
        assert_eq!(compare_versions("1.0.1", ""), Unknown);
    }
}
