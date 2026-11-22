pub mod browse;
mod controller;
mod ipc;
pub mod native;
pub mod protocol;
pub mod uninstall;

use controller::Controller;
use ipc::{handle_ipc, push_state};

use crate::cli::Args;
use crate::log;
use std::cell::RefCell;
use std::rc::Rc;

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use wry::http::{Request, Response};
use wry::WebViewBuilder;

const WINDOW_W: f64 = 720.0;
const WINDOW_H: f64 = 520.0;

#[derive(Debug)]
pub enum UserEvent {
    StateChanged,
    Wake,
    Progress { pct: u32, step: String },
    Log(String),
    Finished(Result<(), String>),
}

fn resolve_lang(choice: &str) -> String {
    match choice {
        "en" | "pl" => choice.to_string(),
        _ => system_lang().unwrap_or_else(|| "en".to_string()),
    }
}

fn system_lang() -> Option<String> {
    use windows::Win32::Globalization::GetUserDefaultUILanguage;
    let lcid = unsafe { GetUserDefaultUILanguage() };
    match lcid & 0x3ff {
        0x15 => Some("pl".to_string()),
        0x09 => Some("en".to_string()),
        _ => None,
    }
}

pub(crate) fn load_icon() -> Option<Icon> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, GetDC, GetDIBits, ReleaseDC, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GetIconInfo, LoadImageW, HICON, ICONINFO, IMAGE_ICON, LR_DEFAULTCOLOR,
    };

    const SIZE: i32 = 32;

    unsafe {
        let hinstance = GetModuleHandleW(None).ok()?;
        let handle = LoadImageW(
            Some(hinstance.into()),
            PCWSTR(1 as *const u16),
            IMAGE_ICON,
            SIZE,
            SIZE,
            LR_DEFAULTCOLOR,
        )
        .ok()?;
        let hicon = HICON(handle.0);

        let mut info = ICONINFO::default();
        if GetIconInfo(hicon, &mut info).is_err() {
            let _ = DestroyIcon(hicon);
            return None;
        }
        let _ = DestroyIcon(hicon);

        let hdc = GetDC(None);
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: SIZE,
                biHeight: -SIZE,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut buf = vec![0u8; (SIZE * SIZE * 4) as usize];
        let rows = GetDIBits(
            hdc,
            info.hbmColor,
            0,
            SIZE as u32,
            Some(buf.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );
        ReleaseDC(None, hdc);
        let _ = DeleteObject(info.hbmColor.into());
        let _ = DeleteObject(info.hbmMask.into());
        if rows == 0 {
            return None;
        }

        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        Icon::from_rgba(buf, SIZE as u32, SIZE as u32).ok()
    }
}

