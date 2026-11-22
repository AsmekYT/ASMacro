use crate::cli::Args;
use crate::engine::{detect, folders, fsutil, install};
use crate::plan::{InstallPlan, PlanScope};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use super::resolve_lang;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct UiState {
    pub(super) page: String,
    pub(super) steps: Vec<String>,
    pub(super) lang: String,
    pub(super) lang_choice: String,
    pub(super) scope: String,
    pub(super) dir: String,
    pub(super) default_dir_user: String,
    pub(super) default_dir_machine: String,
    pub(super) dir_valid: bool,
    pub(super) space_low: bool,
    pub(super) required_size: String,
    pub(super) free_space: String,
    pub(super) shortcut_desktop: bool,
    pub(super) shortcut_start_menu: bool,
    pub(super) assoc: bool,
    pub(super) autostart: bool,
    pub(super) is_update: bool,
    pub(super) is_repair: bool,
    pub(super) existing_is_ours: bool,
    pub(super) existing_version: Option<String>,
    pub(super) version: String,
    pub(super) reboot_required: bool,
    pub(super) scope_error: Option<String>,
}

pub(super) struct Controller {
    pub(super) page: String,
    pub(super) lang: String,
    pub(super) lang_choice: String,
    pub(super) scope: PlanScope,
    pub(super) dir: String,
    pub(super) dir_touched: bool,
    pub(super) shortcut_desktop: bool,
    pub(super) shortcut_start_menu: bool,
    pub(super) assoc: bool,
    pub(super) autostart: bool,
    pub(super) existing: Option<detect::Existing>,
    pub(super) already_installed: bool,
    pub(super) expanded: bool,
    pub(super) scope_error: Option<String>,
    pub(super) payload_size: u64,
    pub(super) version: String,
    pub(super) launch_after: bool,
    pub(super) args: Args,
    pub(super) finished_ok: bool,
    pub(super) self_test: bool,
    pub(super) self_test_install: bool,
    pub(super) autopilot_started: bool,
    pub(super) rendered_page: Option<String>,
    pub(super) saw_license: bool,
    pub(super) rendered_logo: bool,
}

pub(super) fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", bytes, UNITS[0])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

pub(super) fn dir_is_valid(dir: &str) -> bool {
    let p = Path::new(dir);
    if !p.is_absolute() {
        return false;
    }
    let s = dir.trim();
    if s.len() < 4 {
        return false;
    }
    p.parent().is_some()
}

impl Controller {
    pub(super) fn new(args: Args, payload_size: u64, version: String) -> Self {
        let existing = detect::find_existing();

        let lang_choice = args.lang.clone().unwrap_or_else(|| "auto".to_string());
        let lang = resolve_lang(&lang_choice);

        let scope = args
            .scope
            .map(Into::into)
            .or_else(|| existing.as_ref().map(|e| e.scope))
            .unwrap_or(PlanScope::User);

        let dir = args
            .dir
            .clone()
            .or_else(|| existing.as_ref().map(|e| e.path.clone()))
            .unwrap_or_else(|| {
                folders::default_install_dir(scope)
                    .to_string_lossy()
                    .to_string()
            });

        let (desktop, start_menu, assoc, autostart) = match existing.as_ref() {
            Some(e) if e.is_ours => (
                e.shortcut_desktop,
                e.shortcut_startmenu,
                e.assoc,
                e.autostart,
            ),
            _ => (true, true, true, false),
        };

        let already_installed = !args.self_test
            && !args.self_test_install
            && args.dir.is_none()
            && args.scope.is_none()
            && install::already_installed(existing.as_ref(), &version);

        Self {
            page: if already_installed {
                "installed"
            } else {
                "lang"
            }
            .to_string(),
            lang,
            lang_choice,
            scope,
            dir,
            dir_touched: args.dir.is_some(),
            shortcut_desktop: args.shortcut_desktop.unwrap_or(desktop),
            shortcut_start_menu: args.shortcut_startmenu.unwrap_or(start_menu),
            assoc: args.assoc.unwrap_or(assoc),
            autostart: args.autostart.unwrap_or(autostart),
            existing,
            already_installed,
            expanded: false,
            scope_error: None,
            payload_size,
            version,
            launch_after: true,
            self_test: args.self_test,
            self_test_install: args.self_test_install,
            autopilot_started: false,
            rendered_page: None,
            saw_license: false,
            rendered_logo: false,
            args,
            finished_ok: false,
        }
    }

