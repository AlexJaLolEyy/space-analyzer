use crate::errors::AppError;
use crate::models::file::FileCategory;
use crate::models::flat_scan::ScanArena;
use crate::models::scan::ScanNode;
use crate::scan_session::ScanSession;
use crate::search::Filter;
use crate::utils::categorizer::categorize_file;
use std::collections::HashMap;
use rayon::prelude::*;
use serde::Serialize;
use tauri::command;
use tauri::State;

#[derive(Serialize)]
pub struct CategoryBreakdownEntry {
    pub category: String,
    pub size: u64,
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
    pub alloc: u64,
    pub is_dir: bool,
    pub category: FileCategory,
    pub file_count: u64,
    pub last_modified: Option<u64>,
    pub protected: bool,
}

#[command]
pub async fn get_children(
    session: State<'_, ScanSession>,
    path: String,
    child_depth: Option<u32>,
) -> Result<Vec<ScanNode>, AppError> {
    let cd = child_depth.unwrap_or(1).max(1);
    session.read(move |arena| arena.children_as_scan(&path, cd)).await
}

#[command]
pub async fn get_node_info(session: State<'_, ScanSession>, path: String) -> Result<ScanNode, AppError> {
    session.read(move |arena| arena.get_node_info(&path)).await
}

#[command]
pub async fn search_nodes(
    session: State<'_, ScanSession>,
    query: String,
    max_results: Option<u32>,
    on_disk: Option<bool>,
) -> Result<Vec<SearchHit>, AppError> {
    let max_r = max_results.unwrap_or(500).clamp(1, 10_000) as usize;
    let filter = Filter::parse(query.trim(), on_disk.unwrap_or(false));
    if filter.is_empty() {
        return Ok(vec![]);
    }

    session.read(move |a| {
        let root = a.root_id();
        let mut ids: Vec<u32> = (0..a.len() as u32)
            .into_par_iter()
            .filter(|&id| id != root && a.is_used(id) && filter.matches(a, id))
            .collect();
        if ids.len() > max_r {
            ids.select_nth_unstable_by(max_r - 1, |&x, &y| filter.metric(a, y).cmp(&filter.metric(a, x)));
            ids.truncate(max_r);
        }
        ids.sort_unstable_by(|&x, &y| filter.metric(a, y).cmp(&filter.metric(a, x)));
        Ok(ids
            .into_iter()
            .map(|id| SearchHit {
                name: a.name(id).to_string(),
                path: a.full_path(id),
                size: a.size(id),
                alloc: a.alloc_size(id),
                is_dir: a.is_dir(id),
                category: a.category(id),
                file_count: a.file_count(id),
                last_modified: a.mtime(id),
                protected: a.is_protected(id),
            })
            .collect())
    }).await
}

#[derive(Serialize)]
pub struct ExtStat {
    /// Lowercase extension without the dot; empty for files without one.
    pub ext: String,
    pub count: u64,
    pub size: u64,
    pub alloc: u64,
    pub category: FileCategory,
}