pub fn run(args: Args, payload_size: u64, version: &str) -> i32 {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = match WindowBuilder::new()
        .with_title("ASMacro Setup")
        .with_inner_size(tao::dpi::LogicalSize::new(WINDOW_W, WINDOW_H))
        .with_resizable(false)
        .with_maximizable(false)
        .with_decorations(false)
        .with_window_icon(load_icon())
        .build(&event_loop)
    {
        Ok(w) => w,
        Err(e) => {
            log::line(&format!("window creation failed: {e}"));
            return 5;
        }
    };

    let controller = Rc::new(RefCell::new(Controller::new(
        args,
        payload_size,
        version.to_string(),
    )));

    let ipc_controller = controller.clone();
    let ipc_proxy = proxy.clone();
    let pending: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
    let ipc_pending = pending.clone();

    let webview = match WebViewBuilder::new()
        .with_url("setup://localhost/index.html")
        .with_custom_protocol("setup".into(), move |_id, request: Request<Vec<u8>>| {
            match protocol::resolve(&request.uri().to_string()) {
                Some((mime, body)) => Response::builder()
                    .header("Content-Type", mime)
                    .body(std::borrow::Cow::Owned(body))
                    .unwrap_or_else(|_| Response::new(std::borrow::Cow::Owned(Vec::new()))),
                None => Response::builder()
                    .status(404)
                    .body(std::borrow::Cow::Owned(Vec::new()))
                    .unwrap_or_else(|_| Response::new(std::borrow::Cow::Owned(Vec::new()))),
            }
        })
        .with_ipc_handler(move |req: Request<String>| {
            let msg: serde_json::Value = match serde_json::from_str(req.body()) {
                Ok(v) => v,
                Err(_) => return,
            };
            handle_ipc(&msg, &ipc_controller, &ipc_proxy, &ipc_pending);
        })
        .build(&window)
    {
        Ok(w) => w,
        Err(e) => {
            log::line(&format!("webview creation failed: {e}"));
            return 5;
        }
    };

    let exit_code = Rc::new(RefCell::new(0i32));
    let loop_exit = exit_code.clone();
    let self_test = controller.borrow().self_test;
    let self_test_install = controller.borrow().self_test_install;
    let self_test_deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);

    event_loop.run(move |event, _target, control_flow| {
        *control_flow = if self_test || self_test_install {
            ControlFlow::WaitUntil(self_test_deadline)
        } else {
            ControlFlow::Wait
        };

        if (self_test || self_test_install) && std::time::Instant::now() >= self_test_deadline {
            let rendered = controller.borrow().rendered_page.clone();
            eprintln!("self-test: timed out, rendered={rendered:?}");
            std::process::exit(1);
        }

        {
            let mut queue = pending.borrow_mut();
            for action in queue.drain(..) {
                match action.as_str() {
                    "drag" => { let _ = window.drag_window(); }
                    "minimize" => window.set_minimized(true),
                    "autopilot" => { let _ = webview.evaluate_script("window.__autopilot()"); }
                    "close" => {
                        if self_test || self_test_install {
                            let (rendered, saw_license, is_update, logo) = {
                                let ctrl = controller.borrow();
                                (
                                    ctrl.rendered_page.clone(),
                                    ctrl.saw_license,
                                    ctrl.is_update(),
                                    ctrl.rendered_logo,
                                )
                            };
                            let expected = if self_test_install { "done" } else { "lang" };
                            let license_ok = !(is_update && saw_license);
                            let ok = rendered.as_deref() == Some(expected) && license_ok && logo;
                            eprintln!(
                                "self-test: reached={rendered:?} expected={expected} update={is_update} sawLicense={saw_license} logo={logo} ok={ok}"
                            );
                            std::process::exit(if ok { 0 } else { 1 });
                        }
                        std::process::exit(*loop_exit.borrow());
                    }
                    _ => {}
                }
            }
        }

        match event {
            Event::NewEvents(tao::event::StartCause::Init) => {
                push_state(&webview, &controller);
            }
            Event::UserEvent(UserEvent::StateChanged) => {
                push_state(&webview, &controller);
            }
            Event::UserEvent(UserEvent::Wake) => {}
            Event::UserEvent(UserEvent::Progress { pct, step }) => {
                let js = format!(
                    "window.__setup.emit({{event:'progress',pct:{pct},step:{}}})",
                    serde_json::to_string(&step).unwrap_or_else(|_| "\"\"".into())
                );
                let _ = webview.evaluate_script(&js);
            }
            Event::UserEvent(UserEvent::Log(line)) => {
                let js = format!(
                    "window.__setup.emit({{event:'log',line:{}}})",
                    serde_json::to_string(&line).unwrap_or_else(|_| "\"\"".into())
                );
                let _ = webview.evaluate_script(&js);
            }
            Event::UserEvent(UserEvent::Finished(result)) => {
                let mut ctrl = controller.borrow_mut();
                match result {
                    Ok(()) => {
                        ctrl.finished_ok = true;
                        ctrl.page = "done".to_string();
                        drop(ctrl);
                        push_state(&webview, &controller);
                    }
                    Err(message) => {
                        ctrl.page = "error".to_string();
                        drop(ctrl);
                        push_state(&webview, &controller);
                        let detail = log::path().unwrap_or_default();
                        let js = format!(
                            "window.__setup.emit({{event:'error',message:{},detail:{}}})",
                            serde_json::to_string(&message).unwrap_or_else(|_| "\"\"".into()),
                            serde_json::to_string(&detail).unwrap_or_else(|_| "\"\"".into())
                        );
                        let _ = webview.evaluate_script(&js);
                        *loop_exit.borrow_mut() = 1;
                    }
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => std::process::exit(*loop_exit.borrow()),
            _ => {}
        }
    });
}
