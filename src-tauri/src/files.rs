use std::path::PathBuf;

#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(PathBuf::from(path), data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(PathBuf::from(path)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod binary_file_tests {
    use super::*;

    #[test]
    fn write_then_read_roundtrip() {
        let path = std::env::temp_dir().join("asmacro_roundtrip_test.asmacro");
        let path_str = path.display().to_string();
        let data = vec![0x41u8, 0x53, 0x4d, 0x00, 0xff, 0x7f];

        write_binary_file(path_str.clone(), data.clone()).expect("write should succeed");
        let read_back = read_binary_file(path_str).expect("read should succeed");

        assert_eq!(data, read_back);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_missing_file_errors() {
        let path = std::env::temp_dir().join("asmacro_missing_file_test.asmacro");
        let _ = std::fs::remove_file(&path);
        assert!(read_binary_file(path.display().to_string()).is_err());
    }
}
