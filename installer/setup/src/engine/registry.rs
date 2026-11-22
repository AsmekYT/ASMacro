use windows::core::PCWSTR;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
    RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_ALL_ACCESS, KEY_READ,
    REG_BINARY, REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, REG_VALUE_TYPE,
};

use crate::plan::PlanScope;

pub fn root_for(scope: PlanScope) -> HKEY {
    match scope {
        PlanScope::User => HKEY_CURRENT_USER,
        PlanScope::Machine => HKEY_LOCAL_MACHINE,
    }
}

fn wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

struct Key(HKEY);

impl Drop for Key {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }
}

fn open(root: HKEY, subkey: &str, write: bool) -> Result<Key, String> {
    let sub = wstr(subkey);
    let mut hkey = HKEY::default();
    let access = if write { KEY_ALL_ACCESS } else { KEY_READ };
    let status = unsafe { RegOpenKeyExW(root, PCWSTR(sub.as_ptr()), Some(0), access, &mut hkey) };
    if status != ERROR_SUCCESS {
        return Err(format!("RegOpenKeyExW {subkey}: {status:?}"));
    }
    Ok(Key(hkey))
}

fn create(root: HKEY, subkey: &str) -> Result<Key, String> {
    let sub = wstr(subkey);
    let mut hkey = HKEY::default();
    let status = unsafe {
        RegCreateKeyExW(
            root,
            PCWSTR(sub.as_ptr()),
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_ALL_ACCESS,
            None,
            &mut hkey,
            None,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("RegCreateKeyExW {subkey}: {status:?}"));
    }
    Ok(Key(hkey))
}

pub fn read_string(root: HKEY, subkey: &str, value: &str) -> Option<String> {
    let key = open(root, subkey, false).ok()?;
    let name = wstr(value);
    let mut buf = vec![0u8; 4096];
    let mut len = buf.len() as u32;
    let mut vtype = REG_VALUE_TYPE::default();
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut vtype),
            Some(buf.as_mut_ptr()),
            Some(&mut len),
        )
    };
    if status != ERROR_SUCCESS || vtype != REG_SZ {
        return None;
    }
    buf.truncate(len as usize & !1);
    let u16s: Vec<u16> = buf
        .chunks_exact(2)
        .map(|c| u16::from_ne_bytes([c[0], c[1]]))
        .collect();
    let s = String::from_utf16_lossy(&u16s);
    Some(s.trim_end_matches('\0').to_string())
}

pub fn read_dword(root: HKEY, subkey: &str, value: &str) -> Option<u32> {
    let key = open(root, subkey, false).ok()?;
    let name = wstr(value);
    let mut data: u32 = 0;
    let mut len = std::mem::size_of::<u32>() as u32;
    let mut vtype = REG_VALUE_TYPE::default();
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut vtype),
            Some(&mut data as *mut u32 as *mut u8),
            Some(&mut len),
        )
    };
    if status != ERROR_SUCCESS || vtype != REG_DWORD {
        return None;
    }
    Some(data)
}

pub fn write_string(root: HKEY, subkey: &str, value: &str, data: &str) -> Result<(), String> {
    let key = create(root, subkey)?;
    let name = wstr(value);
    let bytes = wstr(data);
    let raw: &[u8] =
        unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const u8, bytes.len() * 2) };
    let status =
        unsafe { RegSetValueExW(key.0, PCWSTR(name.as_ptr()), Some(0), REG_SZ, Some(raw)) };
    if status != ERROR_SUCCESS {
        return Err(format!("RegSetValueExW {subkey}\\{value}: {status:?}"));
    }
    Ok(())
}

pub fn write_dword(root: HKEY, subkey: &str, value: &str, data: u32) -> Result<(), String> {
    let key = create(root, subkey)?;
    let name = wstr(value);
    let raw = data.to_ne_bytes();
    let status =
        unsafe { RegSetValueExW(key.0, PCWSTR(name.as_ptr()), Some(0), REG_DWORD, Some(&raw)) };
    if status != ERROR_SUCCESS {
        return Err(format!("RegSetValueExW {subkey}\\{value}: {status:?}"));
    }
    Ok(())
}

pub fn write_binary(root: HKEY, subkey: &str, value: &str, data: &[u8]) -> Result<(), String> {
    let key = create(root, subkey)?;
    let name = wstr(value);
    let status = unsafe {
        RegSetValueExW(
            key.0,
            PCWSTR(name.as_ptr()),
            Some(0),
            REG_BINARY,
            Some(data),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!("RegSetValueExW {subkey}\\{value}: {status:?}"));
    }
    Ok(())
}

pub fn delete_value(root: HKEY, subkey: &str, value: &str) {
    if let Ok(key) = open(root, subkey, true) {
        let name = wstr(value);
        unsafe {
            let _ = RegDeleteValueW(key.0, PCWSTR(name.as_ptr()));
        }
    }
}

pub fn delete_tree(root: HKEY, subkey: &str) {
    let sub = wstr(subkey);
    unsafe {
        let _ = RegDeleteTreeW(root, PCWSTR(sub.as_ptr()));
    }
}

pub fn key_exists(root: HKEY, subkey: &str) -> bool {
    open(root, subkey, false).is_ok()
}

#[cfg(test)]
mod selftest {
    use super::*;

    #[test]
    fn roundtrip_hkcu() {
        let sub = r"Software\ASMacroSetupSelfTest";
        write_string(HKEY_CURRENT_USER, sub, "Foo", "bar").expect("write_string failed");
        let got = read_string(HKEY_CURRENT_USER, sub, "Foo");
        assert_eq!(
            got.as_deref(),
            Some("bar"),
            "round-trip mismatch, got {got:?}"
        );
        delete_tree(HKEY_CURRENT_USER, sub);
    }
}
