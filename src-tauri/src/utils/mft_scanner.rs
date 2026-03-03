use crate::models::{file::FileCategory, scan::ScanNode};
use crate::utils::categorizer::categorize_file;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;
use tauri::Emitter;

// Windows API External Functions
#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        lpFileName: *const u16,
        dwDesiredAccess: u32,
        dwShareMode: u32,
        lpSecurityAttributes: *const std::ffi::c_void,
        dwCreationDisposition: u32,
        dwFlagsAndAttributes: u32,
        hTemplateFile: isize,
    ) -> isize;

    fn DeviceIoControl(
        hDevice: isize,
        dwIoControlCode: u32,
        lpInBuffer: *const std::ffi::c_void,
        nInBufferSize: u32,
        lpOutBuffer: *mut std::ffi::c_void,
        nOutBufferSize: u32,
        lpBytesReturned: *mut u32,
        lpOverlapped: *mut std::ffi::c_void,
    ) -> i32;

    fn CloseHandle(hObject: isize) -> i32;
}

// IOCTL and Flag Constants
const FSCTL_ENUM_USN_DATA: u32 = 0x000900B3;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const GENERIC_READ: u32 = 0x80000000;
const FILE_SHARE_READ: u32 = 1;
const FILE_SHARE_WRITE: u32 = 2;
const OPEN_EXISTING: u32 = 3;
const INVALID_HANDLE_VALUE: isize = -1;

#[derive(Clone, serde::Serialize)]
pub struct ScanProgress {
    pub files_scanned: u64,
    pub bytes_scanned: u64,
    pub current_path: String,
    pub percent: f32,
    pub elapsed_ms: u64,
}

#[repr(C)]
struct MftEnumDataV0 {
    start_file_reference_number: u64,
    low_usn: i64,
    high_usn: i64,
}

#[derive(Clone)]
struct MftEntry {
    name: String,
    parent_ref: u64,
    is_dir: bool,
}

use std::sync::atomic::AtomicU64;

pub fn scan_ntfs_mft(
    app_handle: &tauri::AppHandle,
    drive_mount: &str,
    cancel_flag: Arc<AtomicBool>,
) -> Result<ScanNode, String> {
    let start_time = Instant::now();
    println!(
        "Starting Turbo Scan (FSCTL_ENUM_USN_DATA) on: {}",
        drive_mount
    );

    // --- Phase 1: Open volume ---
    let volume_handle = open_volume(drive_mount)?;

    // --- Phase 2: Enumerate MFT ---
    let entries = match enumerate_mft(volume_handle, &cancel_flag, app_handle, start_time) {
        Ok(e) => e,
        Err(e) => {
            unsafe {
                CloseHandle(volume_handle);
            }
            return Err(e);
        }
    };

    if cancel_flag.load(Ordering::Relaxed) {
        unsafe {
            CloseHandle(volume_handle);
        }
        return Err("Scan cancelled".to_string());
    }

    println!(
        "MFT Phase 1 (Enumeration) took {:.2}s. Found {} entries.",
        start_time.elapsed().as_secs_f64(),
        entries.iter().filter(|e| e.is_some()).count()
    );

    // --- Phase 3: Get file sizes and paths ---
    let entries_with_info =
        match get_file_info(drive_mount, &entries, &cancel_flag, app_handle, start_time) {
            Ok(e) => e,
            Err(e) => {
                unsafe {
                    CloseHandle(volume_handle);
                }
                return Err(e);
            }
        };

    // --- Phase 4: Build ScanNode tree ---
    let tree = build_scan_tree(drive_mount, &entries_with_info, &entries);

    unsafe {
        CloseHandle(volume_handle);
    }

    if tree.size == 0 && count_items(&tree) < 50 {
        println!(
            "Warning: MFT scan produced insufficient data (Size: {}), falling back.",
            tree.size
        );
        return Err("MFT scan returned no data".to_string());
    }

    println!(
        "Scan finished successfully in {:.2}s. Root size: {:.2} TB",
        start_time.elapsed().as_secs_f64(),
        tree.size as f64 / (1024.0 * 1024.0 * 1024.0 * 1024.0)
    );
    Ok(tree)
}

