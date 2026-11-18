use super::file::FileCategory;
use super::scan::ScanNode;
use crate::scan::{norm_path_lower, Engine, Excluded, MftMeta, RawScan, F_DIR, F_USED, NONE};
use crate::utils::categorizer::categorize_name;
use rayon::prelude::*;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

pub const F_PROT: u8 = 4;

/// Max children returned for a requested level / for nested levels. Remaining children are
/// grouped into one synthetic "(N others)" node (only at IPC time, never in storage).
const TOP_LIMIT: usize = 5000;
const NESTED_LIMIT: usize = 60;
const OTHER_CAT: u8 = FileCategory::Other as u8;

const PROTECTED_NAMES: [&str; 13] = [
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "system volume information",
    "boot",
    "recovery",
    "$recycle.bin",
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
    "ntldr",
    "bootmgr",
];

fn is_protected_name(name: &str) -> bool {
    PROTECTED_NAMES.iter().any(|p| name.eq_ignore_ascii_case(p))
}

/// Compact, id-based scan tree. All columns are indexed by node id.
pub struct ScanArena {
    parent: Vec<u32>,
    size: Vec<u64>,
    alloc: Vec<u64>,
    file_count: Vec<u32>,
    mtime: Vec<u32>,
    flags: Vec<u8>,
    cat: Vec<u8>,
    name_off: Vec<u32>,
    name_len: Vec<u16>,
    names: Vec<u8>,
    child_start: Vec<u32>,
    children: Vec<u32>,
    root: u32,
    root_path: String,
    cat_totals: [u64; FileCategory::COUNT],
    generation: u64,
    engine: Engine,
    excluded: Excluded,
    mft_meta: Option<MftMeta>,
    deltas: Option<Vec<i64>>,
    prev_snapshot_time: Option<u64>,
    prev_snapshot_origin: u8,
}

fn join_path(base: &str, name: &str) -> String {
    let mut s = String::with_capacity(base.len() + name.len() + 1);
    s.push_str(base);
    if !s.ends_with('\\') {
        s.push('\\');
    }
    s.push_str(name);
    s
}

