use std::fs;
use std::path::Path;
use trash;

#[tauri::command]
pub fn delete_item(path: String, permanent: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if permanent {
        if p.is_dir() {
            fs::remove_dir_all(p).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    } else {
        trash::delete(p).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub fn delete_items(paths: Vec<String>, permanent: bool) -> Result<Vec<String>, String> {
    let mut failed = Vec::new();
    for path in paths {
        if let Err(_) = delete_item(path.clone(), permanent) {
            failed.push(path);
        }
    }
    Ok(failed)
}
