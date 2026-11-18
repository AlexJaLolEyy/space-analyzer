//! Filter-expression grammar for `search_nodes`.
//!
//! Space-separated terms, AND-combined:
//! `ext:mp4`, `ext:jpg,png`, `>500MB`, `<2GB`, `>=1g`, `older:30d`, `newer:2w`,
//! `file:` / `dir:`, `cat:video`, glob terms (`*.log`, `img_??.png`), and plain substrings.
//! Quote a term to keep spaces: `"my folder"`.

use crate::models::file::FileCategory;
use crate::models::flat_scan::ScanArena;
use std::time::{SystemTime, UNIX_EPOCH};

enum NameTerm {
    /// Lowercased substring.
    Sub(String),
    /// Lowercased glob pattern.
    Glob(Vec<char>),
}

#[derive(Default)]
pub struct Filter {
    names: Vec<NameTerm>,
    exts: Vec<Vec<String>>,
    cats: Vec<Vec<u8>>,
    min: Option<u64>,
    max: Option<u64>,
    /// Modified before this unix time.
    older: Option<u64>,
    /// Modified after this unix time.
    newer: Option<u64>,
    want_dir: Option<bool>,
    on_disk: bool,
}

fn tokenize(q: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in q.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub fn parse_size(s: &str) -> Option<u64> {
    let s = s.trim().to_ascii_lowercase();
    let split = s.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().ok()?;
    let mult: f64 = match unit.trim() {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024.0 * 1024.0,
        "g" | "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        "t" | "tb" | "tib" => 1024.0_f64.powi(4),
        _ => return None,
    };
    Some((n * mult) as u64)
}

/// `30d`, `2w`, `6m` (30 days), `1y`; a bare number means days. Returns seconds.
fn parse_age(s: &str) -> Option<u64> {
    let s = s.trim().to_ascii_lowercase();
    let split = s.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().ok()?;
    let day = 86_400.0;
    let mult = match unit {
        "" | "d" => day,
        "h" => 3600.0,
        "w" => 7.0 * day,
        "m" => 30.0 * day,
        "y" => 365.0 * day,
        _ => return None,
    };
    Some((n * mult) as u64)
}

fn parse_category(s: &str) -> Option<u8> {
    let s = s.to_ascii_lowercase();
    FileCategory::ALL
        .iter()
        .find(|c| c.name().eq_ignore_ascii_case(&s) || (s.len() >= 3 && c.name().to_ascii_lowercase().starts_with(&s)))
        .map(|&c| c as u8)
}

impl Filter {
    pub fn parse(query: &str, on_disk: bool) -> Filter {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut f = Filter { on_disk, ..Default::default() };
        for tok in tokenize(query) {
            let low = tok.to_lowercase();
            if let Some(v) = low.strip_prefix("ext:") {
                let list: Vec<String> = v
                    .split(',')
                    .map(|e| e.trim().trim_start_matches('.').to_string())
                    .filter(|e| !e.is_empty())
                    .collect();
                if !list.is_empty() {
                    f.exts.push(list);
                    continue;
                }
            } else if let Some(v) = low.strip_prefix("cat:") {
                let list: Vec<u8> = v.split(',').filter_map(parse_category).collect();
                if !list.is_empty() {
                    f.cats.push(list);
                    continue;
                }
            } else if let Some(v) = low.strip_prefix("older:") {
                if let Some(a) = parse_age(v) {
                    let cut = now.saturating_sub(a);
                    f.older = Some(f.older.map_or(cut, |o| o.min(cut)));
                    continue;
                }
            } else if let Some(v) = low.strip_prefix("newer:") {
                if let Some(a) = parse_age(v) {
                    let cut = now.saturating_sub(a);
                    f.newer = Some(f.newer.map_or(cut, |o| o.max(cut)));
                    continue;
                }
            } else if low == "file:" || low == "files:" {
                f.want_dir = Some(false);
                continue;
            } else if low == "dir:" || low == "folder:" || low == "dirs:" {
                f.want_dir = Some(true);
                continue;
            } else if let Some(v) = low.strip_prefix(">=").map(|v| (v, 0i64)).or_else(|| low.strip_prefix('>').map(|v| (v, 1))) {
                if let Some(n) = parse_size(v.0) {
                    let n = n + v.1 as u64;
                    f.min = Some(f.min.map_or(n, |m| m.max(n)));
                    continue;
                }
            } else if let Some(v) = low.strip_prefix("<=").map(|v| (v, 0i64)).or_else(|| low.strip_prefix('<').map(|v| (v, 1))) {
                if let Some(n) = parse_size(v.0) {
                    let n = n.saturating_sub(v.1 as u64);
                    f.max = Some(f.max.map_or(n, |m| m.min(n)));
                    continue;
                }
            }
            // plain name term
            if low.contains('*') || low.contains('?') {
                f.names.push(NameTerm::Glob(low.chars().collect()));
            } else {
                f.names.push(NameTerm::Sub(low));
            }
        }
        f
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
            && self.exts.is_empty()
            && self.cats.is_empty()
            && self.min.is_none()
            && self.max.is_none()
            && self.older.is_none()
            && self.newer.is_none()
            && self.want_dir.is_none()
    }

    pub fn metric(&self, a: &ScanArena, id: u32) -> u64 {
        if self.on_disk {
            a.alloc_size(id)
        } else {
            a.size(id)
        }
    }

    pub fn matches(&self, a: &ScanArena, id: u32) -> bool {
        let is_dir = a.is_dir(id);
        if let Some(d) = self.want_dir {
            if d != is_dir {
                return false;
            }
        }
        if self.min.is_some() || self.max.is_some() {
            let s = self.metric(a, id);
            if self.min.map_or(false, |m| s < m) || self.max.map_or(false, |m| s > m) {
                return false;
            }
        }
        if self.older.is_some() || self.newer.is_some() {
            let Some(t) = a.mtime(id) else { return false };
            if self.older.map_or(false, |o| t >= o) || self.newer.map_or(false, |n| t <= n) {
                return false;
            }
        }
        if !self.cats.is_empty() {
            // Folders have no category.
            if is_dir {
                return false;
            }
            let c = a.category(id) as u8;
            if !self.cats.iter().all(|g| g.contains(&c)) {
                return false;
            }
        }
        let name = a.name(id);
        if !self.exts.is_empty() {
            if is_dir {
                return false;
            }
            let ext = match name.rfind('.') {
                Some(i) => &name[i + 1..],
                None => "",
            };
            if !self.exts.iter().all(|g| g.iter().any(|e| ext.eq_ignore_ascii_case(e) || (!ext.is_ascii() && ext.to_lowercase() == *e))) {
                return false;
            }
        }
        self.names.iter().all(|t| match t {
            NameTerm::Sub(s) => contains_ci(name, s),
            NameTerm::Glob(p) => glob_match(p, &name.to_lowercase()),
        })
    }
}

fn contains_ci(hay: &str, needle_lower: &str) -> bool {
    if hay.is_ascii() && needle_lower.is_ascii() {
        let (h, n) = (hay.as_bytes(), needle_lower.as_bytes());
        h.len() >= n.len() && h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n))
    } else {
        hay.to_lowercase().contains(needle_lower)
    }
}

/// `*` matches any run, `?` one char. The pattern and text are already lowercase and the
/// match must cover the whole name (use `*x*` for contains).
fn glob_match(p: &[char], text: &str) -> bool {
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (usize::MAX, 0usize);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = pi;
            mark = ti;
            pi += 1;
        } else if star != usize::MAX {
            pi = star + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(parse_size("500MB"), Some(500 * 1024 * 1024));
        assert_eq!(parse_size("1.5g"), Some(1610612736));
        assert_eq!(parse_size("10"), Some(10));
        assert_eq!(parse_size("abc"), None);
    }

    #[test]
    fn globs() {
        let g = |p: &str, t: &str| glob_match(&p.chars().collect::<Vec<_>>(), t);
        assert!(g("*.log", "a.log"));
        assert!(!g("*.log", "a.logx"));
        assert!(g("img_??.png", "img_01.png"));
        assert!(g("*a*b*", "xxaxxbxx"));
        assert!(!g("a*", "ba"));
    }

    #[test]
    fn tokens() {
        assert_eq!(tokenize(r#"ext:mp4 "my folder" >1g"#), vec!["ext:mp4", "my folder", ">1g"]);
    }
}