fn norm_key(p: &str) -> String {
    let mut s = p.trim().replace('/', "\\");
    if let Some(r) = s.strip_prefix(r"\\?\") {
        s = r.to_string();
    }
    while s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

fn name_eq(a: &str, b_lower: &str) -> bool {
    if a.is_ascii() && b_lower.is_ascii() {
        a.eq_ignore_ascii_case(b_lower)
    } else {
        a.to_lowercase() == b_lower
    }
}

impl ScanArena {
    pub fn build(raw: RawScan, cancel: &AtomicBool, excluded: &Excluded) -> Result<Self, String> {
        let RawScan {
            parent,
            mut size,
            mut alloc,
            mtime,
            flags,
            name_off,
            name_len,
            names,
            root,
            root_path,
            mft_meta,
        } = raw;
        let n = parent.len();
        let root_i = root as usize;
        if root_i >= n || flags[root_i] & F_USED == 0 {
            return Err("Scan root not found".to_string());
        }

        let valid_parent = |id: usize| -> Option<usize> {
            if flags[id] & F_USED == 0 || id == root_i {
                return None;
            }
            let p = parent[id] as usize;
            if p >= n || p == id || flags[p] & F_USED == 0 || flags[p] & F_DIR == 0 {
                return None;
            }
            Some(p)
        };

        // 1. child index via counting sort by parent
        let mut child_start = vec![0u32; n + 1];
        for id in 0..n {
            if let Some(p) = valid_parent(id) {
                child_start[p + 1] += 1;
            }
        }
        for i in 0..n {
            child_start[i + 1] += child_start[i];
        }
        let total = child_start[n] as usize;
        let mut children = vec![0u32; total];
        {
            let mut cursor: Vec<u32> = child_start[..n].to_vec();
            for id in 0..n {
                if let Some(p) = valid_parent(id) {
                    children[cursor[p] as usize] = id as u32;
                    cursor[p] += 1;
                }
            }
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("Scan cancelled".to_string());
        }

        let name_of = |id: usize| -> &str {
            let o = name_off[id] as usize;
            let l = name_len[id] as usize;
            std::str::from_utf8(&names[o..o + l]).unwrap_or("")
        };

        // 1b. user exclusions: resolve absolute entries to ids, names are matched during the walk
        let mut excluded_ids: HashSet<u32> = HashSet::new();
        if !excluded.is_empty() {
            let root_key = norm_path_lower(&root_path);
            for a in excluded.abs_paths() {
                let Some(rest) = a.strip_prefix(&root_key).and_then(|r| r.strip_prefix('\\')) else {
                    continue;
                };
                let mut cur = root;
                let mut ok = true;
                for comp in rest.split('\\').filter(|c| !c.is_empty()) {
                    let (s, e) = (child_start[cur as usize] as usize, child_start[cur as usize + 1] as usize);
                    match children[s..e]
                        .iter()
                        .copied()
                        .find(|&c| Excluded::name_eq(comp, name_of(c as usize)))
                    {
                        Some(c) => cur = c,
                        None => {
                            ok = false;
                            break;
                        }
                    }
                }
                if ok && cur != root {
                    excluded_ids.insert(cur);
                }
            }
        }

        // 2. reachable nodes in pre-order
        let mut order: Vec<u32> = Vec::with_capacity(total + 1);
        let mut stack: Vec<u32> = vec![root];
        while let Some(id) = stack.pop() {
            order.push(id);
            let (s, e) = (child_start[id as usize] as usize, child_start[id as usize + 1] as usize);
            if excluded.is_empty() {
                stack.extend_from_slice(&children[s..e]);
            } else {
                for &c in &children[s..e] {
                    if excluded_ids.contains(&c) || excluded.matches_name(name_of(c as usize)) {
                        continue;
                    }
                    stack.push(c);
                }
            }
        }

        let mut new_flags = vec![0u8; n];
        for &id in &order {
            new_flags[id as usize] = (flags[id as usize] & F_DIR) | F_USED;
        }

        // 3. protected flag, inherited down the tree
        for &id in &order {
            let i = id as usize;
            let prot = if id == root {
                crate::utils::protected_path::is_protected_path(Path::new(&root_path))
            } else {
                new_flags[parent[i] as usize] & F_PROT != 0 || is_protected_name(name_of(i))
            };
            if prot {
                new_flags[i] |= F_PROT;
            }
        }

        // 4. categories (parallel)
        let cat: Vec<u8> = (0..n)
            .into_par_iter()
            .map(|i| {
                let f = new_flags[i];
                if f & F_USED != 0 && f & F_DIR == 0 {
                    categorize_name(name_of(i)) as u8
                } else {
                    OTHER_CAT
                }
            })
            .collect();

        // 5. aggregate sizes bottom-up
        let mut file_count = vec![0u32; n];
        let mut cat_totals = [0u64; FileCategory::COUNT];
        for &id in &order {
            let i = id as usize;
            if new_flags[i] & F_DIR != 0 {
                size[i] = 0;
                alloc[i] = 0;
            } else {
                file_count[i] = 1;
                cat_totals[cat[i] as usize] += size[i];
            }
        }
        for &id in order.iter().rev() {
            let i = id as usize;
            if id == root {
                continue;
            }
            let p = parent[i] as usize;
            size[p] += size[i];
            alloc[p] += alloc[i];
            file_count[p] += file_count[i];
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("Scan cancelled".to_string());
        }

        // 6. sort every child list by size (largest first), in parallel
        {
            let mut slices: Vec<&mut [u32]> = Vec::new();
            let mut rest: &mut [u32] = &mut children[..];
            for id in 0..n {
                let len = (child_start[id + 1] - child_start[id]) as usize;
                let (a, b) = rest.split_at_mut(len);
                rest = b;
                if len > 1 {
                    slices.push(a);
                }
            }
            let sz = &size;
            slices
                .par_iter_mut()
                .for_each(|s| s.sort_unstable_by(|a, b| sz[*b as usize].cmp(&sz[*a as usize])));
        }

        Ok(Self {
            parent,
            size,
            alloc,
            file_count,
            mtime,
            flags: new_flags,
            cat,
            name_off,
            name_len,
            names,
            child_start,
            children,
            root,
            root_path,
            cat_totals,
            generation: NEXT_GENERATION.fetch_add(1, Ordering::Relaxed),
            engine: Engine::Walker,
            excluded: excluded.clone(),
            mft_meta,
            deltas: None,
            prev_snapshot_time: None,
            prev_snapshot_origin: 0,
        })
    }

    // ---------- metadata carried across rebuilds ----------

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn engine(&self) -> Engine {
        self.engine
    }

    pub fn set_engine(&mut self, e: Engine) {
        self.engine = e;
    }

    pub fn excluded(&self) -> &Excluded {
        &self.excluded
    }

    pub fn mft_meta(&self) -> Option<&MftMeta> {
        self.mft_meta.as_ref()
    }

    pub fn root_path(&self) -> &str {
        &self.root_path
    }

    pub fn set_deltas(&mut self, deltas: Vec<i64>, prev_time: u64, prev_origin: u8) {
        self.deltas = Some(deltas);
        self.prev_snapshot_time = Some(prev_time);
        self.prev_snapshot_origin = prev_origin;
    }

    /// `(timestamp, origin)` of the snapshot the deltas are relative to.
    pub fn prev_snapshot(&self) -> Option<(u64, u8)> {
        self.prev_snapshot_time.map(|t| (t, self.prev_snapshot_origin))
    }

    pub fn has_deltas(&self) -> bool {
        self.deltas.is_some()
    }

    /// Size change since the previous snapshot (non-zero only).
    pub fn delta(&self, id: u32) -> Option<i64> {
        self.deltas
            .as_ref()
            .and_then(|d| d.get(id as usize))
            .copied()
            .filter(|&d| d != 0)
    }

    /// Takes the columns back out of the arena so they can be patched and rebuilt.
    /// Removed nodes keep flags 0; ids are never reindexed.
    pub fn into_raw(self) -> (RawScan, ArenaMeta) {
        let meta = ArenaMeta {
            engine: self.engine,
            excluded: self.excluded,
            prev_snapshot_time: self.prev_snapshot_time,
            prev_snapshot_origin: self.prev_snapshot_origin,
        };
        let flags: Vec<u8> = self.flags.iter().map(|f| f & (F_DIR | F_USED)).collect();
        (
            RawScan {
                parent: self.parent,
                size: self.size,
                alloc: self.alloc,
                mtime: self.mtime,
                flags,
                name_off: self.name_off,
                name_len: self.name_len,
                names: self.names,
                root: self.root,
                root_path: self.root_path,
                mft_meta: self.mft_meta,
            },
            meta,
        )
    }

    /// Rebuilds an arena from patched raw columns and re-applies the carried metadata.
    /// Deltas are dropped (ids and sizes changed); callers recompute them.
    pub fn from_raw_with_meta(raw: RawScan, meta: ArenaMeta, cancel: &AtomicBool) -> Result<Self, String> {
        let mut a = Self::build(raw, cancel, &meta.excluded)?;
        a.engine = meta.engine;
        a.prev_snapshot_time = meta.prev_snapshot_time;
        a.prev_snapshot_origin = meta.prev_snapshot_origin;
        Ok(a)
    }

    /// Replaces everything below directory `target` with the freshly scanned `sub` (whose root
    /// stands in for `target`). `target` keeps its id; old descendants are retired and new
    /// entries are appended, so ids of untouched nodes never change. Sizes are re-aggregated and
    /// deltas are dropped (callers recompute them).
    pub fn replace_subtree(&mut self, target: u32, sub: RawScan, cancel: &AtomicBool) -> Result<(), String> {
        if !self.is_used(target) || !self.is_dir(target) {
            return Err("Not a folder in this scan".to_string());
        }
        let mut old: Vec<u32> = Vec::new();
        let mut stack: Vec<u32> = self.live_children(target).collect();
        while let Some(id) = stack.pop() {
            old.push(id);
            if self.is_dir(id) {
                stack.extend(self.live_children(id));
            }
        }

        let this = std::mem::take(self);
        let (mut raw, mut meta) = this.into_raw();
        for id in old {
            raw.flags[id as usize] = 0;
        }
        // Appended ids no longer line up with MFT record numbers, so the journal can't be replayed.
        raw.mft_meta = None;
        if target == raw.root {
            meta.engine = Engine::Walker;
        }

        let sroot = sub.root as usize;
        let mut map = vec![NONE; sub.parent.len()];
        map[sroot] = target;
        let mut next = raw.parent.len() as u32;
        for i in 0..sub.parent.len() {
            if i != sroot && sub.flags[i] & F_USED != 0 {
                map[i] = next;
                next += 1;
            }
        }
        let extra = (next as usize) - raw.parent.len();
        raw.parent.reserve(extra);
        raw.size.reserve(extra);
        raw.alloc.reserve(extra);
        raw.mtime.reserve(extra);
        raw.flags.reserve(extra);
        raw.name_off.reserve(extra);
        raw.name_len.reserve(extra);
        for i in 0..sub.parent.len() {
            if i == sroot || sub.flags[i] & F_USED == 0 {
                continue;
            }
            let p = map[sub.parent[i] as usize];
            raw.parent.push(p);
            raw.size.push(sub.size[i]);
            raw.alloc.push(sub.alloc[i]);
            raw.mtime.push(sub.mtime[i]);
            // A parent that was skipped by the scan leaves the node unreachable; build drops it.
            raw.flags.push(if p == NONE { 0 } else { sub.flags[i] & (F_DIR | F_USED) });
            raw.name_off.push(raw.names.len() as u32);
            raw.name_len.push(sub.name_len[i]);
            let (o, l) = (sub.name_off[i] as usize, sub.name_len[i] as usize);
            raw.names.extend_from_slice(&sub.names[o..o + l]);
        }
        let t = target as usize;
        if sub.mtime[sroot] > 0 {
            raw.mtime[t] = sub.mtime[sroot];
        }
        *self = Self::from_raw_with_meta(raw, meta, cancel)?;
        Ok(())
    }

    // ---------- basic accessors ----------

    pub fn root_id(&self) -> u32 {
        self.root
    }

    pub fn len(&self) -> usize {
        self.parent.len()
    }

    pub fn is_used(&self, id: u32) -> bool {
        self.flags[id as usize] & F_USED != 0
    }

    pub fn is_dir(&self, id: u32) -> bool {
        self.flags[id as usize] & F_DIR != 0
    }

    pub fn is_protected(&self, id: u32) -> bool {
        self.flags[id as usize] & F_PROT != 0
    }

    pub fn size(&self, id: u32) -> u64 {
        self.size[id as usize]
    }

    pub fn alloc_size(&self, id: u32) -> u64 {
        self.alloc[id as usize]
    }

    pub fn file_count(&self, id: u32) -> u64 {
        self.file_count[id as usize] as u64
    }

    pub fn mtime(&self, id: u32) -> Option<u64> {
        let m = self.mtime[id as usize];
        if m > 0 {
            Some(m as u64)
        } else {
            None
        }
    }

    pub fn category(&self, id: u32) -> FileCategory {
        FileCategory::from_u8(self.cat[id as usize])
    }

    pub fn cat_totals(&self) -> &[u64; FileCategory::COUNT] {
        &self.cat_totals
    }

    pub fn name(&self, id: u32) -> &str {
        let o = self.name_off[id as usize] as usize;
        let l = self.name_len[id as usize] as usize;
        std::str::from_utf8(&self.names[o..o + l]).unwrap_or("")
    }

    pub fn display_name(&self, id: u32) -> String {
        if id == self.root {
            let t = self.root_path.trim_end_matches('\\');
            match t.rsplit('\\').next() {
                Some(last) if !last.is_empty() && t.len() > 2 => last.to_string(),
                _ => self.root_path.clone(),
            }
        } else {
            self.name(id).to_string()
        }
    }

    pub fn parent_of(&self, id: u32) -> u32 {
        if id == self.root {
            NONE
        } else {
            self.parent[id as usize]
        }
    }

    /// Raw child slice (sorted by size desc). May include removed nodes; use `live_children`.
    fn child_slice(&self, id: u32) -> &[u32] {
        let i = id as usize;
        &self.children[self.child_start[i] as usize..self.child_start[i + 1] as usize]
    }

    pub fn live_children(&self, id: u32) -> impl Iterator<Item = u32> + '_ {
        self.child_slice(id)
            .iter()
            .copied()
            .filter(move |&c| self.flags[c as usize] & F_USED != 0)
    }

    pub fn full_path(&self, id: u32) -> String {
        if id == self.root {
            return self.root_path.clone();
        }
        let mut parts: Vec<&str> = Vec::new();
        let mut cur = id;
        while cur != self.root && cur != NONE {
            parts.push(self.name(cur));
            cur = self.parent[cur as usize];
        }
        let mut s = self.root_path.clone();
        for p in parts.iter().rev() {
            if !s.ends_with('\\') {
                s.push('\\');
            }
            s.push_str(p);
        }
        s
    }

    pub fn resolve_path(&self, path: &str) -> Result<u32, String> {
        let key = norm_key(path);
        let root_key = norm_key(&self.root_path);
        if key == root_key {
            return Ok(self.root);
        }
        let rest = key
            .strip_prefix(&root_key)
            .and_then(|r| r.strip_prefix('\\'))
            .ok_or_else(|| format!("Path not in scan: {}", path))?;
        let mut cur = self.root;
        for comp in rest.split('\\').filter(|c| !c.is_empty()) {
            let found = self
                .live_children(cur)
                .find(|&c| name_eq(self.name(c), comp));
            cur = found.ok_or_else(|| format!("Path not in scan: {}", path))?;
        }
        Ok(cur)
    }

    // ---------- DTO conversion ----------

    fn leaf_dto(&self, id: u32, path: String) -> ScanNode {
        ScanNode {
            name: self.display_name(id),
            path,
            size: self.size(id),
            alloc: self.alloc_size(id),
            is_dir: self.is_dir(id),
            children: Vec::new(),
            file_count: self.file_count(id),
            category: self.category(id),
            last_modified: self.mtime(id),
            protected: self.is_protected(id),
            delta: self.delta(id),
        }
    }

    fn dto_with_path(&self, id: u32, path: String, depth: u32, level: u32) -> ScanNode {
        let mut node = self.leaf_dto(id, path);
        if depth == 0 || !node.is_dir {
            return node;
        }
        let limit = if level == 0 { TOP_LIMIT } else { NESTED_LIMIT };
        let mut kids: Vec<ScanNode> = Vec::new();
        let (mut o_n, mut o_size, mut o_alloc, mut o_fc) = (0u32, 0u64, 0u64, 0u64);
        for c in self.live_children(id) {
            if kids.len() < limit {
                let cp = join_path(&node.path, self.name(c));
                kids.push(self.dto_with_path(c, cp, depth - 1, level + 1));
            } else {
                o_n += 1;
                o_size += self.size(c);
                o_alloc += self.alloc_size(c);
                o_fc += self.file_count(c);
            }
        }
        if o_n > 0 {
            kids.push(Self::others_node(&node.path, o_n, o_size, o_alloc, o_fc));
        }
        node.children = kids;
        node
    }

    fn others_node(parent_path: &str, n: u32, size: u64, alloc: u64, fc: u64) -> ScanNode {
        ScanNode {
            name: format!("({} others)", n),
            path: join_path(parent_path, &format!("(.space-analyzer-{}-others)", n)),
            size,
            alloc,
            is_dir: false,
            children: Vec::new(),
            file_count: fc,
            category: FileCategory::Other,
            last_modified: None,
            protected: false,
            delta: None,
        }
    }

    /// Pruned nested tree for the treemap. Breadth-first so the budget goes to the biggest
    /// blocks at every level; children below `min_size` (or past the budget) are grouped into
    /// one "(N others)" node per folder. `use_alloc` ranks and prunes by size on disk.
    pub fn treemap(&self, id: u32, max_depth: u32, min_size: u64, max_nodes: usize, use_alloc: bool) -> ScanNode {
        struct Tmp {
            id: u32,
            kids: Vec<usize>,
            others: (u32, u64, u64, u64),
        }
        let metric = |c: u32| if use_alloc { self.alloc_size(c) } else { self.size(c) };
        let mut tmp = vec![Tmp { id, kids: Vec::new(), others: (0, 0, 0, 0) }];
        let mut queue = std::collections::VecDeque::from([(0usize, 0u32)]);
        while let Some((ti, depth)) = queue.pop_front() {
            let nid = tmp[ti].id;
            if depth >= max_depth || !self.is_dir(nid) {
                continue;
            }
            for c in self.live_children(nid) {
                if tmp.len() < max_nodes && metric(c) >= min_size && metric(c) > 0 {
                    let k = tmp.len();
                    tmp.push(Tmp { id: c, kids: Vec::new(), others: (0, 0, 0, 0) });
                    tmp[ti].kids.push(k);
                    queue.push_back((k, depth + 1));
                } else {
                    let o = &mut tmp[ti].others;
                    o.0 += 1;
                    o.1 += self.size(c);
                    o.2 += self.alloc_size(c);
                    o.3 += self.file_count(c);
                }
            }
        }
        fn conv(a: &ScanArena, tmp: &[Tmp], ti: usize, path: String) -> ScanNode {
            let t = &tmp[ti];
            let mut node = a.leaf_dto(t.id, path);
            for &k in &t.kids {
                let kp = join_path(&node.path, a.name(tmp[k].id));
                node.children.push(conv(a, tmp, k, kp));
            }
            if t.others.0 > 0 {
                node.children.push(ScanArena::others_node(&node.path, t.others.0, t.others.1, t.others.2, t.others.3));
            }
            node
        }
        conv(self, &tmp, 0, self.full_path(id))
    }
    pub fn node_to_scan(&self, id: u32, child_depth: u32) -> ScanNode {
        self.dto_with_path(id, self.full_path(id), child_depth, 0)
    }

    pub fn root_shallow(&self, child_depth: u32) -> ScanNode {
        self.node_to_scan(self.root, child_depth)
    }

    pub fn get_node_info(&self, path: &str) -> Result<ScanNode, String> {
        let id = self.resolve_path(path)?;
        Ok(self.node_to_scan(id, 0))
    }

    pub fn children_as_scan(&self, path: &str, each_depth: u32) -> Result<Vec<ScanNode>, String> {
        let id = self.resolve_path(path)?;
        let parent_path = self.full_path(id);
        let mut out = Vec::new();
        let (mut o_n, mut o_size, mut o_alloc, mut o_fc) = (0u32, 0u64, 0u64, 0u64);
        for c in self.live_children(id) {
            if out.len() < TOP_LIMIT {
                let cp = join_path(&parent_path, self.name(c));
                out.push(self.dto_with_path(c, cp, each_depth, 1));
            } else {
                o_n += 1;
                o_size += self.size(c);
                o_alloc += self.alloc_size(c);
                o_fc += self.file_count(c);
            }
        }
        if o_n > 0 {
            out.push(Self::others_node(&parent_path, o_n, o_size, o_alloc, o_fc));
        }
        Ok(out)
    }

    /// Full subtree DTO (can be huge; only for small subtrees).
    pub fn subtree_full(&self, id: u32) -> ScanNode {
        fn rec(a: &ScanArena, id: u32, path: String) -> ScanNode {
            let mut node = a.leaf_dto(id, path);
            if node.is_dir {
                node.children = a
                    .live_children(id)
                    .map(|c| rec(a, c, join_path(&node.path, a.name(c))))
                    .collect();
            }
            node
        }
        rec(self, id, self.full_path(id))
    }

    // ---------- mutation ----------

    /// Detach a node (after it was deleted on disk) and fix ancestor totals.
    pub fn remove_node(&mut self, id: u32) -> Result<(), String> {
        if id == self.root {
            return Err("Cannot remove scan root".to_string());
        }
        if !self.is_used(id) {
            return Ok(());
        }
        let (size, alloc, fc) = (self.size[id as usize], self.alloc[id as usize], self.file_count[id as usize]);

        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            let i = cur as usize;
            if self.flags[i] & F_DIR == 0 {
                let c = self.cat[i] as usize;
                self.cat_totals[c] = self.cat_totals[c].saturating_sub(self.size[i]);
            } else {
                let (s, e) = (self.child_start[i] as usize, self.child_start[i + 1] as usize);
                stack.extend_from_slice(&self.children[s..e]);
            }
            self.flags[i] &= !F_USED;
        }

        let mut cur = self.parent[id as usize];
        while cur != NONE {
            let i = cur as usize;
            self.size[i] = self.size[i].saturating_sub(size);
            self.alloc[i] = self.alloc[i].saturating_sub(alloc);
            self.file_count[i] = self.file_count[i].saturating_sub(fc);
            if cur == self.root {
                break;
            }
            cur = self.parent[i];
        }
        Ok(())
    }

    pub fn remove_path(&mut self, path: &str) -> Result<(), String> {
        let id = self.resolve_path(path)?;
        self.remove_node(id)
    }

    // ---------- persistence (snapshots; the SAH2 header lives in `snapshot.rs`) ----------

    /// Writes a compact binary body (file sizes only; directory sizes are re-aggregated on load).
    pub fn write_snapshot_body<W: Write>(&self, w: &mut W) -> std::io::Result<()> {
        let mut order: Vec<u32> = Vec::new();
        let mut stack = vec![self.root];
        while let Some(id) = stack.pop() {
            order.push(id);
            let mut kids: Vec<u32> = self.live_children(id).collect();
            kids.reverse();
            stack.extend(kids);
        }
        let mut newidx = vec![NONE; self.len()];
        for (i, &id) in order.iter().enumerate() {
            newidx[id as usize] = i as u32;
        }
        let rp = self.root_path.as_bytes();
        w.write_all(&(rp.len() as u32).to_le_bytes())?;
        w.write_all(rp)?;
        w.write_all(&(order.len() as u32).to_le_bytes())?;
        for &id in &order {
            let i = id as usize;
            let p = if id == self.root { NONE } else { newidx[self.parent[i] as usize] };
            let name = if id == self.root { &[][..] } else { self.name(id).as_bytes() };
            let is_dir = self.flags[i] & F_DIR != 0;
            w.write_all(&p.to_le_bytes())?;
            w.write_all(&[self.flags[i] & F_DIR])?;
            w.write_all(&self.mtime[i].to_le_bytes())?;
            w.write_all(&(if is_dir { 0 } else { self.size[i] }).to_le_bytes())?;
            w.write_all(&(if is_dir { 0 } else { self.alloc[i] }).to_le_bytes())?;
            w.write_all(&(name.len() as u16).to_le_bytes())?;
            w.write_all(name)?;
        }
        Ok(())
    }

    pub fn read_snapshot_body<R: Read>(r: &mut R, cancel: &AtomicBool) -> Result<Self, String> {
        fn rd<const N: usize, R: Read>(r: &mut R) -> Result<[u8; N], String> {
            let mut b = [0u8; N];
            r.read_exact(&mut b).map_err(|e| e.to_string())?;
            Ok(b)
        }
        let rp_len = u32::from_le_bytes(rd::<4, _>(r)?) as usize;
        let mut rp = vec![0u8; rp_len];
        r.read_exact(&mut rp).map_err(|e| e.to_string())?;
        let root_path = String::from_utf8_lossy(&rp).into_owned();
        let n = u32::from_le_bytes(rd::<4, _>(r)?) as usize;
        let mut raw = RawScan {
            parent: Vec::with_capacity(n),
            size: Vec::with_capacity(n),
            alloc: Vec::with_capacity(n),
            mtime: Vec::with_capacity(n),
            flags: Vec::with_capacity(n),
            name_off: Vec::with_capacity(n),
            name_len: Vec::with_capacity(n),
            names: Vec::new(),
            root: 0,
            root_path,
            mft_meta: None,
        };
        for _ in 0..n {
            raw.parent.push(u32::from_le_bytes(rd::<4, _>(r)?));
            raw.flags.push(rd::<1, _>(r)?[0] | F_USED);
            raw.mtime.push(u32::from_le_bytes(rd::<4, _>(r)?));
            raw.size.push(u64::from_le_bytes(rd::<8, _>(r)?));
            raw.alloc.push(u64::from_le_bytes(rd::<8, _>(r)?));
            let l = u16::from_le_bytes(rd::<2, _>(r)?) as usize;
            raw.name_off.push(raw.names.len() as u32);
            raw.name_len.push(l as u16);
            let start = raw.names.len();
            raw.names.resize(start + l, 0);
            r.read_exact(&mut raw.names[start..]).map_err(|e| e.to_string())?;
        }
        Self::build(raw, cancel, &Excluded::default())
    }

    pub fn total_size(&self) -> u64 {
        self.size[self.root as usize]
    }

    pub fn total_files(&self) -> u64 {
        self.file_count[self.root as usize] as u64
    }
}

