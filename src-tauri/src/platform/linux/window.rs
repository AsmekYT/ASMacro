use super::x11conn::{x11, X11};
use crate::platform::{WindowInfo, WindowManager};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt as _, EventMask, InputFocus,
    MapState, StackMode, Window, CLIENT_MESSAGE_EVENT,
};

pub struct LinuxWindows;

impl LinuxWindows {
    pub fn new() -> Self {
        LinuxWindows
    }
}

const NO_X11: &str = "No X11 connection — window listing and switching need an X11 session \
                      (or XWayland with an EWMH-compliant window manager). Under native \
                      Wayland the compositor does not expose other applications' windows.";

const NO_WINDOWS: &str = "No application windows could be found. Under native Wayland the \
                          compositor does not expose other applications' windows to the app.";

fn atom(x: &X11, name: &str) -> Result<u32, String> {
    Ok(x.conn
        .intern_atom(false, name.as_bytes())
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?
        .atom)
}

fn ewmh_client_list(x: &X11, root: Window) -> Vec<Window> {
    for name in ["_NET_CLIENT_LIST", "_NET_CLIENT_LIST_STACKING"] {
        let Ok(prop) = atom(x, name) else { continue };
        let wins: Vec<Window> = x
            .conn
            .get_property(false, root, prop, AtomEnum::WINDOW, 0, u32::MAX)
            .ok()
            .and_then(|c| c.reply().ok())
            .and_then(|r| r.value32().map(|v| v.collect()))
            .unwrap_or_default();
        if !wins.is_empty() {
            return wins;
        }
    }
    Vec::new()
}

fn is_viewable(x: &X11, win: Window) -> bool {
    x.conn
        .get_window_attributes(win)
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|a| a.map_state == MapState::VIEWABLE && !a.override_redirect)
        .unwrap_or(false)
}

fn viewable_children(x: &X11, win: Window) -> Vec<Window> {
    x.conn
        .query_tree(win)
        .ok()
        .and_then(|c| c.reply().ok())
        .map(|t| {
            t.children
                .into_iter()
                .filter(|w| is_viewable(x, *w))
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_client(x: &X11, win: Window, net_wm_name: u32, depth: u8) -> Option<Window> {
    if window_title(x, win, net_wm_name).is_some() {
        return Some(win);
    }
    if depth == 0 {
        return None;
    }
    viewable_children(x, win)
        .into_iter()
        .find_map(|child| resolve_client(x, child, net_wm_name, depth - 1))
}

fn unmanaged_client_list(x: &X11, root: Window, net_wm_name: u32) -> Vec<Window> {
    viewable_children(x, root)
        .into_iter()
        .filter_map(|win| resolve_client(x, win, net_wm_name, 3))
        .collect()
}

fn client_list(x: &X11, root: Window, net_wm_name: u32) -> Vec<Window> {
    let managed = ewmh_client_list(x, root);
    if managed.is_empty() {
        unmanaged_client_list(x, root, net_wm_name)
    } else {
        managed
    }
}

fn text_property(x: &X11, win: Window, prop: u32) -> Option<String> {
    let reply = x
        .conn
        .get_property(false, win, prop, AtomEnum::ANY, 0, 1024)
        .ok()?
        .reply()
        .ok()?;
    if reply.value.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(&reply.value).to_string())
}

fn window_title(x: &X11, win: Window, net_wm_name: u32) -> Option<String> {
    text_property(x, win, net_wm_name)
        .or_else(|| text_property(x, win, u32::from(AtomEnum::WM_NAME)))
        .filter(|t| !t.trim().is_empty())
}

fn window_pid(x: &X11, win: Window, net_wm_pid: u32) -> u32 {
    x.conn
        .get_property(false, win, net_wm_pid, AtomEnum::CARDINAL, 0, 1)
        .ok()
        .and_then(|c| c.reply().ok())
        .and_then(|r| r.value32()?.next())
        .unwrap_or(0)
}

impl WindowManager for LinuxWindows {
    fn list(&self) -> Result<Vec<WindowInfo>, String> {
        let x = x11().ok_or_else(|| NO_X11.to_string())?;
        let root = x.root_screen().root;
        let net_wm_pid = atom(x, "_NET_WM_PID")?;
        let net_wm_name = atom(x, "_NET_WM_NAME")?;

        let mut out = Vec::new();
        for win in client_list(x, root, net_wm_name) {
            let Some(title) = window_title(x, win, net_wm_name) else {
                continue;
            };
            out.push(WindowInfo {
                id: win as u64,
                title,
                pid: window_pid(x, win, net_wm_pid),
            });
        }
        if out.is_empty() {
            return Err(NO_WINDOWS.to_string());
        }
        Ok(out)
    }

    fn focus(&self, id: u64) -> Result<(), String> {
        let x = x11().ok_or_else(|| NO_X11.to_string())?;
        let win = id as Window;
        let root = x.root_screen().root;
        let net_active = atom(x, "_NET_ACTIVE_WINDOW")?;

        let event = ClientMessageEvent {
            response_type: CLIENT_MESSAGE_EVENT,
            format: 32,
            sequence: 0,
            window: win,
            type_: net_active,
            data: [2u32, x11rb::CURRENT_TIME, 0, 0, 0].into(),
        };
        x.conn
            .send_event(
                false,
                root,
                EventMask::SUBSTRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_REDIRECT,
                event,
            )
            .map_err(|e| e.to_string())?;

        let _ = x
            .conn
            .configure_window(win, &ConfigureWindowAux::new().stack_mode(StackMode::ABOVE));
        let _ = x
            .conn
            .set_input_focus(InputFocus::PARENT, win, x11rb::CURRENT_TIME);
        x.conn.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn process_tree(&self, root: u32) -> Vec<u32> {
        let mut pairs: Vec<(u32, u32)> = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let Some(pid) = entry
                    .file_name()
                    .to_str()
                    .and_then(|n| n.parse::<u32>().ok())
                else {
                    continue;
                };
                if let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) {
                    if let Some(ppid) = parse_ppid(&stat) {
                        pairs.push((pid, ppid));
                    }
                }
            }
        }
        descendants(root, &pairs)
    }

    fn process_exe_name(&self, pid: u32) -> Option<String> {
        if let Ok(exe) = std::fs::read_link(format!("/proc/{pid}/exe")) {
            if let Some(name) = exe.file_name() {
                return Some(name.to_string_lossy().to_string());
            }
        }
        std::fs::read_to_string(format!("/proc/{pid}/comm"))
            .ok()
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
    }

    fn wait_input_idle(&self, _pid: u32, _timeout_ms: u64) {}
}

