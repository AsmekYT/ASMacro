use crate::cli::Args;
use crate::engine::{detect, elevate, uninstall};
use crate::log;
use serde::Serialize;
use std::cell::RefCell;
use std::rc::Rc;

use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::WindowBuilder;
use wry::http::{Request, Response};
use wry::WebViewBuilder;

use super::{protocol, UserEvent};

const WINDOW_W: f64 = 720.0;
const WINDOW_H: f64 = 520.0;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UiState {
    page: String,
    steps: Vec<String>,
    lang: String,
    version: String,
    dir: String,
    purge: bool,
    mode: &'static str,
}

struct Controller {
    page: String,
    lang: String,
    version: String,
    dir: String,
    purge: bool,
    scope: crate::plan::PlanScope,
    silent: bool,
    finished_ok: bool,
    self_test: bool,
    self_test_run: bool,
    autopilot_started: bool,
    rendered_page: Option<String>,
    rendered_i18n: bool,
    rendered_launch_visible: bool,
    rendered_logo: bool,
}

impl Controller {
    fn steps(&self) -> Vec<String> {
        vec!["confirm".into(), "progress".into(), "done".into()]
    }

    fn state(&self) -> UiState {
        UiState {
            page: self.page.clone(),
            steps: self.steps(),
            lang: self.lang.clone(),
            version: self.version.clone(),
            dir: self.dir.clone(),
            purge: self.purge,
            mode: "uninstall",
        }
    }

    fn advance(&mut self) -> Option<&'static str> {
        let steps = self.steps();
        let idx = steps.iter().position(|s| *s == self.page)?;
        let next = steps.get(idx + 1)?;
        self.page = next.clone();
        if self.page == "progress" {
            return Some("start");
        }
        None
    }
}

fn installer_lang() -> String {
    use windows::Win32::System::Registry::HKEY_CURRENT_USER;
    crate::engine::registry::read_string(
        HKEY_CURRENT_USER,
        "Software\\me.asmek.asmacro",
        "Language",
    )
    .filter(|s| matches!(s.as_str(), "en" | "pl"))
    .unwrap_or_else(|| {
        use windows::Win32::Globalization::GetUserDefaultUILanguage;
        let lcid = unsafe { GetUserDefaultUILanguage() };
        match lcid & 0x3ff {
            0x15 => "pl",
            _ => "en",
        }
        .to_string()
    })
}

pub fn run(args: Args, existing: detect::Existing, version: &str) -> i32 {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = match WindowBuilder::new()
        .with_title("ASMacro Setup")
        .with_inner_size(tao::dpi::LogicalSize::new(WINDOW_W, WINDOW_H))
        .with_resizable(false)
        .with_maximizable(false)
        .with_decorations(false)
        .with_window_icon(super::load_icon())
        .build(&event_loop)
    {
        Ok(w) => w,
        Err(e) => {
            log::line(&format!("window creation failed: {e}"));
            return 5;
        }
    };

    let controller = Rc::new(RefCell::new(Controller {
        page: "confirm".to_string(),
        lang: installer_lang(),
        version: existing
            .version
            .clone()
            .unwrap_or_else(|| version.to_string()),
        dir: existing.path.clone(),
        purge: false,
        scope: existing.scope,
        silent: args.silent || args.passive,
        finished_ok: false,
        self_test: args.self_test,
        self_test_run: args.self_test_install,
        autopilot_started: false,
        rendered_page: None,
        rendered_i18n: false,
        rendered_launch_visible: false,
        rendered_logo: false,
    }));

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
    let self_test_run = controller.borrow().self_test_run;
    let testing = self_test || self_test_run;
    let self_test_deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);

    event_loop.run(move |event, _target, control_flow| {
        *control_flow = if testing {
            ControlFlow::WaitUntil(self_test_deadline)
        } else {
            ControlFlow::Wait
        };

        if testing && std::time::Instant::now() >= self_test_deadline {
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
                        if testing {
                            let (rendered, i18n, launch_visible, logo) = {
                                let ctrl = controller.borrow();
                                (
                                    ctrl.rendered_page.clone(),
                                    ctrl.rendered_i18n,
                                    ctrl.rendered_launch_visible,
                                    ctrl.rendered_logo,
                                )
                            };
                            let expected = if self_test_run { "done" } else { "confirm" };
                            let ok = rendered.as_deref() == Some(expected)
                                && i18n
                                && !launch_visible
                                && logo;
                            eprintln!(
                                "self-test: reached={rendered:?} expected={expected} i18n={i18n} launchVisible={launch_visible} logo={logo} ok={ok}"
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
            Event::NewEvents(tao::event::StartCause::Init) => push_state(&webview, &controller),
            Event::UserEvent(UserEvent::StateChanged) => push_state(&webview, &controller),
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
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                std::process::exit(*loop_exit.borrow())
            }
            _ => {}
        }
    });
}

