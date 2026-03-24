use crate::models::{
    duplicate::{DuplicateFile, DuplicateGroup},
    scan::ScanNode,
};
use std::collections::HashMap;

#[tauri::command]
pub fn find_duplicates(scan_tree: ScanNode) -> Vec<DuplicateGroup> {
    // We will do a fast pass first grouping by (name, size)
    let mut size_map: HashMap<(String, u64), Vec<DuplicateFile>> = HashMap::new();

    fn traverse(node: &ScanNode, size_map: &mut HashMap<(String, u64), Vec<DuplicateFile>>) {
        if !node.is_dir && node.size > 0 {
            let key = (node.name.clone(), node.size);
            size_map
                .entry(key)
                .or_insert_with(Vec::new)
                .push(DuplicateFile {
                    name: node.name.clone(),
                    path: node.path.clone(),
                });
        }
        for child in &node.children {
            traverse(child, size_map);
        }
    }

    traverse(&scan_tree, &mut size_map);

    let mut groups = Vec::new();

    for ((name, size), files) in size_map {
        if files.len() > 1 {
            let wasted = size * (files.len() as u64 - 1);
            groups.push(DuplicateGroup {
                hash: name,
                size,
                files,
                total_wasted: wasted,
            });
        }
    }

    // Sort by most wasted space
    groups.sort_by(|a, b| b.total_wasted.cmp(&a.total_wasted));
    groups
}
