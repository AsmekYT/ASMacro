use std::path::Path;
use windows::core::{Interface, PCWSTR};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

fn wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
}

pub fn create(
    lnk_path: &Path,
    target: &Path,
    working_dir: &Path,
    icon: &Path,
    icon_index: i32,
) -> Result<(), String> {
    ensure_com();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|e| format!("CoCreateInstance ShellLink: {e}"))?;

        let target_w = wstr(&target.to_string_lossy());
        link.SetPath(PCWSTR(target_w.as_ptr()))
            .map_err(|e| e.to_string())?;

        let workdir_w = wstr(&working_dir.to_string_lossy());
        link.SetWorkingDirectory(PCWSTR(workdir_w.as_ptr()))
            .map_err(|e| e.to_string())?;

        let icon_w = wstr(&icon.to_string_lossy());
        link.SetIconLocation(PCWSTR(icon_w.as_ptr()), icon_index)
            .map_err(|e| e.to_string())?;

        let persist: windows::Win32::System::Com::IPersistFile =
            link.cast().map_err(|e| format!("cast IPersistFile: {e}"))?;
        let lnk_w = wstr(&lnk_path.to_string_lossy());
        persist
            .Save(PCWSTR(lnk_w.as_ptr()), true)
            .map_err(|e| format!("IPersistFile::Save: {e}"))?;
    }
    Ok(())
}

pub fn read_target(lnk_path: &Path) -> Option<String> {
    ensure_com();
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let persist: windows::Win32::System::Com::IPersistFile = link.cast().ok()?;
        let lnk_w = wstr(&lnk_path.to_string_lossy());
        persist
            .Load(PCWSTR(lnk_w.as_ptr()), Default::default())
            .ok()?;

        let mut buf = [0u16; 260];
        let mut find_data = std::mem::zeroed();
        link.GetPath(&mut buf, &mut find_data, 0).ok()?;
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    }
}
