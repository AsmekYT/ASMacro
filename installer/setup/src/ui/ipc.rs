use crate::engine::{deelevate, elevate, install};
use crate::log;
use crate::plan::PlanScope;
use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;

use super::controller::Controller;
use super::{browse, resolve_lang, UserEvent};

pub(super) fn push_state(webview: &wry::WebView, controller: &Rc<RefCell<Controller>>) {
    let state = controller.borrow().state();
    let json = match serde_json::to_string(&state) {
        Ok(j) => j,
        Err(_) => return,
    };
    let _ = webview.evaluate_script(&format!(
        "window.__setup.emit({{event:'state',state:{json}}})"
    ));
}

pub(super) fn handle_ipc(
    msg: &serde_json::Value,
    controller: &Rc<RefCell<Controller>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    pending: &Rc<RefCell<Vec<String>>>,
) {
    let cmd = msg.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
    let mut needs_push = true;
    let mut start_install = false;

    {
        let mut ctrl = controller.borrow_mut();
        match cmd {
            "ready" => {}
            "drag" | "minimize" => {
                pending.borrow_mut().push(cmd.to_string());
                let _ = proxy.send_event(UserEvent::Wake);
                needs_push = false;
            }
            "cancel" => {
                pending.borrow_mut().push("close".to_string());
                let _ = proxy.send_event(UserEvent::Wake);
                needs_push = false;
            }
            "setLang" => {
                if let Some(lang) = msg.get("lang").and_then(|v| v.as_str()) {
                    ctrl.lang_choice = lang.to_string();
                    ctrl.lang = resolve_lang(lang);
                }
            }
            "setScope" => {
                if let Some(scope) = msg.get("scope").and_then(|v| v.as_str()) {
                    ctrl.scope = if scope == "machine" {
                        PlanScope::Machine
                    } else {
                        PlanScope::User
                    };
                    ctrl.scope_error = None;
                    ctrl.sync_dir_to_scope();
                }
            }
            "setDir" => {
                if let Some(dir) = msg.get("dir").and_then(|v| v.as_str()) {
                    ctrl.dir = dir.to_string();
                    ctrl.dir_touched = true;
                }
            }
            "browse" => {
                let initial = ctrl.dir.clone();
                drop(ctrl);
                if let Some(picked) = browse::pick_folder(Some(&initial)) {
                    let mut ctrl = controller.borrow_mut();
                    let picked = if picked
                        .file_name()
                        .map(|n| n.eq_ignore_ascii_case("ASMacro"))
                        .unwrap_or(false)
                    {
                        picked
                    } else {
                        picked.join("ASMacro")
                    };
                    ctrl.dir = picked.to_string_lossy().to_string();
                    ctrl.dir_touched = true;
                }
                push_needed(controller, proxy);
                return;
            }
            "setOption" => {
                let value = msg.get("value").and_then(|v| v.as_bool()).unwrap_or(false);
                match msg.get("key").and_then(|v| v.as_str()).unwrap_or("") {
                    "shortcutDesktop" => ctrl.shortcut_desktop = value,
                    "shortcutStartMenu" => ctrl.shortcut_start_menu = value,
                    "assoc" => ctrl.assoc = value,
                    "autostart" => ctrl.autostart = value,
                    _ => {}
                }
            }
            "changeSettings" => {
                ctrl.expanded = true;
                ctrl.page = "scope".to_string();
            }
            "back" => ctrl.go_back(),
            "next" => {
                if ctrl.advance() == Some("start") {
                    start_install = true;
                }
            }
            "finish" => {
                ctrl.launch_after = msg.get("launch").and_then(|v| v.as_bool()).unwrap_or(true);
                if ctrl.launch_after && (ctrl.finished_ok || ctrl.already_installed) {
                    let exe = Path::new(&ctrl.dir).join("ASMacro.exe");
                    let passthrough = ctrl.args.args_passthrough.clone().unwrap_or_default();
                    if elevate::is_elevated() {
                        deelevate::launch_as_user(&exe.to_string_lossy(), &passthrough);
                    } else {
                        let _ = std::process::Command::new(&exe)
                            .args(passthrough.split_whitespace())
                            .spawn();
                    }
                }
                pending.borrow_mut().push("close".to_string());
                let _ = proxy.send_event(UserEvent::Wake);
                needs_push = false;
            }
            "copyDetails" => {
                needs_push = false;
            }
            "autopilotDone" => {
                needs_push = false;
                let page = msg.get("page").and_then(|v| v.as_str()).unwrap_or("");
                ctrl.rendered_page = Some(page.to_string());
                ctrl.saw_license = msg
                    .get("sawLicense")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                pending.borrow_mut().push("close".to_string());
                let _ = proxy.send_event(UserEvent::Wake);
            }
            "rendered" => {
                needs_push = false;
                ctrl.rendered_logo = msg.get("logo").and_then(|v| v.as_bool()).unwrap_or(false);
                ctrl.rendered_page = msg
                    .get("page")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if ctrl.self_test_install {
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
            _ => {}
        }
    }

    if start_install {
        spawn_install(controller, proxy);
    }
    if needs_push {
        push_needed(controller, proxy);
    }
}

pub(super) fn push_needed(
    controller: &Rc<RefCell<Controller>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
) {
    let _ = controller;
    let _ = proxy.send_event(UserEvent::StateChanged);
}

pub(super) fn spawn_install(
    controller: &Rc<RefCell<Controller>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
) {
    let plan = controller.borrow().plan();
    let proxy = proxy.clone();

    std::thread::spawn(move || {
        let report = |pct: u32, step: &str, proxy: &tao::event_loop::EventLoopProxy<UserEvent>| {
            let _ = proxy.send_event(UserEvent::Progress {
                pct,
                step: step.to_string(),
            });
        };

        report(2, "prepare", &proxy);
        let _ = proxy.send_event(UserEvent::Log(format!("target: {}", plan.dir)));

        report(5, "wait", &proxy);
        if let Err(e) = install::wait_for_app_exit(Path::new(&plan.dir)) {
            let _ = proxy.send_event(UserEvent::Finished(Err(e)));
            return;
        }

        report(12, "legacy", &proxy);
        install::uninstall_legacy_if_present();

        let needs_elevation = plan.scope == PlanScope::Machine && !elevate::is_elevated();
        let scoped = if needs_elevation {
            let _ = proxy.send_event(UserEvent::Log("requesting administrator rights".into()));
            match elevate::run_elevated(&plan) {
                Ok(r) if r.ok => Ok(()),
                Ok(r) => Err(r.message),
                Err(e) if e == "UAC_CANCELLED" => Err("scope.err.uac".to_string()),
                Err(e) => Err(e),
            }
        } else {
            let mut sink = |pct: u32, step: &str| report(pct, step, &proxy);
            install::run_scoped_part_with_progress(&plan, &mut sink)
        };

        if let Err(e) = scoped {
            log::line(&format!("install failed: {e}"));
            let _ = proxy.send_event(UserEvent::Finished(Err(e)));
            return;
        }

        if let Err(e) = install::run_user_part(&plan) {
            log::line(&format!("per-user setup incomplete: {e}"));
            let _ = proxy.send_event(UserEvent::Log(format!("warning: {e}")));
        }

        report(100, "finalize", &proxy);
        let _ = proxy.send_event(UserEvent::Finished(Ok(())));
    });
}
