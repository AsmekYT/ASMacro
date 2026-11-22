use std::path::PathBuf;
use windows::core::GUID;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_LocalAppData, FOLDERID_ProgramFiles,
    FOLDERID_Programs, FOLDERID_PublicDesktop, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG,
};

fn known_folder(id: GUID) -> Option<PathBuf> {
    unsafe {
        let pwstr = SHGetKnownFolderPath(&id, KNOWN_FOLDER_FLAG(0), None).ok()?;
        let s = pwstr.to_string().ok()?;
        CoTaskMemFree(Some(pwstr.0 as *const _));
        Some(PathBuf::from(s))
    }
}

pub fn desktop_user() -> Option<PathBuf> {
    known_folder(FOLDERID_Desktop)
}
pub fn desktop_common() -> Option<PathBuf> {
    known_folder(FOLDERID_PublicDesktop)
}
pub fn start_menu_user() -> Option<PathBuf> {
    known_folder(FOLDERID_Programs)
}
pub fn start_menu_common() -> Option<PathBuf> {
    known_folder(FOLDERID_CommonPrograms)
}
pub fn local_app_data() -> Option<PathBuf> {
    known_folder(FOLDERID_LocalAppData)
}
pub fn program_files() -> Option<PathBuf> {
    known_folder(FOLDERID_ProgramFiles)
}

pub fn default_install_dir(scope: crate::plan::PlanScope) -> PathBuf {
    match scope {
        crate::plan::PlanScope::User => local_app_data()
            .unwrap_or_else(|| PathBuf::from(r"C:\"))
            .join("Programs")
            .join("ASMacro"),
        crate::plan::PlanScope::Machine => program_files()
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
            .join("ASMacro"),
    }
}