impl Default for ScanArena {
    fn default() -> Self {
        Self {
            parent: Vec::new(),
            size: Vec::new(),
            alloc: Vec::new(),
            file_count: Vec::new(),
            mtime: Vec::new(),
            flags: Vec::new(),
            cat: Vec::new(),
            name_off: Vec::new(),
            name_len: Vec::new(),
            names: Vec::new(),
            child_start: vec![0],
            children: Vec::new(),
            root: NONE,
            root_path: String::new(),
            cat_totals: [0; FileCategory::COUNT],
            generation: 0,
            engine: Engine::Walker,
            excluded: Excluded::default(),
            mft_meta: None,
            deltas: None,
            prev_snapshot_time: None,
            prev_snapshot_origin: 0,
        }
    }
}

/// Metadata that survives `into_raw` / `from_raw_with_meta`.
pub struct ArenaMeta {
    pub engine: Engine,
    pub excluded: Excluded,
    pub prev_snapshot_time: Option<u64>,
    pub prev_snapshot_origin: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// entries: (name, parent, is_dir, size)
    fn raw(entries: &[(&str, u32, bool, u64)], root_path: &str) -> RawScan {
        let mut r = RawScan {
            parent: vec![],
            size: vec![],
            alloc: vec![],
            mtime: vec![],
            flags: vec![],
            name_off: vec![],
            name_len: vec![],
            names: vec![],
            root: 0,
            root_path: root_path.to_string(),
            mft_meta: None,
        };
        for (name, parent, dir, size) in entries {
            r.parent.push(*parent);
            r.size.push(*size);
            r.alloc.push(*size);
            r.mtime.push(1);
            r.flags.push(F_USED | if *dir { F_DIR } else { 0 });
            r.name_off.push(r.names.len() as u32);
            r.name_len.push(name.len() as u16);
            r.names.extend_from_slice(name.as_bytes());
        }
        r
    }

