use super::registry;
use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

const CLIENT_KEY_WOW64: &str =
    r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const CLIENT_KEY: &str =
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
const BOOTSTRAPPER_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

pub fn is_installed() -> bool {
    for (root, key) in [
        (HKEY_LOCAL_MACHINE, CLIENT_KEY_WOW64),
        (HKEY_LOCAL_MACHINE, CLIENT_KEY),
        (HKEY_CURRENT_USER, CLIENT_KEY),
    ] {
        if let Some(pv) = registry::read_string(root, key, "pv") {
            if !pv.is_empty() && pv != "0.0.0.0" {
                return true;
            }
        }
    }
    false
}

pub fn bootstrap(progress: &mut dyn FnMut(u32, &str)) -> Result<(), String> {
    let installer = std::env::temp_dir().join("MicrosoftEdgeWebview2Setup.exe");

    progress(10, "webview2.download");
    let status = std::process::Command::new("curl.exe")
        .args(["-L", "-sS", "--fail", "-o"])
        .arg(&installer)
        .arg(BOOTSTRAPPER_URL)
        .status()
        .map_err(|e| format!("E_WEBVIEW2_DOWNLOAD: spawn curl.exe: {e}"))?;
    if !status.success() {
        return Err(format!(
            "E_WEBVIEW2_DOWNLOAD: curl.exe exited with {:?}",
            status.code()
        ));
    }

    progress(60, "webview2.install");
    let status = std::process::Command::new(&installer)
        .args(["/silent", "/install"])
        .status()
        .map_err(|e| format!("E_WEBVIEW2_INSTALL: spawn bootstrapper: {e}"))?;
    let _ = std::fs::remove_file(&installer);
    if !status.success() {
        return Err(format!(
            "E_WEBVIEW2_INSTALL: bootstrapper exited with {:?}",
            status.code()
        ));
    }

    progress(90, "webview2.verify");
    if is_installed() {
        Ok(())
    } else {
        Err("E_WEBVIEW2_MISSING: still not detected after install".to_string())
    }
}
