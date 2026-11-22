use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, MoveFileExW, MOVEFILE_DELAY_UNTIL_REBOOT, MOVEFILE_REPLACE_EXISTING,
    MOVEFILE_WRITE_THROUGH,
};

fn wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn free_space_bytes(dir: &Path) -> Option<u64> {
    let w = wstr(&dir.to_string_lossy());
    let mut free = 0u64;
    unsafe {
        GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), None, None).ok()?;
    }
    Some(free)
}

pub fn dir_size_bytes(dir: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size_bytes(&entry.path());
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

pub fn replace_file(target: &Path, data: &[u8]) -> Result<bool, String> {
    let new_path = target.with_extension(
        target
            .extension()
            .map(|e| format!("{}.new", e.to_string_lossy()))
            .unwrap_or_else(|| "new".to_string()),
    );
    std::fs::write(&new_path, data).map_err(|e| format!("write {new_path:?}: {e}"))?;

    let target_w = wstr(&target.to_string_lossy());
    let new_w = wstr(&new_path.to_string_lossy());

    let direct = unsafe {
        MoveFileExW(
            PCWSTR(new_w.as_ptr()),
            PCWSTR(target_w.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if direct.is_ok() {
        return Ok(true);
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let old_path: PathBuf = target.with_extension(format!("old-{ts}"));
    let old_w = wstr(&old_path.to_string_lossy());

    unsafe {
        MoveFileExW(
            PCWSTR(target_w.as_ptr()),
            PCWSTR(old_w.as_ptr()),
            Default::default(),
        )
        .map_err(|e| format!("move aside {target:?}: {e}"))?;
        MoveFileExW(
            PCWSTR(new_w.as_ptr()),
            PCWSTR(target_w.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|e| format!("place new {target:?}: {e}"))?;
        let _ = MoveFileExW(
            PCWSTR(old_w.as_ptr()),
            PCWSTR::null(),
            MOVEFILE_DELAY_UNTIL_REBOOT,
        );
    }
    Ok(false)
}
