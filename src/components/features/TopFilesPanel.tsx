import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { ArrowUpDown, File, Folder, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCategoryColor } from "../../lib/colors";
import { useFormatBytes } from "../../lib/format";
import { nodeSize, useSizeMode } from "../../lib/nodeSize";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface LargestPanelProps {
    onClose: () => void;
}

type Tab = "files" | "folders";

function parentDir(p: string): string {
    const norm = p.replace(/[/\\]+$/, "");
    const i = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    if (i <= 0) return norm;
    return norm.slice(0, i);
}

/** Largest files and folders of the whole scan. Folders are ranked by their own weight. */
export function TopFilesPanel({ onClose }: LargestPanelProps) {
    const fmt = useFormatBytes();
    const mode = useSizeMode();
    const scanTree = useScanStore((s) => s.scanTree);
    const navigateToAbsolutePath = useScanStore((s) => s.navigateToAbsolutePath);
    const [tab, setTab] = useState<Tab>("files");
    const [query, setQuery] = useState("");
    const [rows, setRows] = useState<Record<Tab, ScanNode[]>>({ files: [], folders: [] });

    useEffect(() => {
        if (!scanTree) {
            setRows({ files: [], folders: [] });
            return;
        }
        let cancelled = false;
        const cmd = tab === "files" ? "get_top_files" : "get_top_folders";
        void (async () => {
            try {
                const res = await invoke<ScanNode[]>(cmd, { n: 100 });
                if (!cancelled) setRows((r) => ({ ...r, [tab]: res }));
            } catch (e) {
                console.error(`${cmd} failed:`, e);
                if (!cancelled) setRows((r) => ({ ...r, [tab]: [] }));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [scanTree, tab]);

    const current = rows[tab];
    const filtered = useMemo(() => {
        const q = query.toLowerCase();
        const list = q ? current.filter((f) => f.name.toLowerCase().includes(q)) : current;
        return mode === "disk" ? [...list].sort((a, b) => b.alloc - a.alloc) : list;
    }, [current, query, mode]);

    const navigateTo = (n: ScanNode) => {
        navigateToAbsolutePath(n.is_dir ? n.path : parentDir(n.path));
        onClose();
    };

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed top-0 right-0 h-full w-96 z-50 flex flex-col glass-strong shadow-2xl border-l border-border"
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
                <div className="flex items-center gap-2">
                    <ArrowUpDown size={17} className="text-primary" />
                    <h2 className="font-bold text-sm">Largest</h2>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <X size={15} />
                </button>
            </div>

            <div className="px-3 pt-3 shrink-0">
                <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
                    {(["files", "folders"] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-3 py-1 rounded-md flex items-center gap-1.5 text-xs font-semibold transition-all ${tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        >
                            {t === "files" ? <File size={13} /> : <Folder size={13} />}
                            {t === "files" ? "Files" : "Folders"}
                        </button>
                    ))}
                </div>
            </div>

            <div className="px-3 py-2 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2 bg-secondary/60 px-3 py-1.5 rounded-lg border border-border/50 focus-within:ring-2 focus-within:ring-ring">
                    <Search size={12} className="text-muted-foreground shrink-0" />
                    <input
                        type="text"
                        placeholder="Filter by name…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="bg-transparent border-none outline-none text-xs w-full"
                    />
                </div>
            </div>

            <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border/40 shrink-0">
                {tab === "files"
                    ? `Showing ${filtered.length} of ${current.length} files, sorted by size`
                    : `Showing ${filtered.length} of ${current.length} folders, ranked by what they hold themselves (size minus their largest subfolder)`}
            </div>

            <div className="flex-1 overflow-y-auto">
                {filtered.map((n, i) => {
                    const color = n.is_dir ? "var(--color-primary)" : getCategoryColor(n.category);
                    return (
                        <button
                            key={n.path}
                            onClick={() => navigateTo(n)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-border/30 hover:bg-muted/50 transition-colors text-left group"
                        >
                            <span className="text-xs text-muted-foreground tabular-nums w-6 shrink-0 text-right">{i + 1}</span>
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate" title={n.name}>
                                    {n.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5" title={n.path}>
                                    {n.path}
                                </p>
                            </div>
                            <span className="text-xs font-semibold shrink-0 tabular-nums" style={{ color }}>
                                {fmt(nodeSize(n, mode))}
                            </span>
                        </button>
                    );
                })}
                {filtered.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground text-sm">Nothing matches.</div>
                )}
            </div>
        </motion.div>
    );
}
