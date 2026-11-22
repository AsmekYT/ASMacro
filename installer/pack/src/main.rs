use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;

const MAGIC: &[u8; 8] = b"ASMPAY01";

struct Args {
    stub: PathBuf,
    out: PathBuf,
    adds: Vec<(String, PathBuf)>,
    level: i32,
}

fn parse_args() -> Result<Args, String> {
    let mut stub = None;
    let mut out = None;
    let mut adds = Vec::new();
    let mut level = 19;

    let mut it = env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--stub" => stub = Some(PathBuf::from(it.next().ok_or("--stub needs a path")?)),
            "--out" => out = Some(PathBuf::from(it.next().ok_or("--out needs a path")?)),
            "--level" => {
                level = it
                    .next()
                    .ok_or("--level needs a number")?
                    .parse()
                    .map_err(|_| "--level must be an integer")?
            }
            "--add" => {
                let spec = it.next().ok_or("--add needs NAME=PATH")?;
                let (name, path) = spec.split_once('=').ok_or("--add expects NAME=PATH")?;
                adds.push((name.to_string(), PathBuf::from(path)));
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Args {
        stub: stub.ok_or("--stub is required")?,
        out: out.ok_or("--out is required")?,
        adds,
        level,
    })
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    if args.adds.is_empty() {
        return Err("at least one --add NAME=PATH is required".into());
    }

    let mut tar_bytes = Vec::new();
    {
        let mut builder = tar::Builder::new(&mut tar_bytes);
        for (name, path) in &args.adds {
            let mut f = fs::File::open(path).map_err(|e| format!("open {path:?}: {e}"))?;
            builder
                .append_file(name, &mut f)
                .map_err(|e| format!("tar append {name}: {e}"))?;
        }
        builder.finish().map_err(|e| e.to_string())?;
    }
    let raw_len = tar_bytes.len() as u64;

    let blob = zstd::encode_all(tar_bytes.as_slice(), args.level).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let digest = hasher.finalize();

    let stub_bytes = fs::read(&args.stub).map_err(|e| format!("read stub: {e}"))?;
    let blob_off = stub_bytes.len() as u64;
    let blob_len = blob.len() as u64;

    let mut out = fs::File::create(&args.out).map_err(|e| format!("create out: {e}"))?;
    out.write_all(&stub_bytes).map_err(|e| e.to_string())?;
    out.write_all(&blob).map_err(|e| e.to_string())?;
    out.write_all(MAGIC).map_err(|e| e.to_string())?;
    out.write_all(&blob_off.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&blob_len.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&raw_len.to_le_bytes())
        .map_err(|e| e.to_string())?;
    out.write_all(&digest).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&args.out)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&args.out, perms).map_err(|e| e.to_string())?;
    }

    eprintln!(
        "asm-pack: wrote {} ({} files, raw {raw_len}B, compressed {blob_len}B)",
        args.out.display(),
        args.adds.len()
    );
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("asm-pack: error: {e}");
            ExitCode::FAILURE
        }
    }
}