fn count_items(node: &ScanNode) -> usize {
    1 + node.children.iter().map(count_items).sum::<usize>()
}

fn open_volume(drive_mount: &str) -> Result<isize, String> {
    let drive_letter = drive_mount.trim_end_matches('\\').trim_end_matches('/');
    let volume_path = format!("\\\\.\\{}", drive_letter);
    let wide_path: Vec<u16> = volume_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            0,
            0,
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        let err = std::io::Error::last_os_error();
        return Err(format!("Run as Admin. Drive open failed: {}", err));
    }

    Ok(handle)
}

fn enumerate_mft(
    handle: isize,
    cancel_flag: &Arc<AtomicBool>,
    app_handle: &tauri::AppHandle,
    start_time: Instant,
) -> Result<Vec<Option<MftEntry>>, String> {
    let mut enum_data = MftEnumDataV0 {
        start_file_reference_number: 0,
        low_usn: 0,
        high_usn: i64::MAX,
    };

    // Use a larger 1MB buffer to reduce context switches to the kernel
    let mut buffer = vec![0u8; 1024 * 1024];
    // Pre-allocate more aggressively to avoid resizes
    let mut entries: Vec<Option<MftEntry>> = Vec::with_capacity(3_000_000);
    entries.resize_with(1_000_000, || None);

    let mut last_emit = Instant::now();
    let mut count = 0;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let mut bytes_returned: u32 = 0;
        let success = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_ENUM_USN_DATA,
                &enum_data as *const _ as *const _,
                std::mem::size_of::<MftEnumDataV0>() as u32,
                buffer.as_mut_ptr() as *mut _,
                buffer.len() as u32,
                &mut bytes_returned,
                std::ptr::null_mut(),
            )
        };

        if success == 0 {
            break;
        }

        if bytes_returned < 8 {
            break;
        }
        let next_ref = u64::from_le_bytes(buffer[0..8].try_into().unwrap());
        let mut offset = 8usize;

        while offset + 60 <= bytes_returned as usize {
            let record_len =
                u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap()) as usize;
            if record_len == 0 || offset + record_len > bytes_returned as usize {
                break;
            }

            let file_ref = u64::from_le_bytes(buffer[offset + 8..offset + 16].try_into().unwrap())
                & 0x0000_FFFF_FFFF_FFFF;
            let parent_ref =
                u64::from_le_bytes(buffer[offset + 16..offset + 24].try_into().unwrap())
                    & 0x0000_FFFF_FFFF_FFFF;
            let file_attrs =
                u32::from_le_bytes(buffer[offset + 52..offset + 56].try_into().unwrap());
            let name_len_bytes =
                u16::from_le_bytes(buffer[offset + 56..offset + 58].try_into().unwrap()) as usize;
            let name_offset =
                u16::from_le_bytes(buffer[offset + 58..offset + 60].try_into().unwrap()) as usize;

            if offset + name_offset + name_len_bytes <= bytes_returned as usize {
                let name_start = offset + name_offset;
                let name_end = name_start + name_len_bytes;
                let wide_chars: Vec<u16> = buffer[name_start..name_end]
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();

                let name = String::from_utf16_lossy(&wide_chars);
                let is_dir = (file_attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;

                let id = file_ref as usize;
                if id >= entries.len() {
                    entries.resize_with(id + 1024, || None);
                }
                entries[id] = Some(MftEntry {
                    name,
                    parent_ref,
                    is_dir,
                });
                count += 1;
            }
            offset += record_len;
        }

        enum_data.start_file_reference_number = next_ref;

        if last_emit.elapsed().as_millis() > 300 {
            last_emit = Instant::now();
            let _ = app_handle.emit(
                "scan-progress",
                ScanProgress {
                    files_scanned: count,
                    bytes_scanned: 0,
                    current_path: format!(
                        "Turbo-Mode Phase 1: Enumerating MFT... ({} found)",
                        count
                    ),
                    percent: 0.0,
                    elapsed_ms: start_time.elapsed().as_millis() as u64,
                },
            );
        }
    }

    // SELF-HEALING: Ensure root exists and handle orphans
    if entries.len() <= 5 {
        entries.resize_with(6, || None);
    }

    if entries[5].is_none() {
        println!("Self-healing: Creating Root Record 5");
        entries[5] = Some(MftEntry {
            name: "".to_string(),
            parent_ref: 5,
            is_dir: true,
        });
    }

    Ok(entries)
}