/// Per-extension totals over all files, largest first.
#[command]
pub async fn get_extension_stats(session: State<'_, ScanSession>, n: Option<u32>) -> Result<Vec<ExtStat>, AppError> {
    let take = n.unwrap_or(50).clamp(1, 500) as usize;
    session
        .read(move |a| {
            type Key = [u8; 16];
            let key_of = |name: &str| -> Option<Key> {
                let ext = match name.rfind('.') {
                    Some(i) => &name[i + 1..],
                    None => "",
                };
                let mut k = [0u8; 16];
                if ext.is_ascii() {
                    if ext.len() > 16 {
                        return None;
                    }
                    for (i, b) in ext.bytes().enumerate() {
                        k[i] = b.to_ascii_lowercase();
                    }
                } else {
                    let l = ext.to_lowercase();
                    if l.len() > 16 {
                        return None;
                    }
                    k[..l.len()].copy_from_slice(l.as_bytes());
                }
                Some(k)
            };
            let map: HashMap<Key, (u64, u64, u64)> = (0..a.len() as u32)
                .into_par_iter()
                .fold(HashMap::new, |mut m: HashMap<Key, (u64, u64, u64)>, id| {
                    if a.is_used(id) && !a.is_dir(id) {
                        // Entries beyond 16 bytes are not real extensions; bucket them as "(none)".
                        let k = key_of(a.name(id)).unwrap_or([0u8; 16]);
                        let e = m.entry(k).or_insert((0, 0, 0));
                        e.0 += 1;
                        e.1 += a.size(id);
                        e.2 += a.alloc_size(id);
                    }
                    m
                })
                .reduce(HashMap::new, |mut x, y| {
                    for (k, v) in y {
                        let e = x.entry(k).or_insert((0, 0, 0));
                        e.0 += v.0;
                        e.1 += v.1;
                        e.2 += v.2;
                    }
                    x
                });
            let mut v: Vec<(Key, (u64, u64, u64))> = map.into_iter().collect();
            v.sort_unstable_by(|x, y| y.1 .1.cmp(&x.1 .1));
            v.truncate(take);
            Ok(v
                .into_iter()
                .map(|(k, (count, size, alloc))| {
                    let len = k.iter().position(|&b| b == 0).unwrap_or(16);
                    let ext = String::from_utf8_lossy(&k[..len]).into_owned();
                    let category = if ext.is_empty() { FileCategory::Other } else { categorize_file(&ext) };
                    ExtStat { ext, count, size, alloc, category }
                })
                .collect())
        })
        .await
}

