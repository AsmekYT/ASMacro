use std::path::PathBuf;
use windows::core::Interface;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    FileOpenDialog, IFileDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM,
    FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
};

pub fn pick_folder(initial: Option<&str>) -> Option<PathBuf> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let dialog: IFileDialog =
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;

        let opts = dialog.GetOptions().ok()?;
        dialog
            .SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)
            .ok()?;

        if let Some(initial) = initial {
            let mut probe = PathBuf::from(initial);
            while !probe.exists() {
                match probe.parent() {
                    Some(p) if p != probe => probe = p.to_path_buf(),
                    _ => break,
                }
            }
            if probe.exists() {
                let wide: Vec<u16> = probe
                    .to_string_lossy()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let item: windows::core::Result<IShellItem> =
                    SHCreateItemFromParsingName(windows::core::PCWSTR(wide.as_ptr()), None);
                if let Ok(item) = item {
                    let _ = dialog.SetFolder(&item);
                }
            }
        }

        dialog.Show(None).ok()?;
        let item = dialog.GetResult().ok()?;
        let pwstr = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
        let path = pwstr.to_string().ok()?;
        windows::Win32::System::Com::CoTaskMemFree(Some(pwstr.0 as *const _));
        Some(PathBuf::from(path))
    }
}

const _: fn() = || {
    fn _assert<T: Interface>() {}
    _assert::<IFileDialog>();
};
