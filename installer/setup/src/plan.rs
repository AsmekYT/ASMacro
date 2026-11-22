use crate::cli::Scope;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallPlan {
    pub scope: PlanScope,
    pub dir: String,
    pub lang: String,
    pub shortcut_desktop: bool,
    pub shortcut_startmenu: bool,
    pub assoc: bool,
    pub autostart: bool,
    pub run_after: bool,
    pub update: bool,
    pub silent: bool,
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlanScope {
    User,
    Machine,
}

impl From<Scope> for PlanScope {
    fn from(s: Scope) -> Self {
        match s {
            Scope::User => PlanScope::User,
            Scope::Machine => PlanScope::Machine,
        }
    }
}
