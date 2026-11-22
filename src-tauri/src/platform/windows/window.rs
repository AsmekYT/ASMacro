use crate::platform::{WindowInfo, WindowManager};
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, TRUE};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    WaitForInputIdle, PROCESS_ACCESS_RIGHTS, PROCESS_NAME_FORMAT, PROCESS_QUERY_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
    ShowWindow, GW_OWNER, SW_RESTORE,
};

const PROCESS_SYNCHRONIZE: PROCESS_ACCESS_RIGHTS = PROCESS_ACCESS_RIGHTS(0x0010_0000);

pub struct WindowsWindows;

impl WindowsWindows {
    pub fn new() -> Self {
        WindowsWindows
    }
}

unsafe fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let ok = DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED,
        &mut cloaked as *mut u32 as *mut _,
        std::mem::size_of::<u32>() as u32,
    );
    ok.is_ok() && cloaked != 0
}

unsafe fn window_title(hwnd: HWND) -> String {
    let len = GetWindowTextLengthW(hwnd);
    if len <= 0 {
        return String::new();
    }
    let mut buf = vec![0u16; len as usize + 1];
    let written = GetWindowTextW(hwnd, &mut buf);
    String::from_utf16_lossy(&buf[..written as usize])
}

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<WindowInfo>);

    if !IsWindowVisible(hwnd).as_bool() || is_cloaked(hwnd) {
        return TRUE;
    }
    if GetWindow(hwnd, GW_OWNER)
        .map(|h| !h.is_invalid())
        .unwrap_or(false)
    {
        return TRUE;
    }
    let title = window_title(hwnd);
    if title.is_empty() {
        return TRUE;
    }
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    out.push(WindowInfo {
        id: hwnd.0 as u64,
        title,
        pid,
    });
    TRUE
}

impl WindowManager for WindowsWindows {
    fn list(&self) -> Result<Vec<WindowInfo>, String> {
        let mut out: Vec<WindowInfo> = Vec::new();
        unsafe {
            EnumWindows(Some(collect), LPARAM(&mut out as *mut _ as isize))
                .map_err(|e| e.to_string())?;
        }
        Ok(out)
    }

    fn focus(&self, id: u64) -> Result<(), String> {
        let hwnd = HWND(id as *mut std::ffi::c_void);
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let fg = GetForegroundWindow();
            let fg_thread = GetWindowThreadProcessId(fg, None);
            let our_thread = GetCurrentThreadId();
            let attached = fg_thread != 0
                && fg_thread != our_thread
                && AttachThreadInput(our_thread, fg_thread, true).as_bool();

            let _ = BringWindowToTop(hwnd);
            let raised = SetForegroundWindow(hwnd).as_bool();
            let _ = SetFocus(Some(hwnd));

            if attached {
                let _ = AttachThreadInput(our_thread, fg_thread, false);
            }
            if raised || GetForegroundWindow() == hwnd {
                Ok(())
            } else {
                Err("The system refused to change the foreground window".into())
            }
        }
    }

    fn process_tree(&self, root: u32) -> Vec<u32> {
        let mut pairs: Vec<(u32, u32)> = Vec::new();
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return vec![root];
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    pairs.push((entry.th32ProcessID, entry.th32ParentProcessID));
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        descendants(root, &pairs)
    }

    fn process_exe_name(&self, pid: u32) -> Option<String> {
        unsafe {
            let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_FORMAT(0),
                PWSTR(buf.as_mut_ptr()),
                &mut len,
            );
            let _ = CloseHandle(handle);
            ok.ok()?;
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            Some(
                std::path::Path::new(&full)
                    .file_name()?
                    .to_string_lossy()
                    .to_string(),
            )
        }
    }

    fn wait_input_idle(&self, pid: u32, timeout_ms: u64) {
        unsafe {
            let Ok(handle) =
                OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SYNCHRONIZE, false, pid)
            else {
                return;
            };
            WaitForInputIdle(handle, timeout_ms.min(u32::MAX as u64) as u32);
            let _ = CloseHandle(handle);
        }
    }
}

fn descendants(root: u32, pairs: &[(u32, u32)]) -> Vec<u32> {
    let mut out = vec![root];
    let mut frontier = vec![root];
    while let Some(parent) = frontier.pop() {
        for (pid, ppid) in pairs {
            if *ppid == parent && !out.contains(pid) {
                out.push(*pid);
                frontier.push(*pid);
            }
        }
    }
    out
}

#[cfg(test)]
mod live_tests {
    use super::WindowsWindows;
    use crate::platform::WindowManager;

    #[test]
    #[ignore]
    fn lists_and_focuses_a_real_window() {
        let mut child = std::process::Command::new("winver.exe")
            .spawn()
            .expect("spawning winver");
        std::thread::sleep(std::time::Duration::from_millis(1500));

        let wm = WindowsWindows::new();
        let windows = wm.list().expect("listing windows");
        println!("{} windows visible", windows.len());
        for w in &windows {
            println!("  id={:#x} pid={} title={:?}", w.id, w.pid, w.title);
        }

        let mine = windows.iter().find(|w| w.pid == child.id()).cloned();
        let tree = wm.process_tree(child.id());
        let exe = mine.as_ref().and_then(|w| wm.process_exe_name(w.pid));
        let focused = mine.as_ref().map(|w| wm.focus(w.id));

        let _ = child.kill();
        let _ = child.wait();

        let mine = mine.unwrap_or_else(|| panic!("winver's window was not listed"));
        assert!(
            tree.contains(&mine.pid),
            "the window's pid {} should be in the spawned process tree {tree:?}",
            mine.pid
        );
        assert_eq!(
            exe.as_deref().map(str::to_lowercase),
            Some("winver.exe".to_string())
        );
        focused.unwrap().expect("focusing the test window");
    }
}

#[cfg(test)]
mod tests {
    use super::descendants;

    #[test]
    fn collects_grandchildren() {
        let pairs = [(100, 1), (200, 100), (300, 200), (400, 1)];
        let mut got = descendants(100, &pairs);
        got.sort();
        assert_eq!(got, vec![100, 200, 300]);
    }

    #[test]
    fn survives_a_recycled_pid_cycle() {
        let pairs = [(100, 200), (200, 100)];
        let mut got = descendants(100, &pairs);
        got.sort();
        assert_eq!(got, vec![100, 200]);
    }
}