fn get_file_info(
    drive_mount: &str,
    entries: &[Option<MftEntry>],
    cancel_flag: &Arc<AtomicBool>,
    app_handle: &tauri::AppHandle,
    start_time: Instant,
) -> Result<Vec<Option<(String, u64, u64, bool)>>, String> {
    let drive_prefix = drive_mount.trim_end_matches('\\');
    let mut children_map: Vec<Vec<u64>> = vec![Vec::new(); entries.len()];
    let root_ref: u64 = 5;

    for (id, entry_opt) in entries.iter().enumerate() {
        if let Some(entry) = entry_opt {
            let id = id as u64;
            if id != root_ref {
                let p_id = entry.parent_ref as usize;
                if p_id < children_map.len() {
                    children_map[p_id].push(id);
                }
            }
        }
    }

    // 1. Build Path Map (BFS)
    let mut path_map: Vec<Option<String>> = vec![None; entries.len()];
    path_map[root_ref as usize] = Some(format!("{}\\", drive_prefix));

    let mut queue = VecDeque::new();
    queue.push_back(root_ref);

    println!("Phase 2: Resolving paths...");
    while let Some(id) = queue.pop_front() {
        let children = &children_map[id as usize];
        if !children.is_empty() {
            let parent_path = path_map[id as usize].as_ref().unwrap().clone();
            for &child_id in children {
                if let Some(Some(child_entry)) = entries.get(child_id as usize) {
                    let child_path = format!(
                        "{}\\{}",
                        parent_path.trim_end_matches('\\'),
                        child_entry.name
                    );
                    path_map[child_id as usize] = Some(child_path);
                    if child_entry.is_dir {
                        queue.push_back(child_id);
                    }
                }
            }
        }
    }

    // 2. PARALLEL METADATA FETCHING
    println!("Phase 3: Multi-threaded size retrieval...");

    let entries_arc = Arc::new(entries.to_vec()); // Convert slice to Vec for Arc
    let paths_arc = Arc::new(path_map);
    let results_arc = Arc::new(std::sync::Mutex::new(vec![None; entries_arc.len()]));

    let monitor_stop = Arc::new(AtomicBool::new(false));
    let cancel_local = Arc::clone(&cancel_flag);

    let files_count = Arc::new(AtomicU64::new(0));
    let bytes_total = Arc::new(AtomicU64::new(0));

    let num_threads = 8;
    let mut handles = vec![];
    let chunk_size = entries_arc.len() / num_threads + 1;

    for i in 0..num_threads {
        let entries = Arc::clone(&entries_arc);
        let paths = Arc::clone(&paths_arc);
        let results = Arc::clone(&results_arc);
        let cancel = Arc::clone(&cancel_local);
        let f_count = Arc::clone(&files_count);
        let b_total = Arc::clone(&bytes_total);

        handles.push(thread::spawn(move || {
            let start = i * chunk_size;
            let end = (start + chunk_size).min(entries.len());

            let mut local_results = vec![None; end - start];
            let mut thread_bytes = 0;
            let mut thread_files = 0;

            for (idx, id) in (start..end).enumerate() {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                if let (Some(entry), Some(path)) = (&entries[id], &paths[id]) {
                    let (size, modified) = if entry.is_dir {
                        (0, 0)
                    } else {
                        match std::fs::metadata(path) {
                            Ok(m) => (m.len(), 0),
                            Err(_) => (0, 0),
                        }
                    };
                    local_results[idx] = Some((path.clone(), size, modified, entry.is_dir));
                    thread_bytes += size;
                    thread_files += 1;

                    // Periodically update atomics to avoid too much overhead but keep UI lively
                    if thread_files % 1000 == 0 {
                        f_count.fetch_add(1000, Ordering::Relaxed);
                        b_total.fetch_add(thread_bytes, Ordering::Relaxed);
                        thread_bytes = 0;
                    }
                }
            }

            // Final additions
            b_total.fetch_add(thread_bytes, Ordering::Relaxed);

            if let Ok(mut res) = results.lock() {
                for (idx, id) in (start..end).enumerate() {
                    res[id] = local_results[idx].take();
                }
            }
        }));
    }

    // Progress monitor
    let app_h = app_handle.clone();
    let f_count_mon = Arc::clone(&files_count);
    let b_total_mon = Arc::clone(&bytes_total);
    let stop_mon = Arc::clone(&monitor_stop);
    let st = start_time;

    let monitor_handle = thread::spawn(move || {
        while !stop_mon.load(Ordering::Relaxed) {
            thread::sleep(std::time::Duration::from_millis(250));
            let c = f_count_mon.load(Ordering::Relaxed);
            let b = b_total_mon.load(Ordering::Relaxed);
            let _ = app_h.emit(
                "scan-progress",
                ScanProgress {
                    files_scanned: c,
                    bytes_scanned: b,
                    current_path: format!(
                        "Turbo-Mode Phase 3: {:.2} TB scanned...",
                        b as f64 / (1024.0 * 1024.0 * 1024.0 * 1024.0)
                    ),
                    percent: 0.0,
                    elapsed_ms: st.elapsed().as_millis() as u64,
                },
            );
        }
    });

    for h in handles {
        let _ = h.join();
    }
    monitor_stop.store(true, Ordering::Relaxed);
    let _ = monitor_handle.join();

    let final_res = results_arc.lock().unwrap().to_vec();
    Ok(final_res)
}

