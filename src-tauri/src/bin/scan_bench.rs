//! Headless scan benchmark.
//!
//! Usage:
//!   scan_bench <path> [--engine mft|walker]   run one engine (default: automatic)
//!   scan_bench <path> --compare               run MFT and walker, then diff the results
//!
//! The MFT engine needs an elevated terminal.

use space_analyzer_lib::scan::{scan_path, Engine, Progress};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

fn peak_working_set_mb() -> f64 {
    unsafe {
        let mut c: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        if GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) != 0 {
            c.PeakWorkingSetSize as f64 / (1024.0 * 1024.0)
        } else {
            0.0
        }
    }
}

struct RunResult {
    engine: Engine,
    secs: f64,
    files: u64,
    size: u64,
    slots: usize,
}

fn gib(b: u64) -> f64 {
    b as f64 / (1u64 << 30) as f64
}

fn run(path: &str, force: Option<Engine>) -> Result<RunResult, String> {
    let start = Instant::now();
    let last_phase: Mutex<&'static str> = Mutex::new("");
    let progress = |p: Progress| {
        let mut lp = last_phase.lock().unwrap();
        if *lp != p.phase {
            println!("[{:>7} ms] phase: {}", start.elapsed().as_millis(), p.phase);
            *lp = p.phase;
        }
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let out = scan_path(path, force, &cancel, &progress, &[])?;
    let a = &out.arena;
    Ok(RunResult {
        engine: out.engine,
        secs: start.elapsed().as_secs_f64(),
        files: a.total_files(),
        size: a.total_size(),
        slots: a.len(),
    })
}

fn print(r: &RunResult) {
    println!("engine:        {:?}", r.engine);
    println!("total time:    {:.2} s", r.secs);
    println!("files:         {}", r.files);
    println!("size:          {:.2} GiB", gib(r.size));
    println!("node slots:    {}", r.slots);
    println!("peak RAM:      {:.0} MB (process so far)", peak_working_set_mb());
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(path) = args.first().cloned() else {
        eprintln!("usage: scan_bench <path> [--engine mft|walker] [--compare]");
        std::process::exit(2);
    };
    println!("admin: {}", space_analyzer_lib::utils::is_admin());

    if args.iter().any(|a| a == "--compare") {
        println!("--- MFT ---");
        let m = match run(&path, Some(Engine::Mft)) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("MFT scan failed: {e}");
                std::process::exit(1);
            }
        };
        print(&m);
        println!("--- Walker ---");
        let w = match run(&path, Some(Engine::Walker)) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("walker scan failed: {e}");
                std::process::exit(1);
            }
        };
        print(&w);
        println!("--- Diff (MFT - walker) ---");
        println!("files: {:+}", m.files as i64 - w.files as i64);
        println!("size:  {:+.3} GiB", (m.size as i128 - w.size as i128) as f64 / (1u64 << 30) as f64);
        println!("note: small differences are expected on a live system (files change during scans).");
        return;
    }

    let force = match args.iter().position(|a| a == "--engine").and_then(|i| args.get(i + 1)).map(|s| s.as_str()) {
        Some("mft") => Some(Engine::Mft),
        Some("walker") => Some(Engine::Walker),
        _ => None,
    };
    match run(&path, force) {
        Ok(r) => print(&r),
        Err(e) => {
            eprintln!("scan failed: {e}");
            std::process::exit(1);
        }
    }
}