fn parse_ppid(stat: &str) -> Option<u32> {
    let after_comm = &stat[stat.rfind(')')? + 1..];
    after_comm.split_whitespace().nth(1)?.parse().ok()
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
    use super::LinuxWindows;
    use crate::platform::WindowManager;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{
        AtomEnum, ConnectionExt as _, CreateWindowAux, EventMask, PropMode, WindowClass,
    };
    use x11rb::wrapper::ConnectionExt as _;

    fn map_test_window(title: &str) -> (x11rb::rust_connection::RustConnection, u32) {
        let (conn, screen_num) = x11rb::connect(None).expect("no X11 display");
        let screen = &conn.setup().roots[screen_num];
        let win = conn.generate_id().unwrap();
        conn.create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            win,
            screen.root,
            0,
            0,
            200,
            100,
            1,
            WindowClass::INPUT_OUTPUT,
            screen.root_visual,
            &CreateWindowAux::new().event_mask(EventMask::EXPOSURE),
        )
        .unwrap();
        conn.change_property8(
            PropMode::REPLACE,
            win,
            u32::from(AtomEnum::WM_NAME),
            u32::from(AtomEnum::STRING),
            title.as_bytes(),
        )
        .unwrap();
        let pid_atom = conn
            .intern_atom(false, b"_NET_WM_PID")
            .unwrap()
            .reply()
            .unwrap()
            .atom;
        conn.change_property32(
            PropMode::REPLACE,
            win,
            pid_atom,
            u32::from(AtomEnum::CARDINAL),
            &[std::process::id()],
        )
        .unwrap();
        conn.map_window(win).unwrap();
        conn.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(700));
        (conn, win)
    }

    #[test]
    #[ignore]
    fn maps_a_window_and_waits() {
        if std::env::var_os("ASMACRO_LIVE_CHILD").is_none() {
            return;
        }
        let (_conn, _win) = map_test_window("asmacro-child-window");
        std::thread::sleep(std::time::Duration::from_secs(20));
    }

    #[test]
    #[ignore]
    fn lists_and_focuses_a_real_window() {
        let title = "asmacro-live-test-window";
        let (_conn, win) = map_test_window(title);
        let wm = LinuxWindows::new();

        let windows = wm.list().expect("listing windows");
        println!("{} windows visible", windows.len());
        for w in &windows {
            println!("  id={:#x} pid={} title={:?}", w.id, w.pid, w.title);
        }

        let mine = windows
            .iter()
            .find(|w| w.title == title)
            .unwrap_or_else(|| panic!("test window {win:#x} not in _NET_CLIENT_LIST"));
        assert_eq!(mine.pid, std::process::id(), "_NET_WM_PID round-trips");

        wm.focus(mine.id).expect("focusing the test window");
    }
}

#[cfg(test)]
mod tests {
    use super::{descendants, parse_ppid};

    #[test]
    fn reads_ppid_past_a_plain_comm() {
        assert_eq!(parse_ppid("1234 (bash) S 1000 1234 1234 0 -1"), Some(1000));
    }

    #[test]
    fn reads_ppid_when_comm_contains_parens_and_spaces() {
        assert_eq!(
            parse_ppid("42 (my app (x86)) S 7 42 42 0 -1"),
            Some(7),
            "the last ')' delimits comm, not the first"
        );
    }

    #[test]
    fn rejects_truncated_stat() {
        assert_eq!(parse_ppid("42 (sh) S"), None);
        assert_eq!(parse_ppid("garbage"), None);
    }

    #[test]
    fn collects_grandchildren() {
        let pairs = [(100, 1), (200, 100), (300, 200), (400, 1)];
        let mut got = descendants(100, &pairs);
        got.sort();
        assert_eq!(got, vec![100, 200, 300]);
    }

    #[test]
    fn real_process_tree_contains_self() {
        use crate::platform::WindowManager;
        let pid = std::process::id();
        assert!(super::LinuxWindows::new().process_tree(pid).contains(&pid));
    }
}