    #[test]
    fn replace_subtree_splices_and_reaggregates() {
        let cancel = AtomicBool::new(false);
        let base = raw(
            &[("", NONE, true, 0), ("a", 0, true, 0), ("old.bin", 1, false, 10), ("keep.txt", 0, false, 5)],
            r"C:\t",
        );
        let mut arena = ScanArena::build(base, &cancel, &Excluded::default()).unwrap();
        assert_eq!(arena.size(arena.root_id()), 15);

        let sub = raw(&[("", NONE, true, 0), ("n1.bin", 0, false, 7), ("d", 0, true, 0), ("n2.bin", 2, false, 3)], r"C:\t\a");
        let a_id = arena.resolve_path(r"C:\t\a").unwrap();
        arena.replace_subtree(a_id, sub, &cancel).unwrap();

        assert_eq!(arena.resolve_path(r"C:\t\a").unwrap(), a_id);
        assert_eq!(arena.size(a_id), 10);
        assert_eq!(arena.size(arena.root_id()), 15);
        assert!(arena.resolve_path(r"C:\t\a\old.bin").is_err());
        let d = arena.resolve_path(r"C:\t\a\d").unwrap();
        assert_eq!(arena.size(d), 3);
        assert!(arena.resolve_path(r"C:\t\a\d\n2.bin").is_ok());
        assert_eq!(arena.file_count(arena.root_id()), 3);
    }
}