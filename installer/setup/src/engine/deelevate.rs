use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{
    DuplicateTokenEx, SecurityImpersonation, TokenPrimary, TOKEN_ALL_ACCESS,
};
use windows::Win32::System::Threading::{
    CreateProcessWithTokenW, OpenProcess, OpenProcessToken, PROCESS_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, STARTUPINFOW,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    GetShellWindow, GetWindowThreadProcessId, SW_SHOWNORMAL,
};

fn wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn shell_process_token() -> Option<HANDLE> {
    unsafe {
        let shell = GetShellWindow();
        if shell.is_invalid() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(shell, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut token = HANDLE::default();
        let ok = OpenProcessToken(
            process,
            windows::Win32::Security::TOKEN_DUPLICATE,
            &mut token,
        );
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(token)
    }
}

pub fn launch_as_user(exe: &str, args: &str) {
    if let Some(shell_token) = shell_process_token() {
        unsafe {
            let mut primary = HANDLE::default();
            let dup_ok = DuplicateTokenEx(
                shell_token,
                TOKEN_ALL_ACCESS,
                None,
                SecurityImpersonation,
                TokenPrimary,
                &mut primary,
            );
            let _ = CloseHandle(shell_token);

            if dup_ok.is_ok() {
                let cmdline = format!("\"{exe}\" {args}");
                let mut cmdline_w = wstr(&cmdline);
                let mut startup = STARTUPINFOW {
                    cb: std::mem::size_of::<STARTUPINFOW>() as u32,
                    ..Default::default()
                };
                let mut process_info = PROCESS_INFORMATION::default();
                let ok = CreateProcessWithTokenW(
                    primary,
                    Default::default(),
                    PCWSTR::null(),
                    Some(windows::core::PWSTR(cmdline_w.as_mut_ptr())),
                    Default::default(),
                    None,
                    PCWSTR::null(),
                    &mut startup,
                    &mut process_info,
                );
                let _ = CloseHandle(primary);
                if ok.is_ok() {
                    let _ = CloseHandle(process_info.hProcess);
                    let _ = CloseHandle(process_info.hThread);
                    return;
                }
            }
        }
    }

    let exe_w = wstr(exe);
    let args_w = wstr(args);
    unsafe {
        let _ = ShellExecuteW(
            None,
            PCWSTR::null(),
            PCWSTR(exe_w.as_ptr()),
            PCWSTR(args_w.as_ptr()),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}
