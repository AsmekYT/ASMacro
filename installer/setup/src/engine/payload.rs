use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};

const MAGIC: &[u8; 8] = b"ASMPAY01";
const FOOTER_LEN: u64 = 8 + 8 + 8 + 8 + 32;

pub struct Payload {
    pub files: HashMap<String, Vec<u8>>,
}

pub fn read_from_current_exe() -> Result<Option<Payload>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut f = std::fs::File::open(&exe).map_err(|e| e.to_string())?;
    let file_len = f.metadata().map_err(|e| e.to_string())?.len();
    if file_len < FOOTER_LEN {
        return Ok(None);
    }

    f.seek(SeekFrom::End(-(FOOTER_LEN as i64)))
        .map_err(|e| e.to_string())?;
    let mut footer = vec![0u8; FOOTER_LEN as usize];
    f.read_exact(&mut footer).map_err(|e| e.to_string())?;

    if &footer[0..8] != MAGIC {
        return Ok(None);
    }
    let blob_off = u64::from_le_bytes(footer[8..16].try_into().unwrap());
    let blob_len = u64::from_le_bytes(footer[16..24].try_into().unwrap());
    let _raw_len = u64::from_le_bytes(footer[24..32].try_into().unwrap());
    let expected_sha: [u8; 32] = footer[32..64].try_into().unwrap();

    if blob_off + blob_len + FOOTER_LEN > file_len {
        return Err("E_NO_PAYLOAD: overlay bounds exceed file size".into());
    }

    f.seek(SeekFrom::Start(blob_off))
        .map_err(|e| e.to_string())?;
    let mut blob = vec![0u8; blob_len as usize];
    f.read_exact(&mut blob).map_err(|e| e.to_string())?;

    let mut hasher = Sha256::new();
    hasher.update(&blob);
    if hasher.finalize().as_slice() != expected_sha {
        return Err("E_NO_PAYLOAD: overlay checksum mismatch, re-download the installer".into());
    }

    let tar_bytes = zstd::decode_all(blob.as_slice()).map_err(|e| e.to_string())?;
    let mut archive = tar::Archive::new(tar_bytes.as_slice());
    let mut files = HashMap::new();
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let name = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        files.insert(name, buf);
    }

    Ok(Some(Payload { files }))
}

pub fn has_payload() -> bool {
    matches!(read_from_current_exe(), Ok(Some(_)))
}

pub fn installed_size() -> Option<u64> {
    let exe = std::env::current_exe().ok()?;
    let mut f = std::fs::File::open(&exe).ok()?;
    let file_len = f.metadata().ok()?.len();
    if file_len < FOOTER_LEN {
        return None;
    }
    f.seek(SeekFrom::End(-(FOOTER_LEN as i64))).ok()?;
    let mut footer = vec![0u8; FOOTER_LEN as usize];
    f.read_exact(&mut footer).ok()?;
    if &footer[0..8] != MAGIC {
        return None;
    }
    Some(u64::from_le_bytes(footer[24..32].try_into().ok()?))
}
