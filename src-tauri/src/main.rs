#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autoclicker;
mod executor;
mod files;
mod hotkey;
mod humanize;
mod i18n;
mod input_state;
mod input_types;
mod ocr;
mod platform;
mod programs;
mod vision;

use autoclicker::*;
use executor::*;
use files::*;
use i18n::tr;
use input_state::*;
use ocr::ocr_read_region;
use platform::{platform_capabilities, set_autoclicker_hotkey, set_macro_hotkeys};
use programs::*;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use vision::*;

struct PendingOpen(Mutex<Option<String>>);

fn first_macro_arg(argv: &[String]) -> Option<String> {
    argv.iter().skip(1).find_map(|a| {
        if a.starts_with('-') || a.starts_with('/') {
            return None;
        }
        let lower = a.to_ascii_lowercase();
        if !lower.ends_with(".asmacro") {
            return None;
        }
        let path = std::path::Path::new(a);
        if !path.is_file() {
            return None;
        }
        path.canonicalize()
            .ok()
            .map(|p| p.to_string_lossy().trim_start_matches(r"\\?\").to_string())
            .or_else(|| Some(a.clone()))
    })
}

#[tauri::command]
fn take_pending_open(state: State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

struct TrayMenuItems {
    show: MenuItem<tauri::Wry>,
    run: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    ac_toggle: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[tauri::command]
fn set_ui_language(app: AppHandle, strings: std::collections::HashMap<String, String>) {
    i18n::set_strings(strings);
    if let Some(items) = app.try_state::<TrayMenuItems>() {
        let _ = items.show.set_text(tr("tray.show"));
        let _ = items.run.set_text(tr("tray.run"));
        let _ = items.stop.set_text(tr("tray.stop"));
        let _ = items.ac_toggle.set_text(tr("tray.acToggle"));
        let _ = items.quit.set_text(tr("tray.quit"));
    }
}

#[tauri::command]
fn installer_language() -> Option<String> {
    platform::installer_language()
}

#[tauri::command]
fn system_language() -> Option<String> {
    platform::system_language()
}

#[tauri::command]
fn updater_supported() -> bool {
    #[cfg(target_os = "windows")]
    {
        true
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE").is_some()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        false
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            show_main_window(app);
            if let Some(path) = first_macro_arg(&argv) {
                let _ = app.emit("open-macro-file", path);
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            app.manage(PendingOpen(Mutex::new(first_macro_arg(&argv))));

            let show = MenuItem::with_id(app, "show", tr("tray.show"), true, None::<&str>)?;
            let run = MenuItem::with_id(app, "run", tr("tray.run"), true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", tr("tray.stop"), true, None::<&str>)?;
            let ac_toggle =
                MenuItem::with_id(app, "ac_toggle", tr("tray.acToggle"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", tr("tray.quit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &run, &stop, &ac_toggle, &quit])?;
            app.manage(TrayMenuItems {
                show: show.clone(),
                run: run.clone(),
                stop: stop.clone(),
                ac_toggle: ac_toggle.clone(),
                quit: quit.clone(),
            });

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("ASMacro")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "run" => {
                        let _ = app.emit("tray-action", "run");
                    }
                    "stop" => {
                        let _ = app.emit("tray-action", "stop");
                    }
                    "ac_toggle" => {
                        let _ = app.emit("tray-action", "autoclicker-toggle");
                    }
                    "quit" => {
                        autoclicker::stop_autoclicker();
                        input_state::release_all_inputs();
                        platform::hook().stop();
                        app.exit(0);
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            platform::hook().start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute_single_action,
            get_pixel_color,
            take_screenshot,
            find_color_on_screen,
            find_template_on_screen,
            get_mouse_pos,
            get_screen_size,
            run_program,
            switch_to_window,
            list_screens,
            pixel_changed,
            region_change_percent,
            set_execution_config,
            set_abort,
            set_macro_running,
            release_all_inputs,
            reset_vision_caches,
            start_autoclicker,
            stop_autoclicker,
            update_autoclicker_config,
            autoclicker_status,
            set_autoclicker_hotkey,
            set_macro_hotkeys,
            platform_capabilities,
            ocr_read_region,
            set_ui_language,
            i18n::user_locales,
            installer_language,
            system_language,
            updater_supported,
            take_pending_open,
            write_binary_file,
            read_binary_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