    pub(super) fn is_update(&self) -> bool {
        self.existing.is_some()
    }

    pub(super) fn is_repair(&self) -> bool {
        self.existing.as_ref().is_some_and(|e| {
            e.is_ours
                && e.version
                    .as_deref()
                    .map(|v| detect::compare_versions(&self.version, v))
                    == Some(detect::VersionCompare::Same)
        })
    }

    pub(super) fn steps(&self) -> Vec<String> {
        if self.already_installed {
            return vec!["installed".to_string()];
        }
        let mut steps = vec!["lang".to_string()];
        if self.is_update() && !self.expanded {
            steps.push("upgrade".to_string());
        } else {
            if !self.is_update() {
                steps.push("license".to_string());
            }
            steps.push("scope".to_string());
            steps.push("options".to_string());
        }
        steps.push("progress".to_string());
        steps.push("done".to_string());
        steps
    }

    pub(super) fn state(&self) -> UiState {
        let required = self.payload_size;
        let free = fsutil::free_space_bytes(Path::new(&self.dir))
            .or_else(|| {
                let mut probe = PathBuf::from(&self.dir);
                while !probe.exists() {
                    match probe.parent() {
                        Some(p) if p != probe => probe = p.to_path_buf(),
                        _ => break,
                    }
                }
                fsutil::free_space_bytes(&probe)
            })
            .unwrap_or(u64::MAX);

        UiState {
            page: self.page.clone(),
            steps: self.steps(),
            lang: self.lang.clone(),
            lang_choice: self.lang_choice.clone(),
            scope: match self.scope {
                PlanScope::User => "user".into(),
                PlanScope::Machine => "machine".into(),
            },
            dir: self.dir.clone(),
            default_dir_user: folders::default_install_dir(PlanScope::User)
                .to_string_lossy()
                .to_string(),
            default_dir_machine: folders::default_install_dir(PlanScope::Machine)
                .to_string_lossy()
                .to_string(),
            dir_valid: dir_is_valid(&self.dir),
            space_low: free != u64::MAX && free < required,
            required_size: human_size(required),
            free_space: if free == u64::MAX {
                "—".to_string()
            } else {
                human_size(free)
            },
            shortcut_desktop: self.shortcut_desktop,
            shortcut_start_menu: self.shortcut_start_menu,
            assoc: self.assoc,
            autostart: self.autostart,
            is_update: self.is_update(),
            is_repair: self.is_repair(),
            existing_is_ours: self.existing.as_ref().map(|e| e.is_ours).unwrap_or(false),
            existing_version: self.existing.as_ref().and_then(|e| e.version.clone()),
            version: self.version.clone(),
            reboot_required: install::REBOOT_REQUIRED.load(Ordering::Relaxed),
            scope_error: self.scope_error.clone(),
        }
    }

    pub(super) fn plan(&self) -> InstallPlan {
        InstallPlan {
            scope: self.scope,
            dir: self.dir.clone(),
            lang: self.lang_choice.clone(),
            shortcut_desktop: self.shortcut_desktop,
            shortcut_startmenu: self.shortcut_start_menu,
            assoc: self.assoc,
            autostart: self.autostart,
            run_after: self.launch_after,
            update: self.is_update(),
            silent: false,
            version: self.version.clone(),
        }
    }

    pub(super) fn sync_dir_to_scope(&mut self) {
        if self.dir_touched {
            return;
        }
        if let Some(existing) = self.existing.as_ref() {
            if existing.scope == self.scope {
                self.dir = existing.path.clone();
                return;
            }
        }
        self.dir = folders::default_install_dir(self.scope)
            .to_string_lossy()
            .to_string();
    }

    pub(super) fn advance(&mut self) -> Option<&'static str> {
        let steps = self.steps();
        let idx = steps.iter().position(|s| *s == self.page)?;
        let next = steps.get(idx + 1)?;
        self.page = next.clone();
        if self.page == "progress" {
            return Some("start");
        }
        None
    }

    pub(super) fn go_back(&mut self) {
        let steps = self.steps();
        if let Some(idx) = steps.iter().position(|s| *s == self.page) {
            if idx > 0 {
                self.page = steps[idx - 1].clone();
            }
        }
    }
}
