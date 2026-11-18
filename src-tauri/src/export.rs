//! CSV / JSON export of a scanned subtree, shared by the app, the headless mode and the CLI.

use crate::models::flat_scan::ScanArena;
use std::io::{BufWriter, Write};
use std::path::Path;

fn csv_escape(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn child_path(base: &str, name: &str) -> String {
    let mut p = String::with_capacity(base.len() + name.len() + 1);
    p.push_str(base);
    if !p.ends_with('\\') {
        p.push('\\');
    }
    p.push_str(name);
    p
}

pub fn write_csv<W: Write>(a: &ScanArena, w: &mut W, id: u32) -> std::io::Result<()> {
    writeln!(w, "Name,Path,Size,SizeOnDisk,Type,Category,FileCount,LastModified")?;
    write_csv_node(a, w, id, &a.full_path(id))
}

fn write_csv_node<W: Write>(a: &ScanArena, w: &mut W, id: u32, path: &str) -> std::io::Result<()> {
    writeln!(
        w,
        "{},{},{},{},{},{},{},{}",
        csv_escape(&a.display_name(id)),
        csv_escape(path),
        a.size(id),
        a.alloc_size(id),
        if a.is_dir(id) { "dir" } else { "file" },
        a.category(id).name(),
        a.file_count(id),
        a.mtime(id).map(|m| m.to_string()).unwrap_or_default()
    )?;
    if a.is_dir(id) {
        for c in a.live_children(id) {
            write_csv_node(a, w, c, &child_path(path, a.name(c)))?;
        }
    }
    Ok(())
}

pub fn write_json<W: Write>(a: &ScanArena, w: &mut W, id: u32) -> std::io::Result<()> {
    write_json_node(a, w, id, &a.full_path(id))
}

fn write_json_node<W: Write>(a: &ScanArena, w: &mut W, id: u32, path: &str) -> std::io::Result<()> {
    let js = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string());
    write!(
        w,
        "{{\"name\":{},\"path\":{},\"size\":{},\"alloc\":{},\"is_dir\":{},\"file_count\":{},\"category\":\"{}\",\"last_modified\":{},\"protected\":{},\"children\":[",
        js(&a.display_name(id)),
        js(path),
        a.size(id),
        a.alloc_size(id),
        a.is_dir(id),
        a.file_count(id),
        a.category(id).name(),
        a.mtime(id).map(|m| m.to_string()).unwrap_or_else(|| "null".to_string()),
        a.is_protected(id)
    )?;
    if a.is_dir(id) {
        let mut first = true;
        for c in a.live_children(id) {
            if !first {
                write!(w, ",")?;
            }
            first = false;
            write_json_node(a, w, c, &child_path(path, a.name(c)))?;
        }
    }
    write!(w, "]}}")
}

/// Streams the subtree at `id` to `dest` (`"csv"` or anything else for JSON). Returns the
/// number of files in the subtree.
pub fn write_file(a: &ScanArena, id: u32, dest: &Path, format: &str) -> std::io::Result<u64> {
    let file = std::fs::File::create(dest)?;
    let mut w = BufWriter::with_capacity(1 << 20, file);
    match format {
        "csv" => write_csv(a, &mut w, id)?,
        _ => write_json(a, &mut w, id)?,
    }
    w.flush()?;
    Ok(a.file_count(id))
}