fn build_scan_tree(
    drive_mount: &str,
    info_map: &[Option<(String, u64, u64, bool)>],
    all_entries: &[Option<MftEntry>],
) -> ScanNode {
    println!("Phase 4: Building Tree (Deterministic Aggregation)...");
    let root_ref: u64 = 5;
    const CULL_LIMIT: u64 = 20 * 1024; // 20KB limit for UI performance

    // 1. Map all children to their parents for O(1) lookups
    let mut children_map: Vec<Vec<u32>> = vec![Vec::new(); all_entries.len()];
    for (id, entry_opt) in all_entries.iter().enumerate() {
        if let Some(entry) = entry_opt {
            if id as u64 != root_ref && entry.parent_ref < all_entries.len() as u64 {
                children_map[entry.parent_ref as usize].push(id as u32);
            }
        }
    }

    // 2. Recursive build function to ensure sizes bubble up correctly
    fn build_node_recursive(
        id: u64,
        info_map: &[Option<(String, u64, u64, bool)>],
        all_entries: &[Option<MftEntry>],
        children_list: &[Vec<u32>],
        cull_limit: u64,
    ) -> Option<ScanNode> {
        let (path, size, modified, is_dir) = info_map.get(id as usize)?.as_ref()?;
        let mft = all_entries.get(id as usize)?.as_ref()?;

        // Base node - directories start at 0 size and will sum their children
        let mut node = ScanNode {
            name: mft.name.clone(),
            path: path.clone(),
            size: if *is_dir { 0 } else { *size },
            is_dir: *is_dir,
            children: Vec::new(),
            file_count: if *is_dir { 0 } else { 1 },
            category: if *is_dir {
                FileCategory::Other
            } else {
                categorize_file(
                    Path::new(&mft.name)
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or(""),
                )
            },
            last_modified: if *modified > 0 { Some(*modified) } else { None },
        };

        // Recursive child processing
        for &cid in &children_list[id as usize] {
            if let Some(child) =
                build_node_recursive(cid as u64, info_map, all_entries, children_list, cull_limit)
            {
                // ADD child stats to parent before deciding to cull
                node.size += child.size;
                node.file_count += child.file_count;

                // Only keep dirs or large files in the the final tree sent to UI
                if child.is_dir || child.size >= cull_limit {
                    node.children.push(child);
                }
            }
        }

        node.children.sort_by(|a, b| b.size.cmp(&a.size));
        Some(node)
    }

    build_node_recursive(root_ref, info_map, all_entries, &children_map, CULL_LIMIT).unwrap_or_else(
        || ScanNode {
            name: drive_mount.to_string(),
            path: drive_mount.to_string(),
            size: 0,
            is_dir: true,
            children: Vec::new(),
            file_count: 0,
            category: FileCategory::Other,
            last_modified: None,
        },
    )
}
