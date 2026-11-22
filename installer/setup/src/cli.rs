#[derive(Debug, Default, Clone)]
pub struct Args {
    pub silent: bool,
    pub passive: bool,
    pub run_after: bool,
    pub update: bool,
    pub no_shortcuts: bool,
    pub dir: Option<String>,
    pub args_passthrough: Option<String>,

    pub scope: Option<Scope>,
    pub lang: Option<String>,
    pub shortcut_desktop: Option<bool>,
    pub shortcut_startmenu: Option<bool>,
    pub assoc: Option<bool>,
    pub autostart: Option<bool>,
    pub no_webview2_bootstrap: bool,
    pub log: Option<String>,
    pub version: bool,
    pub help: bool,

    pub uninstall: bool,
    pub purge: bool,
    pub finalize_remove: Option<String>,
    pub wait_pid: Option<u32>,

    pub elevated_worker: bool,
    pub pipe: Option<String>,
    pub self_test: bool,
    pub self_test_install: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    User,
    Machine,
}

impl std::fmt::Display for Scope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Scope::User => "user",
            Scope::Machine => "machine",
        })
    }
}

impl std::str::FromStr for Scope {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "user" => Ok(Scope::User),
            "machine" => Ok(Scope::Machine),
            other => Err(format!("invalid scope: {other}")),
        }
    }
}

fn parse_bool_flag(v: Option<&str>) -> bool {
    !matches!(v, Some("0"))
}

fn tokenize(s: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = s.chars().peekable();
    loop {
        while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
            chars.next();
        }
        if chars.peek().is_none() {
            break;
        }
        let mut tok = String::new();
        let mut in_quotes = false;
        while let Some(&c) = chars.peek() {
            if c == '"' {
                in_quotes = !in_quotes;
                chars.next();
            } else if c.is_whitespace() && !in_quotes {
                break;
            } else {
                tok.push(c);
                chars.next();
            }
        }
        tokens.push(tok);
    }
    tokens
}

pub fn parse(rest: &str) -> Args {
    let mut args = Args::default();

    let lower = rest.to_ascii_lowercase();
    if let Some(pos) = find_flag_prefix(&lower, "/d=") {
        args.dir = Some(rest[pos + 3..].trim().to_string());
        parse_tokens(&tokenize(&rest[..pos]), &mut args);
        return args;
    }
    if let Some(pos) = find_flag_prefix(&lower, "/args") {
        let after = &rest[pos + 5..];
        args.args_passthrough = Some(after.trim_start().to_string());
        parse_tokens(&tokenize(&rest[..pos]), &mut args);
        return args;
    }

    parse_tokens(&tokenize(rest), &mut args);
    args
}

fn find_flag_prefix(haystack: &str, needle: &str) -> Option<usize> {
    let mut start = 0;
    while let Some(rel) = haystack[start..].find(needle) {
        let pos = start + rel;
        let at_boundary = pos == 0 || haystack.as_bytes()[pos - 1].is_ascii_whitespace();
        if at_boundary {
            return Some(pos);
        }
        start = pos + 1;
    }
    None
}

fn parse_tokens(tokens: &[String], args: &mut Args) {
    let mut i = 0;
    while i < tokens.len() {
        let t = tokens[i].as_str();
        let tl = t.to_ascii_lowercase();
        match tl.as_str() {
            "/s" => args.silent = true,
            "/p" => args.passive = true,
            "/r" => args.run_after = true,
            "/update" => args.update = true,
            "/ns" => args.no_shortcuts = true,
            "--no-webview2-bootstrap" => args.no_webview2_bootstrap = true,
            "--version" => args.version = true,
            "--help" | "-h" | "/?" => args.help = true,
            "--uninstall" => args.uninstall = true,
            "--purge" => args.purge = true,
            "--elevated-worker" => args.elevated_worker = true,
            "--self-test" => args.self_test = true,
            "--self-test-install" => args.self_test_install = true,
            _ => {
                if let Some(v) = t.strip_prefix("--scope=") {
                    args.scope = v.parse().ok();
                } else if let Some(v) = t.strip_prefix("--dir=") {
                    args.dir = Some(v.to_string());
                } else if let Some(v) = t.strip_prefix("--lang=") {
                    args.lang = Some(v.to_string());
                } else if let Some(v) = t.strip_prefix("--shortcut-desktop") {
                    args.shortcut_desktop = Some(parse_bool_flag(v.strip_prefix('=')));
                } else if let Some(v) = t.strip_prefix("--shortcut-startmenu") {
                    args.shortcut_startmenu = Some(parse_bool_flag(v.strip_prefix('=')));
                } else if let Some(v) = t.strip_prefix("--assoc") {
                    args.assoc = Some(parse_bool_flag(v.strip_prefix('=')));
                } else if let Some(v) = t.strip_prefix("--autostart") {
                    args.autostart = Some(parse_bool_flag(v.strip_prefix('=')));
                } else if let Some(v) = t.strip_prefix("--log=") {
                    args.log = Some(v.to_string());
                } else if let Some(v) = t.strip_prefix("--finalize-remove=") {
                    args.finalize_remove = Some(v.to_string());
                } else if let Some(v) = t.strip_prefix("--wait-pid=") {
                    args.wait_pid = v.parse().ok();
                } else if let Some(v) = t.strip_prefix("--pipe=") {
                    args.pipe = Some(v.to_string());
                }
            }
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nsis_update_flags() {
        let a = parse("/P /R /UPDATE /ARGS --open C:\\some file.asmacro");
        assert!(a.passive && a.run_after && a.update);
        assert_eq!(
            a.args_passthrough.as_deref(),
            Some("--open C:\\some file.asmacro")
        );
    }

    #[test]
    fn silent_with_dir() {
        let a = parse("/S --scope=user /D=C:\\Program Files\\ASMacro");
        assert!(a.silent);
        assert_eq!(a.scope, Some(Scope::User));
        assert_eq!(a.dir.as_deref(), Some("C:\\Program Files\\ASMacro"));
    }

    #[test]
    fn long_flags() {
        let a = parse("--scope=machine --assoc=0 --autostart --lang=pl");
        assert_eq!(a.scope, Some(Scope::Machine));
        assert_eq!(a.assoc, Some(false));
        assert_eq!(a.autostart, Some(true));
        assert_eq!(a.lang.as_deref(), Some("pl"));
    }
}
