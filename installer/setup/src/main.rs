#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod engine;
mod log;
mod plan;
mod ui;

use cli::Scope;
use engine::{detect, elevate, folders, install, payload, uninstall};
use plan::{InstallPlan, PlanScope};
use windows::Win32::System::Environment::GetCommandLineW;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn attach_console() {
    use windows::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

fn raw_command_line() -> String {
    unsafe {
        let ptr = GetCommandLineW();
        let full = ptr.to_string().unwrap_or_default();
        strip_argv0(&full)
    }
}

fn strip_argv0(s: &str) -> String {
    let s = s.trim_start();
    if let Some(rest) = s.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return rest[end + 1..].trim_start().to_string();
        }
    }
    match s.find(char::is_whitespace) {
        Some(i) => s[i..].trim_start().to_string(),
        None => String::new(),
    }
}

fn is_uninstall_binary() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_ascii_lowercase()))
        .map(|n| n.to_string_lossy().eq_ignore_ascii_case("uninstall.exe"))
        .unwrap_or(false)
}

fn build_plan(
    args: &cli::Args,
    existing: Option<&detect::Existing>,
) -> Result<InstallPlan, String> {
    let update = args.update || existing.is_some();

    let scope = args
        .scope
        .or_else(|| {
            existing.map(|e| match e.scope {
                PlanScope::User => Scope::User,
                PlanScope::Machine => Scope::Machine,
            })
        })
        .unwrap_or(Scope::User);

    let dir = args
        .dir
        .clone()
        .or_else(|| existing.map(|e| e.path.clone()))
        .unwrap_or_else(|| {
            folders::default_install_dir(scope.into())
                .to_string_lossy()
                .to_string()
        });

    let lang = args.lang.clone().unwrap_or_else(|| "auto".to_string());

    let (shortcut_desktop, shortcut_startmenu, assoc, autostart) = if update {
        let e = existing.expect("update implies an existing install record or /UPDATE flag");
        (
            args.shortcut_desktop.unwrap_or(e.shortcut_desktop),
            args.shortcut_startmenu.unwrap_or(e.shortcut_startmenu),
            args.assoc.unwrap_or(e.assoc),
            args.autostart.unwrap_or(e.autostart),
        )
    } else {
        (
            args.shortcut_desktop.unwrap_or(!args.no_shortcuts),
            args.shortcut_startmenu.unwrap_or(!args.no_shortcuts),
            args.assoc.unwrap_or(true),
            args.autostart.unwrap_or(false),
        )
    };

    Ok(InstallPlan {
        scope: scope.into(),
        dir,
        lang,
        shortcut_desktop,
        shortcut_startmenu,
        assoc,
        autostart,
        run_after: args.run_after,
        update,
        silent: args.silent || args.passive,
        version: VERSION.to_string(),
    })
}

pub(crate) fn do_install(args: &cli::Args) -> i32 {
    let existing = detect::find_existing();

    if args.dir.is_none()
        && args.scope.is_none()
        && install::already_installed(existing.as_ref(), VERSION)
    {
        log::line("same version already installed and intact, nothing to do");
        return 0;
    }

    let plan = match build_plan(args, existing.as_ref()) {
        Ok(p) => p,
        Err(e) => {
            log::line(&format!("build_plan failed: {e}"));
            return 2;
        }
    };
    log::line(&format!("install plan: {plan:?}"));

    if let Err(e) = install::wait_for_app_exit(std::path::Path::new(&plan.dir)) {
        log::line(&e);
        return 6;
    }

    install::uninstall_legacy_if_present();

    let needs_elevation = plan.scope == PlanScope::Machine && !elevate::is_elevated();
    let scoped_result = if needs_elevation {
        match elevate::run_elevated(&plan) {
            Ok(r) if r.ok => Ok(()),
            Ok(r) => Err(r.message),
            Err(e) if e == "UAC_CANCELLED" => {
                log::line("UAC prompt was cancelled");
                return 4;
            }
            Err(e) => Err(e),
        }
    } else {
        install::run_scoped_part(&plan)
    };

    if let Err(e) = scoped_result {
        log::line(&format!("install failed: {e}"));
        return 1;
    }

    if elevate::is_elevated() && needs_elevation {
        log::line("warning: parent unexpectedly elevated, skipping per-user registry writes");
    } else if let Err(e) = install::run_user_part(&plan) {
        log::line(&format!("warning: per-user setup incomplete: {e}"));
    }

    if plan.run_after {
        let exe = std::path::Path::new(&plan.dir).join("ASMacro.exe");
        if elevate::is_elevated() {
            engine::deelevate::launch_as_user(
                &exe.to_string_lossy(),
                args.args_passthrough.as_deref().unwrap_or(""),
            );
        } else {
            let _ = std::process::Command::new(&exe)
                .args(
                    args.args_passthrough
                        .as_deref()
                        .unwrap_or("")
                        .split_whitespace(),
                )
                .spawn();
        }
    }

    0
}

