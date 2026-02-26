import { motion } from "framer-motion";
import { ArrowUpDown, FileText, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { getCategoryColor } from "../../lib/colors";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface TopFilesPanelProps {
    onClose: () => void;
}

// Flatten all files recursively from the scan tree
function collectFiles(node: ScanNode, files: ScanNode[] = []): ScanNode[] {
    if (!node.is_dir) {
        files.push(node);
    }
    for (const child of node.children) {
        collectFiles(child, files);
    }
    return files;
}

export function TopFilesPanel({ onClose }: TopFilesPanelProps) {
    const { scanTree, setCurrentPath } = useScanStore();
    const [query, setQuery] = useState("");

    const topFiles = useMemo(() => {
        if (!scanTree) return [];
        const all = collectFiles(scanTree);
        return all
            .sort((a, b) => b.size - a.size)
            .slice(0, 100);
    }, [scanTree]);

    const filtered = useMemo(() => {
        if (!query) return topFiles;
        const q = query.toLowerCase();
        return topFiles.filter(f => f.name.toLowerCase().includes(q));
    }, [topFiles, query]);

    const navigateToFile = (file: ScanNode) => {
        // Navigate to the parent folder of this file
        const parts = file.path.replace(/\\/g, "/").split("/");
        parts.pop(); // remove filename
        const pathSegments = parts.filter(Boolean);
        // Use the root + relative segments
        if (pathSegments.length > 0) {
            setCurrentPath([pathSegments[0] + "\\", ...pathSegments.slice(1)]);
        }
        onClose();
    };

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed top-0 right-0 h-full w-96 z-50 flex flex-col glass shadow-2xl border-l border-border"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
                <div className="flex items-center gap-2">
                    <FileText size={17} className="text-primary" />
                    <h2 className="font-bold text-sm">Top 100 Largest Files</h2>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                    <X size={15} />
                </button>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2 bg-secondary/60 px-3 py-1.5 rounded-lg border border-border/50 focus-within:ring-2 focus-within:ring-ring">
                    <Search size={12} className="text-muted-foreground shrink-0" />
                    <input
                        type="text"
                        placeholder="Filter by name…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="bg-transparent border-none outline-none text-xs w-full"
                    />
                </div>
            </div>

            {/* Stats row */}
            <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/40 flex items-center gap-1 shrink-0">
                <ArrowUpDown size={11} />
                Showing {filtered.length} of {topFiles.length} files, sorted by size
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
                {filtered.map((file, i) => {
                    const color = getCategoryColor(file.category);
                    return (
                        <button
                            key={file.path}
                            onClick={() => navigateToFile(file)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-border/30 hover:bg-muted/50 transition-colors text-left group"
                        >
                            <span className="text-xs text-muted-foreground tabular-nums w-6 shrink-0 text-right">
                                {i + 1}
                            </span>
                            <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate" title={file.name}>
                                    {file.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5" title={file.path}>
                                    {file.path}
                                </p>
                            </div>
                            <span className="text-xs font-semibold shrink-0 tabular-nums" style={{ color }}>
                                {formatBytes(file.size)}
                            </span>
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No files match your filter.
                    </div>
                )}
            </div>
        </motion.div>
    );
}
