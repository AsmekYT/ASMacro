use crate::platform::{Frame, Freshness, ScreenInfo};
use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
use ashpd::desktop::PersistMode;
use ashpd::WindowIdentifier;
use std::path::PathBuf;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

struct StreamInfo {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

struct SharedState {
    frame: Mutex<Option<(u64, Frame)>>,
    cv: Condvar,
    streams: Mutex<Vec<StreamInfo>>,
}

static STATE: OnceLock<SharedState> = OnceLock::new();

static STARTED: OnceLock<AsyncMutex<bool>> = OnceLock::new();

fn state() -> &'static SharedState {
    STATE.get_or_init(|| SharedState {
        frame: Mutex::new(None),
        cv: Condvar::new(),
        streams: Mutex::new(Vec::new()),
    })
}

fn token_path() -> PathBuf {
    dirs_next_config_dir().join("asmacro-portal-restore-token")
}

fn dirs_next_config_dir() -> PathBuf {
    if let Some(x) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(x);
    }
    let home = std::env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join(".config")
}

async fn ensure_session_started() -> Result<(), String> {
    let mut started = STARTED.get_or_init(|| AsyncMutex::new(false)).lock().await;
    if *started {
        return Ok(());
    }

    let proxy = Screencast::new().await.map_err(|e| e.to_string())?;
    let session = proxy.create_session().await.map_err(|e| e.to_string())?;

    let restore_token = std::fs::read_to_string(token_path()).ok();

    proxy
        .select_sources(
            &session,
            CursorMode::Hidden,
            SourceType::Monitor.into(),
            true,
            restore_token.as_deref(),
            PersistMode::ExplicitlyRevoked,
        )
        .await
        .map_err(|e| e.to_string())?;

    let response = proxy
        .start(&session, &WindowIdentifier::default())
        .await
        .map_err(|e| e.to_string())?
        .response()
        .map_err(|e| e.to_string())?;

    if let Some(new_token) = response.restore_token() {
        let _ = std::fs::create_dir_all(token_path().parent().unwrap());
        let _ = std::fs::write(token_path(), new_token);
    }

    {
        let mut streams = state().streams.lock().unwrap_or_else(|e| e.into_inner());
        streams.clear();
        for s in response.streams() {
            let (x, y) = s.position().unwrap_or((0, 0));
            let (w, h) = s.size().unwrap_or((1920, 1080));
            streams.push(StreamInfo {
                x,
                y,
                w: w as u32,
                h: h as u32,
            });
        }
    }

    let pw_fd = proxy
        .open_pipe_wire_remote(&session)
        .await
        .map_err(|e| e.to_string())?;
    spawn_pipewire_thread(
        pw_fd,
        response
            .streams()
            .iter()
            .map(|s| s.pipe_wire_node_id())
            .collect(),
    );

    *started = true;
    Ok(())
}

fn spawn_pipewire_thread(pw_fd: std::os::fd::OwnedFd, node_ids: Vec<u32>) {
    std::thread::spawn(move || {
        let _ = pw_fd;
        for _node_id in node_ids {}
    });
}

fn wait_for_frame(fresh: Freshness) -> Result<(u64, Frame), String> {
    let Freshness::Latest = fresh;
    let guard = state().frame.lock().unwrap_or_else(|e| e.into_inner());
    let (guard, timed_out) = state()
        .cv
        .wait_timeout_while(guard, Duration::from_millis(500), |f| f.is_none())
        .unwrap_or_else(|e| e.into_inner());
    if timed_out.timed_out() && guard.is_none() {
        return Err("No frame captured yet — is the PipeWire stream connected?".into());
    }
    guard
        .clone_frame()
        .ok_or_else(|| "No frame available".to_string())
}

trait CloneFrame {
    fn clone_frame(&self) -> Option<(u64, Frame)>;
}
impl CloneFrame for Option<(u64, Frame)> {
    fn clone_frame(&self) -> Option<(u64, Frame)> {
        self.as_ref().map(|(seq, f)| {
            (
                *seq,
                Frame {
                    w: f.w,
                    h: f.h,
                    rgba: f.rgba.clone(),
                },
            )
        })
    }
}

fn run_async<F: std::future::Future>(fut: F) -> F::Output {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    let rt = RT.get_or_init(|| {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to start tokio runtime for the portal client")
    });
    rt.block_on(fut)
}

pub fn screens() -> Result<Vec<ScreenInfo>, String> {
    run_async(ensure_session_started())?;
    let streams = state().streams.lock().unwrap_or_else(|e| e.into_inner());
    if streams.is_empty() {
        return Err("No monitors granted by the screen-capture portal yet".into());
    }
    Ok(streams
        .iter()
        .enumerate()
        .map(|(i, s)| ScreenInfo {
            index: i,
            x: s.x,
            y: s.y,
            w: s.w,
            h: s.h,
            is_primary: i == 0,
            name: None,
        })
        .collect())
}

pub fn capture_region(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    fresh: Freshness,
) -> Result<(Frame, i32, i32), String> {
    run_async(ensure_session_started())?;
    let (_, frame) = wait_for_frame(fresh)?;

    let cw = w.min(frame.w.saturating_sub(x.max(0) as u32));
    let ch = h.min(frame.h.saturating_sub(y.max(0) as u32));
    if cw == 0 || ch == 0 {
        return Err("Region outside captured frame bounds".into());
    }
    let mut rgba = vec![0u8; (cw * ch * 4) as usize];
    for row in 0..ch {
        let src_start = (((y.max(0) as u32 + row) * frame.w + x.max(0) as u32) * 4) as usize;
        let dst_start = (row * cw * 4) as usize;
        rgba[dst_start..dst_start + (cw * 4) as usize]
            .copy_from_slice(&frame.rgba[src_start..src_start + (cw * 4) as usize]);
    }
    Ok((Frame { w: cw, h: ch, rgba }, x, y))
}

pub fn capture_screen(idx: usize) -> Result<Frame, String> {
    let screens = screens()?;
    let s = screens.get(idx).ok_or("Screen index out of range")?;
    let (frame, _, _) = capture_region(s.x, s.y, s.w, s.h, Freshness::Latest)?;
    Ok(frame)
}
