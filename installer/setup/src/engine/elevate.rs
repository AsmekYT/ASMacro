use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_SHARE_NONE, OPEN_EXISTING, PIPE_ACCESS_DUPLEX,
};
use windows::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::plan::InstallPlan;

#[derive(Serialize, Deserialize)]
pub struct WorkRequest {
    pub nonce: String,
    pub plan: InstallPlan,
}

#[derive(Serialize, Deserialize)]
pub struct WorkResult {
    pub ok: bool,
    pub message: String,
}

pub fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut ret_len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret_len,
        );
        let _ = CloseHandle(token);
        ok.is_ok() && elevation.TokenIsElevated != 0
    }
}

fn wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn gen_nonce() -> String {
    let mut buf = [0u8; 16];
    let tick = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let mix = tick ^ (pid << 32) ^ (&buf as *const _ as u128);
    for (i, b) in buf.iter_mut().enumerate() {
        *b = ((mix >> (i * 8 % 128)) & 0xff) as u8;
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn pipe_name() -> String {
    format!(
        r"\\.\pipe\asmacro-setup-{}-{}",
        std::process::id(),
        gen_nonce()
    )
}

fn write_frame(handle: HANDLE, data: &[u8]) -> Result<(), String> {
    let len = (data.len() as u32).to_le_bytes();
    let mut written = 0u32;
    unsafe {
        WriteFile(handle, Some(&len), Some(&mut written), None).map_err(|e| e.to_string())?;
        WriteFile(handle, Some(data), Some(&mut written), None).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_frame(handle: HANDLE) -> Result<Vec<u8>, String> {
    let mut len_buf = [0u8; 4];
    let mut read = 0u32;
    unsafe {
        ReadFile(handle, Some(&mut len_buf), Some(&mut read), None).map_err(|e| e.to_string())?;
    }
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut data = vec![0u8; len];
    let mut read2 = 0u32;
    unsafe {
        ReadFile(handle, Some(&mut data), Some(&mut read2), None).map_err(|e| e.to_string())?;
    }
    Ok(data)
}

pub fn run_elevated(plan: &InstallPlan) -> Result<WorkResult, String> {
    let name = pipe_name();
    let name_w = wstr(&name);

    let server = unsafe {
        CreateNamedPipeW(
            PCWSTR(name_w.as_ptr()),
            PIPE_ACCESS_DUPLEX,
            Default::default(),
            1,
            64 * 1024,
            64 * 1024,
            0,
            None,
        )
    };
    if server.is_invalid() {
        return Err("CreateNamedPipeW failed".into());
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_w = wstr(&exe.to_string_lossy());
    let verb_w = wstr("runas");
    let params = format!("--elevated-worker --pipe={name}");
    let params_w = wstr(&params);

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb_w.as_ptr()),
        lpFile: PCWSTR(exe_w.as_ptr()),
        lpParameters: PCWSTR(params_w.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    let nonce = gen_nonce();

    unsafe {
        ShellExecuteExW(&mut info).map_err(|_| {
            let _ = CloseHandle(server);
            "UAC_CANCELLED".to_string()
        })?;

        ConnectNamedPipe(server, None).map_err(|e| e.to_string())?;

        let req = WorkRequest {
            nonce: nonce.clone(),
            plan: plan.clone(),
        };
        let req_bytes = serde_json::to_vec(&req).map_err(|e| e.to_string())?;
        write_frame(server, &req_bytes)?;

        let resp_bytes = read_frame(server)?;
        let result: WorkResult = serde_json::from_slice(&resp_bytes).map_err(|e| e.to_string())?;

        let _ = CloseHandle(server);
        if !info.hProcess.is_invalid() {
            WaitForSingleObject(info.hProcess, INFINITE);
            let _ = CloseHandle(info.hProcess);
        }

        Ok(result)
    }
}

pub fn run_worker(pipe: &str, execute: impl FnOnce(&InstallPlan) -> Result<(), String>) -> i32 {
    let pipe_w = wstr(pipe);
    let handle = unsafe {
        CreateFileW(
            PCWSTR(pipe_w.as_ptr()),
            (FILE_GENERIC_READ | FILE_GENERIC_WRITE).0,
            FILE_SHARE_NONE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    };
    let handle = match handle {
        Ok(h) => h,
        Err(_) => return 1,
    };

    let req_bytes = match read_frame(handle) {
        Ok(b) => b,
        Err(_) => return 1,
    };
    let req: WorkRequest = match serde_json::from_slice(&req_bytes) {
        Ok(r) => r,
        Err(_) => return 1,
    };

    let outcome = execute(&req.plan);
    let result = WorkResult {
        ok: outcome.is_ok(),
        message: outcome.err().unwrap_or_default(),
    };
    let resp_bytes = serde_json::to_vec(&result).unwrap_or_default();
    let _ = write_frame(handle, &resp_bytes);
    unsafe {
        let _ = CloseHandle(handle);
    }

    if result.ok {
        0
    } else {
        1
    }
}

pub fn relaunch_self_elevated_and_wait(params: &str) -> Result<u32, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_w = wstr(&exe.to_string_lossy());
    let verb_w = wstr("runas");
    let params_w = wstr(params);

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb_w.as_ptr()),
        lpFile: PCWSTR(exe_w.as_ptr()),
        lpParameters: PCWSTR(params_w.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    unsafe {
        ShellExecuteExW(&mut info).map_err(|_| "UAC_CANCELLED".to_string())?;
        if info.hProcess.is_invalid() {
            return Ok(0);
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 0u32;
        let _ = windows::Win32::System::Threading::GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
        Ok(code)
    }
}
