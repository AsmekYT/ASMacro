use include_dir::{include_dir, Dir};

static WEB: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/web");

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        _ => "text/plain; charset=utf-8",
    }
}

pub fn resolve(uri: &str) -> Option<(&'static str, Vec<u8>)> {
    let rest = uri.split_once("://").map(|(_, r)| r).unwrap_or(uri);
    let rest = rest.split('?').next().unwrap_or(rest);
    let rest = rest.split('#').next().unwrap_or(rest);
    let path = rest.split_once('/').map(|(_, p)| p).unwrap_or("");
    let path = path.trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if path.contains("..") {
        return None;
    }

    WEB.get_file(path)
        .map(|f| (mime_for(path), f.contents().to_vec()))
}
