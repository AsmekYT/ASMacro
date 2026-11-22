use std::sync::OnceLock;
use x11rb::connection::Connection;
use x11rb::protocol::randr::ConnectionExt as _;
use x11rb::protocol::xproto::Screen;
use x11rb::rust_connection::RustConnection;

pub struct X11 {
    pub conn: RustConnection,
    pub screen_num: usize,
}

impl X11 {
    pub fn root_screen(&self) -> &Screen {
        &self.conn.setup().roots[self.screen_num]
    }
}

static X11_CONN: OnceLock<Option<X11>> = OnceLock::new();

pub fn x11() -> Option<&'static X11> {
    X11_CONN
        .get_or_init(|| {
            let (conn, screen_num) = x11rb::connect(None).ok()?;
            let _ = conn.randr_query_version(1, 5);
            Some(X11 { conn, screen_num })
        })
        .as_ref()
}
