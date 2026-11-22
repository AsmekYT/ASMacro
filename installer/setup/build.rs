fn main() {
    println!("cargo:rerun-if-changed=../../LICENSE");
    if let Ok(text) = std::fs::read_to_string("../../LICENSE") {
        let _ = std::fs::write("web/license.txt", text);
    }

    println!("cargo:rerun-if-changed=../../src-tauri/icons/128x128@2x.png");
    if let Ok(png) = std::fs::read("../../src-tauri/icons/128x128@2x.png") {
        let _ = std::fs::write("web/logo.png", png);
    }

    if std::env::var("CARGO_CFG_WINDOWS").is_err() {
        return;
    }
    println!("cargo:rerun-if-changed=setup.manifest");
    println!("cargo:rerun-if-changed=assets/icon.ico");

    let mut res = winresource::WindowsResource::new();
    res.set_manifest_file("setup.manifest");
    if std::path::Path::new("assets/icon.ico").exists() {
        res.set_icon("assets/icon.ico");
    }
    if let Err(e) = res.compile() {
        println!("cargo:warning=failed to embed Windows resources: {e}");
    }
}