fn push_state(webview: &wry::WebView, controller: &Rc<RefCell<Controller>>) {
    let state = controller.borrow().state();
    let json = match serde_json::to_string(&state) {
        Ok(j) => j,
        Err(_) => return,
    };
    let _ = webview.evaluate_script(&format!(
        "window.__setup.emit({{event:'state',state:{json}}})"
    ));
}

fn handle_ipc(
    msg: &serde_json::Value,
    controller: &Rc<RefCell<Controller>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    pending: &Rc<RefCell<Vec<String>>>,
) {
    let cmd = msg.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
    let mut needs_push = true;
    let mut start_uninstall = false;

    {
        let mut ctrl = controller.borrow_mut();
        match cmd {
            "ready" => {}
            "rendered" => {
                needs_push = false;
                ctrl.rendered_page = msg
                    .get("page")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                ctrl.rendered_i18n = msg.get("i18n").and_then(|v| v.as_bool()).unwrap_or(false);
                ctrl.rendered_logo = msg.get("logo").and_then(|v| v.as_bool()).unwrap_or(false);
                ctrl.rendered_launch_visible = msg
                    .get("launchVisible")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if ctrl.self_test_run {
                    if !ctrl.autopilot_started {
                        ctrl.autopilot_started = true;
                        pending.borrow_mut().push("autopilot".to_string());
                        let _ = proxy.send_event(UserEvent::Wake);
                    }
                } else if ctrl.self_test {
                    pending.borrow_mut().push("close".to_string());
                    let _ = proxy.send_event(UserEvent::Wake);
                }
            }
            "drag" | "minimize" | "cancel" => {
                pending.borrow_mut().push(if cmd == "cancel" {
                    "close".to_string()
                } else {
                    cmd.to_string()
                });
                let _ = proxy.send_event(UserEvent::Wake);
                needs_push = false;
            }
            "setPurge" => {
                ctrl.purge = msg.get("value").and_then(|v| v.as_bool()).unwrap_or(false);
            }
            "next" => {
                if ctrl.advance() == Some("start") {
                    start_uninstall = true;
                }
            }
            "autopilotDone" => {
                needs_push = false;
                let page = msg.get("page").and_then(|v| v.as_str()).unwrap_or("");
                ctrl.rendered_page = Some(page.to_string());
                pending.borrow_mut().push("close".to_string());
                let _ = proxy.send_event(UserEvent::Wake);
            }
            "finish" => {
                pending.borrow_mut().push("close".to_string());
                let _ = proxy.send_event(UserEvent::Wake);
                needs_push = false;
            }
            "copyDetails" => needs_push = false,
            _ => {}
        }
    }

    if start_uninstall {
        spawn_uninstall(controller, proxy);
    }
    if needs_push {
        let _ = proxy.send_event(UserEvent::StateChanged);
    }
}

fn spawn_uninstall(
    controller: &Rc<RefCell<Controller>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
) {
    let (purge, scope, silent) = {
        let ctrl = controller.borrow();
        (ctrl.purge, ctrl.scope, ctrl.silent)
    };
    let proxy = proxy.clone();

    std::thread::spawn(move || {
        let _ = proxy.send_event(UserEvent::Progress {
            pct: 20,
            step: "uninstall".to_string(),
        });

        let needs_elevation = scope == crate::plan::PlanScope::Machine && !elevate::is_elevated();
        let result = if needs_elevation {
            let _ = proxy.send_event(UserEvent::Log("requesting administrator rights".into()));
            let mut params = String::from("--uninstall");
            if purge {
                params.push_str(" --purge");
            }
            match elevate::relaunch_self_elevated_and_wait(&params) {
                Ok(0) => Ok(()),
                Ok(code) => Err(format!("elevated uninstall exited with code {code}")),
                Err(e) if e == "UAC_CANCELLED" => Err("scope.err.uac".to_string()),
                Err(e) => Err(e),
            }
        } else {
            uninstall::run(purge, silent)
        };

        let _ = proxy.send_event(UserEvent::Progress {
            pct: 100,
            step: "finalize".to_string(),
        });
        let _ = proxy.send_event(UserEvent::Finished(result));
    });
}
