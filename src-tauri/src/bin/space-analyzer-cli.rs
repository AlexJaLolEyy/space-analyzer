//! Command-line companion to Space Analyzer (not bundled with the app).
//!
//! Usage:
//!   space-analyzer-cli scan <path> [--exclude <name|path>]...
//!   space-analyzer-cli export <path> --format csv|json --out <file> [--exclude ...]
//!   space-analyzer-cli snapshot <path> [--exclude ...]
//!
//! Exit codes: 0 success, 1 failure, 2 usage error. The MFT engine is used automatically
//! when the terminal is elevated and the path is an NTFS drive root.

use space_analyzer_lib::scan::{scan_path, Progress};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

const USAGE: &str = "usage:\n  space-analyzer-cli scan <path> [--exclude X]...\n  space-analyzer-cli export <path> --format csv|json --out <file> [--exclude X]...\n  space-analyzer-cli snapshot <path> [--exclude X]...";

fn gib(b: u64) -> f64 {
    b as f64 / (1u64 << 30) as f64
}

fn main() {
    std::process::exit(real_main());
}

fn real_main() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().map(String::as_str) else {
        eprintln!("{USAGE}");
        return 2;
    };
    if !matches!(cmd, "scan" | "export" | "snapshot") {
        eprintln!("{USAGE}");
        return 2;
    }
    let Some(path) = args.get(1).filter(|a| !a.starts_with("--")) else {
        eprintln!("{USAGE}");
        return 2;
    };

    let mut excluded: Vec<String> = Vec::new();
    let mut format = "json".to_string();
    let mut out: Option<String> = None;
    let mut i = 2;
    while i < args.len() {
        let val = args.get(i + 1).cloned();
        match (args[i].as_str(), val) {
            ("--exclude", Some(v)) => excluded.push(v),
            ("--format", Some(v)) => format = v,
            ("--out", Some(v)) => out = Some(v),
            _ => {
                eprintln!("{USAGE}");
                return 2;
            }
        }
        i += 2;
    }

    if cmd == "snapshot" {
        return space_analyzer_lib::headless::run_snapshot(path, &excluded);
    }
    if cmd == "export" && (out.is_none() || !matches!(format.as_str(), "csv" | "json")) {
        eprintln!("{USAGE}");
        return 2;
    }

    let canonical = match std::fs::canonicalize(path) {
        Ok(p) if p.is_dir() => space_analyzer_lib::scan::clean_path(&p.to_string_lossy()),
        _ => {
            eprintln!("not a directory: {path}");
            return 1;
        }
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let progress = |p: Progress| eprint!("\r{}: {} files   ", p.phase, p.files);
    let outcome = match scan_path(&canonical, None, &cancel, &progress, &excluded) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("\nscan failed: {e}");
            return 1;
        }
    };
    eprintln!();
    let a = &outcome.arena;

    if cmd == "export" {
        let dest = out.unwrap_or_default();
        return match space_analyzer_lib::export::write_file(a, a.root_id(), std::path::Path::new(&dest), &format) {
            Ok(n) => {
                println!("exported {n} files to {dest}");
                0
            }
            Err(e) => {
                eprintln!("export failed: {e}");
                1
            }
        };
    }

    println!(
        "{}  {} files  {:.2} GiB  ({}, {:.1}s)",
        a.root_path(),
        a.total_files(),
        gib(a.total_size()),
        outcome.engine.label(),
        outcome.elapsed_ms as f64 / 1000.0
    );
    for c in a.live_children(a.root_id()).take(10) {
        println!("{:>10.2} GiB  {}", gib(a.size(c)), a.display_name(c));
    }
    0
}
