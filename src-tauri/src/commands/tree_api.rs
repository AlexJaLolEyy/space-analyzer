use crate::errors::AppError;
use crate::models::file::FileCategory;
use crate::models::flat_scan::ScanArena;
use crate::models::scan::ScanNode;
use crate::scan_session::ScanSession;
use memchr::memmem;
use rayon::prelude::*;
use serde::Serialize;
use std::io::{BufWriter, Write};
use tauri::command;
use tauri::State;

#[derive(Serialize)]
pub struct CategoryBreakdownEntry {
    pub category: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct BlackHoleEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub depth: u32,
}

#[derive(Serialize)]
pub struct NamedSize {
    pub category: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct DashboardStats {
    pub top_categories: Vec<NamedSize>,
    pub largest_file: Option<ScanNode>,
    pub top_dirs: Vec<ScanNode>,
    pub total_file_count: u64,
    pub total_size: u64,
}

#[derive(Serialize)]
pub struct SearchHit {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub category: FileCategory,
    pub file_count: u64,
    pub last_modified: Option<u64>,
    pub protected: bool,
}

#[command]
pub fn get_children(
    session: State<'_, ScanSession>,
    path: String,
    child_depth: Option<u32>,
) -> Result<Vec<ScanNode>, AppError> {
    let cd = child_depth.unwrap_or(1).max(1);
    session.with_arena(|arena| arena.children_as_scan(&path, cd))
}

#[command]
pub fn get_node_info(session: State<'_, ScanSession>, path: String) -> Result<ScanNode, AppError> {
    session.with_arena(|arena| arena.get_node_info(&path))
}

#[command]
pub fn search_nodes(
    session: State<'_, ScanSession>,
    query: String,
    max_results: Option<u32>,
) -> Result<Vec<SearchHit>, AppError> {
    let max_r = max_results.unwrap_or(500).clamp(1, 10_000) as usize;
    if query.is_empty() {
        return Ok(vec![]);
    }
    let q_lower = query.to_lowercase();
    let needle = q_lower.as_bytes();

    session.with_arena(|a| {
        let root = a.root_id();
        let mut ids: Vec<u32> = (0..a.len() as u32)
            .into_par_iter()
            .filter(|&id| {
                if id == root || !a.is_used(id) {
                    return false;
                }
                let lower = a.name(id).to_lowercase();
                memmem::find(lower.as_bytes(), needle).is_some()
            })
            .collect();
        if ids.len() > max_r {
            ids.select_nth_unstable_by(max_r - 1, |&x, &y| a.size(y).cmp(&a.size(x)));
            ids.truncate(max_r);
        }
        ids.sort_unstable_by(|&x, &y| a.size(y).cmp(&a.size(x)));
        Ok(ids
            .into_iter()
            .map(|id| SearchHit {
                name: a.name(id).to_string(),
                path: a.full_path(id),
                size: a.size(id),
                is_dir: a.is_dir(id),
                category: a.category(id),
                file_count: a.file_count(id),
                last_modified: a.mtime(id),
                protected: a.is_protected(id),
            })
            .collect())
    })
}

fn top_file_ids(a: &ScanArena, take: usize) -> Vec<u32> {
    let mut files: Vec<u32> = (0..a.len() as u32)
        .into_par_iter()
        .filter(|&id| a.is_used(id) && !a.is_dir(id) && a.size(id) > 0)
        .collect();
    if files.len() > take && take > 0 {
        files.select_nth_unstable_by(take - 1, |&x, &y| a.size(y).cmp(&a.size(x)));
        files.truncate(take);
    }
    files.sort_unstable_by(|&x, &y| a.size(y).cmp(&a.size(x)));
    files
}

#[command]
pub fn get_top_files(session: State<'_, ScanSession>, n: Option<u32>) -> Result<Vec<ScanNode>, AppError> {
    let take = n.unwrap_or(100).clamp(1, 10_000) as usize;
    session.with_arena(|a| Ok(top_file_ids(a, take).into_iter().map(|id| a.node_to_scan(id, 0)).collect()))
}

#[command]
pub fn get_category_breakdown(
    session: State<'_, ScanSession>,
    _path: String,
) -> Result<Vec<CategoryBreakdownEntry>, AppError> {
    session.with_arena(|a| {
        let mut v: Vec<CategoryBreakdownEntry> = FileCategory::ALL
            .iter()
            .zip(a.cat_totals().iter())
            .filter(|(_, &s)| s > 0)
            .map(|(c, &s)| CategoryBreakdownEntry {
                category: c.name().to_string(),
                size: s,
            })
            .collect();
        v.sort_by(|x, y| y.size.cmp(&x.size));
        Ok(v)
    })
}

#[command]
pub fn get_black_holes(
    session: State<'_, ScanSession>,
    limit: Option<u32>,
) -> Result<Vec<BlackHoleEntry>, AppError> {
    let lim = limit.unwrap_or(50).min(500) as usize;
    const MIN_SIZE: u64 = 1024 * 1024 * 1024;
    session.with_arena(|a| {
        let mut holes: Vec<(u32, u32)> = Vec::new();
        let mut stack = vec![(a.root_id(), 0u32)];
        while let Some((id, d)) = stack.pop() {
            if a.is_dir(id) && a.size(id) > MIN_SIZE {
                if d > 3 {
                    holes.push((id, d));
                }
                for c in a.live_children(id) {
                    if a.is_dir(c) && a.size(c) > MIN_SIZE {
                        stack.push((c, d + 1));
                    }
                }
            }
        }
        holes.sort_by(|x, y| (a.size(y.0) * y.1 as u64).cmp(&(a.size(x.0) * x.1 as u64)));
        holes.truncate(lim);
        Ok(holes
            .into_iter()
            .map(|(id, depth)| BlackHoleEntry {
                name: a.name(id).to_string(),
                path: a.full_path(id),
                size: a.size(id),
                depth,
            })
            .collect())
    })
}

#[command]
pub fn get_dashboard_stats(session: State<'_, ScanSession>) -> Result<DashboardStats, AppError> {
    session.with_arena(|a| {
        let mut top_categories: Vec<NamedSize> = FileCategory::ALL
            .iter()
            .zip(a.cat_totals().iter())
            .filter(|(_, &s)| s > 0)
            .map(|(c, &s)| NamedSize {
                category: c.name().to_string(),
                size: s,
            })
            .collect();
        top_categories.sort_by(|x, y| y.size.cmp(&x.size));
        top_categories.truncate(5);

        let largest_file = top_file_ids(a, 1).first().map(|&id| a.node_to_scan(id, 0));
        let top_dirs: Vec<ScanNode> = a
            .live_children(a.root_id())
            .filter(|&c| a.is_dir(c))
            .take(3)
            .map(|id| a.node_to_scan(id, 0))
            .collect();

        Ok(DashboardStats {
            top_categories,
            largest_file,
            top_dirs,
            total_file_count: a.total_files(),
            total_size: a.total_size(),
        })
    })
}

/// Full subtree for small exports (selection). Large exports use `export_scan`.
#[command]
pub fn get_export_subtree(session: State<'_, ScanSession>, path: String) -> Result<ScanNode, AppError> {
    session.with_arena(|a| {
        let id = a.resolve_path(&path)?;
        Ok(a.subtree_full(id))
    })
}

#[derive(Serialize)]
pub struct CleanupFile {
    pub path: String,
    pub size: u64,
    pub name: String,
}

#[derive(Serialize, Default)]
pub struct CleanupCandidates {
    pub temp: Vec<CleanupFile>,
    pub cache: Vec<CleanupFile>,
    pub downloads: Vec<CleanupFile>,
}

/// Scans the whole arena (not just the folders loaded in the UI) for well-known cleanup locations.
/// Only files directly inside the matched folders are returned.
#[command]
pub fn get_cleanup_candidates(session: State<'_, ScanSession>) -> Result<CleanupCandidates, AppError> {
    const MAX_PER_BUCKET: usize = 20_000;
    session.with_arena(|a| {
        #[derive(Clone, Copy, PartialEq)]
        enum Bucket {
            Temp,
            Cache,
            Downloads,
        }
        let eq = |id: u32, s: &str| a.name(id).eq_ignore_ascii_case(s);

        let dirs: Vec<(u32, Bucket)> = (0..a.len() as u32)
            .into_par_iter()
            .filter_map(|id| {
                if !a.is_used(id) || !a.is_dir(id) || a.is_protected(id) {
                    return None;
                }
                let parent = a.parent_of(id);
                if eq(id, "temp") || eq(id, "tmp") {
                    return Some((id, Bucket::Temp));
                }
                if eq(id, ".cache") || eq(id, ".npm") {
                    return Some((id, Bucket::Cache));
                }
                if eq(id, "downloads") {
                    return Some((id, Bucket::Downloads));
                }
                if eq(id, "cache") && parent != crate::scan::NONE && eq(parent, "default") {
                    let gp = a.parent_of(parent);
                    if gp != crate::scan::NONE && eq(gp, "user data") {
                        return Some((id, Bucket::Cache));
                    }
                }
                None
            })
            .collect();

        let mut out = CleanupCandidates::default();
        for (dir, bucket) in dirs {
            let target = match bucket {
                Bucket::Temp => &mut out.temp,
                Bucket::Cache => &mut out.cache,
                Bucket::Downloads => &mut out.downloads,
            };
            for c in a.live_children(dir) {
                if !a.is_dir(c) && !a.is_protected(c) {
                    target.push(CleanupFile {
                        path: a.full_path(c),
                        size: a.size(c),
                        name: a.name(c).to_string(),
                    });
                }
            }
        }
        for v in [&mut out.temp, &mut out.cache, &mut out.downloads] {
            v.sort_by(|x, y| y.size.cmp(&x.size));
            v.truncate(MAX_PER_BUCKET);
        }
        Ok(out)
    })
}

fn csv_escape(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

fn write_csv_node<W: Write>(a: &ScanArena, w: &mut W, id: u32, path: &str) -> std::io::Result<()> {
    writeln!(
        w,
        "{},{},{},{},{},{},{}",
        csv_escape(&a.display_name(id)),
        csv_escape(path),
        a.size(id),
        if a.is_dir(id) { "dir" } else { "file" },
        a.category(id).name(),
        a.file_count(id),
        a.mtime(id).map(|m| m.to_string()).unwrap_or_default()
    )?;
    if a.is_dir(id) {
        for c in a.live_children(id) {
            let mut p = path.to_string();
            if !p.ends_with('\\') {
                p.push('\\');
            }
            p.push_str(a.name(c));
            write_csv_node(a, w, c, &p)?;
        }
    }
    Ok(())
}

fn write_json_node<W: Write>(a: &ScanArena, w: &mut W, id: u32, path: &str) -> std::io::Result<()> {
    let js = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string());
    write!(
        w,
        "{{\"name\":{},\"path\":{},\"size\":{},\"is_dir\":{},\"file_count\":{},\"category\":\"{}\",\"last_modified\":{},\"protected\":{},\"children\":[",
        js(&a.display_name(id)),
        js(path),
        a.size(id),
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
            let mut p = path.to_string();
            if !p.ends_with('\\') {
                p.push('\\');
            }
            p.push_str(a.name(c));
            write_json_node(a, w, c, &p)?;
        }
    }
    write!(w, "]}}")
}

/// Streams the subtree at `path` straight to `dest` (format: "json" or "csv").
#[command]
pub fn export_scan(
    session: State<'_, ScanSession>,
    path: String,
    dest: String,
    format: String,
) -> Result<u64, AppError> {
    session.with_arena(|a| {
        let id = a.resolve_path(&path)?;
        let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut w = BufWriter::with_capacity(1 << 20, file);
        let full = a.full_path(id);
        let res = match format.as_str() {
            "csv" => {
                writeln!(w, "Name,Path,Size,Type,Category,FileCount,LastModified")
                    .and_then(|_| write_csv_node(a, &mut w, id, &full))
            }
            _ => write_json_node(a, &mut w, id, &full),
        };
        res.and_then(|_| w.flush()).map_err(|e| e.to_string())?;
        Ok(a.file_count(id))
    })
}