/// Pruned nested tree below `path` for the treemap.
#[command]
pub async fn get_treemap(
    session: State<'_, ScanSession>,
    path: String,
    depth: Option<u32>,
    min_fraction: Option<f64>,
    max_nodes: Option<u32>,
    on_disk: Option<bool>,
) -> Result<ScanNode, AppError> {
    let depth = depth.unwrap_or(3).clamp(1, 8);
    let frac = min_fraction.unwrap_or(0.0005).clamp(0.0, 0.5);
    let max_nodes = max_nodes.unwrap_or(4000).clamp(50, 50_000) as usize;
    let use_alloc = on_disk.unwrap_or(false);
    session
        .read(move |a| {
            let id = a.resolve_path(&path)?;
            let total = if use_alloc { a.alloc_size(id) } else { a.size(id) };
            let min = (total as f64 * frac) as u64;
            Ok(a.treemap(id, depth, min, max_nodes, use_alloc))
        })
        .await
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
pub async fn get_top_files(session: State<'_, ScanSession>, n: Option<u32>) -> Result<Vec<ScanNode>, AppError> {
    let take = n.unwrap_or(100).clamp(1, 10_000) as usize;
    session.read(move |a| Ok(top_file_ids(a, take).into_iter().map(|id| a.node_to_scan(id, 0)).collect())).await
}

#[command]
pub async fn get_category_breakdown(
    session: State<'_, ScanSession>,
    _path: String,
) -> Result<Vec<CategoryBreakdownEntry>, AppError> {
    session.read(move |a| {
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
    }).await
}

/// Folders ranked by own weight: their size minus their largest child folder, so the folder
/// that actually holds the data surfaces instead of all of its ancestors.
#[command]
pub async fn get_top_folders(session: State<'_, ScanSession>, n: Option<u32>) -> Result<Vec<ScanNode>, AppError> {
    let take = n.unwrap_or(100).clamp(1, 1000) as usize;
    session
        .read(move |a| {
            let root = a.root_id();
            let mut v: Vec<(u32, u64)> = (0..a.len() as u32)
                .into_par_iter()
                .filter(|&id| id != root && a.is_used(id) && a.is_dir(id))
                .map(|id| {
                    let biggest_dir = a.live_children(id).find(|&c| a.is_dir(c)).map(|c| a.size(c)).unwrap_or(0);
                    (id, a.size(id).saturating_sub(biggest_dir))
                })
                .filter(|x| x.1 > 0)
                .collect();
            if v.len() > take {
                v.select_nth_unstable_by(take - 1, |x, y| y.1.cmp(&x.1));
                v.truncate(take);
            }
            v.sort_unstable_by(|x, y| y.1.cmp(&x.1));
            Ok(v.into_iter().map(|(id, _)| a.node_to_scan(id, 0)).collect())
        })
        .await
}

/// Deepest folders that carry most of their parent's change since the previous snapshot.
fn biggest_changes(a: &ScanArena, n: usize) -> Vec<ScanNode> {
    let root = a.root_id();
    let mut cands: Vec<(u32, i64)> = Vec::new();
    for id in 0..a.len() as u32 {
        if id == root || !a.is_used(id) || !a.is_dir(id) {
            continue;
        }
        let Some(d) = a.delta(id) else { continue };
        let thr = d.unsigned_abs() / 2;
        let dominated = a.live_children(id).any(|c| {
            a.is_dir(c) && a.delta(c).map_or(false, |cd| cd.signum() == d.signum() && cd.unsigned_abs() >= thr)
        });
        if !dominated {
            cands.push((id, d));
        }
    }
    cands.sort_unstable_by(|x, y| y.1.unsigned_abs().cmp(&x.1.unsigned_abs()));
    cands.truncate(n);
    cands.into_iter().map(|(id, _)| a.node_to_scan(id, 0)).collect()
}

#[command]
pub async fn get_biggest_changes(session: State<'_, ScanSession>, n: Option<u32>) -> Result<Vec<ScanNode>, AppError> {
    let take = n.unwrap_or(10).clamp(1, 500) as usize;
    session.read(move |a| Ok(biggest_changes(a, take))).await
}

#[derive(Serialize)]
pub struct ChangesSummary {
    /// Unix time of the snapshot the deltas are relative to (None when there is no baseline yet).
    pub since: Option<u64>,
    /// 0 = saved by the app, 1 = background snapshot.
    pub origin: u8,
    pub total_delta: i64,
    pub top: Vec<ScanNode>,
}

#[command]
pub async fn get_changes_summary(session: State<'_, ScanSession>, n: Option<u32>) -> Result<ChangesSummary, AppError> {
    let take = n.unwrap_or(5).clamp(1, 100) as usize;
    session
        .read(move |a| {
            let (since, origin) = match a.prev_snapshot() {
                Some((t, o)) if a.has_deltas() => (Some(t), o),
                _ => (None, 0),
            };
            Ok(ChangesSummary {
                since,
                origin,
                total_delta: a.delta(a.root_id()).unwrap_or(0),
                top: if since.is_some() { biggest_changes(a, take) } else { Vec::new() },
            })
        })
        .await
}
#[command]
pub async fn get_dashboard_stats(session: State<'_, ScanSession>) -> Result<DashboardStats, AppError> {
    session.read(move |a| {
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
    }).await
}

/// Full subtree for small exports (selection). Large exports use `export_scan`.
#[command]
pub async fn get_export_subtree(session: State<'_, ScanSession>, path: String) -> Result<ScanNode, AppError> {
    session.read(move |a| {
        let id = a.resolve_path(&path)?;
        Ok(a.subtree_full(id))
    }).await
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
pub async fn get_cleanup_candidates(session: State<'_, ScanSession>) -> Result<CleanupCandidates, AppError> {
    const MAX_PER_BUCKET: usize = 20_000;
    session.read(move |a| {
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
    }).await
}

/// Streams the subtree at `path` straight to `dest` (format: "json" or "csv").
#[command]
pub async fn export_scan(
    session: State<'_, ScanSession>,
    path: String,
    dest: String,
    format: String,
) -> Result<u64, AppError> {
    session.read(move |a| {
        let id = a.resolve_path(&path)?;
        crate::export::write_file(a, id, std::path::Path::new(&dest), &format).map_err(|e| e.to_string())
    }).await
}