fn do_uninstall(args: &cli::Args) -> i32 {
    if let (Some(dir), Some(pid)) = (&args.finalize_remove, args.wait_pid) {
        uninstall::finalize_remove(std::path::Path::new(dir), pid);
        return 0;
    }

    let existing = match detect::find_existing() {
        Some(e) => e,
        None => {
            log::line("nothing to uninstall");
            return 0;
        }
    };

    if existing.scope == PlanScope::Machine && !elevate::is_elevated() {
        let mut params = String::from("--uninstall");
        if args.purge {
            params.push_str(" --purge");
        }
        return match elevate::relaunch_self_elevated_and_wait(&params) {
            Ok(code) => code as i32,
            Err(e) if e == "UAC_CANCELLED" => 4,
            Err(e) => {
                log::line(&e);
                1
            }
        };
    }

    match uninstall::run(args.purge, args.silent) {
        Ok(()) => 0,
        Err(e) => {
            log::line(&e);
            1
        }
    }
}

fn main() -> std::process::ExitCode {
    let raw = raw_command_line();
    let args = cli::parse(&raw);

    log::init(args.log.as_deref());

    if args.version {
        attach_console();
        println!("asmacro-setup {VERSION}");
        return std::process::ExitCode::SUCCESS;
    }
    if args.help {
        attach_console();
        println!(concat!(
            "asmacro-setup ",
            env!("CARGO_PKG_VERSION"),
            "\n\n",
            "  /S /P /R /UPDATE /NS /D=<dir> /ARGS <passthrough>   NSIS-compatible flags\n",
            "  --scope=user|machine  --dir=<p>  --lang=auto|en|pl|de\n",
            "  --shortcut-desktop[=0|1]  --shortcut-startmenu[=0|1]\n",
            "  --assoc[=0|1]  --autostart[=0|1]  --log=<p>\n",
            "  --uninstall [--purge]\n",
        ));
        return std::process::ExitCode::SUCCESS;
    }

    if args.elevated_worker {
        let Some(pipe) = args.pipe.as_deref() else {
            return std::process::ExitCode::from(2);
        };
        let code = elevate::run_worker(pipe, |plan| install::run_scoped_part(plan));
        return std::process::ExitCode::from(code as u8);
    }

    let interactive = !args.silent && !args.passive;

    let wants_uninstall =
        (args.uninstall || is_uninstall_binary()) && args.finalize_remove.is_none();

    let code = if args.finalize_remove.is_some() {
        do_uninstall(&args)
    } else if wants_uninstall && interactive {
        if args.self_test || args.self_test_install {
            attach_console();
        }
        let existing = detect::find_existing().or_else(|| {
            args.self_test.then(|| detect::Existing {
                scope: PlanScope::User,
                path: r"C:\Program Files\ASMacro".to_string(),
                version: Some(VERSION.to_string()),
                shortcut_desktop: true,
                shortcut_startmenu: true,
                assoc: false,
                autostart: false,
                is_ours: true,
                uninstall_string: None,
            })
        });
        match existing {
            None => do_uninstall(&args),
            Some(existing) => {
                if args.self_test || args.self_test_install || engine::webview2::is_installed() {
                    ui::uninstall::run(args, existing, VERSION)
                } else if args.no_webview2_bootstrap || !ui::native::offer_webview2_bootstrap() {
                    ui::native::run_uninstall(args)
                } else if engine::webview2::is_installed() {
                    ui::uninstall::run(args, existing, VERSION)
                } else {
                    ui::native::run_uninstall(args)
                }
            }
        }
    } else if wants_uninstall {
        do_uninstall(&args)
    } else if interactive && payload::has_payload() {
        if args.self_test || args.self_test_install {
            attach_console();
        }
        if args.self_test || args.self_test_install || engine::webview2::is_installed() {
            let size = payload::installed_size().unwrap_or(0);
            ui::run(args, size, VERSION)
        } else if args.no_webview2_bootstrap
            || !ui::native::offer_webview2_bootstrap()
            || !engine::webview2::is_installed()
        {
            ui::native::run(args)
        } else {
            let size = payload::installed_size().unwrap_or(0);
            ui::run(args, size, VERSION)
        }
    } else if !payload::has_payload() && args.finalize_remove.is_none() {
        attach_console();
        eprintln!("asmacro-setup: no embedded payload (dev build) and not run as --uninstall");
        1
    } else {
        do_install(&args)
    };

    std::process::ExitCode::from(code as u8)
}
