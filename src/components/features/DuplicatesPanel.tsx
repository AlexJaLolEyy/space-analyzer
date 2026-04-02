import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Copy, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import { useToastStore } from "../../stores/toastStore";
import { ConfirmModal } from "../ui/ConfirmModal";
import { motion } from "framer-motion";

interface DuplicateFile {
    name: string;
    path: string;
}

interface DuplicateGroup {
    content_hash: string;
    size: number;
    files: DuplicateFile[];
    total_wasted: number;
}

interface DuplicateProgressPayload {
    phase: string;
    processed: number;
    total: number;
}

interface DuplicatesPanelProps {
    onClose: () => void;
}

export function DuplicatesPanel({ onClose }: DuplicatesPanelProps) {
    const { scanTree, removeNode } = useScanStore();
    const { addToast } = useToastStore();
    const [groups, setGroups] = useState<DuplicateGroup[]>([]);
    const [scanEverRun, setScanEverRun] = useState(false);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<DuplicateProgressPayload | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [quickScan, setQuickScan] = useState(true);
    const [deleteConfig, setDeleteConfig] = useState<{
        mode: "recycle" | "permanent";
        open: boolean;
        targets: string[];
    }>({ mode: "recycle", open: false, targets: [] });
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        setScanEverRun(false);
        setGroups([]);
    }, [scanTree]);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        listen<DuplicateProgressPayload>("duplicate-progress", (e) => {
            setProgress(e.payload);
        })
            .then((u) => {
                unlisten = u;
            })
            .catch(() => {});
        return () => {
            unlisten?.();
        };
    }, []);

    const runScan = useCallback(async () => {
        if (!scanTree) return;
        setLoading(true);
        setProgress(null);
        setGroups([]);
        try {
            const res = await invoke<DuplicateGroup[]>("find_duplicates", { scanTree, quickScan });
            setGroups(res);
            setScanEverRun(true);
        } catch (err) {
            console.error(err);
            const msg = String(err);
            if (msg.includes("cancelled")) {
                addToast("info", "Duplicate scan cancelled");
            } else {
                addToast("error", `Duplicate scan failed: ${err}`);
            }
        } finally {
            setLoading(false);
            setProgress(null);
        }
    }, [scanTree, quickScan, addToast]);

    const cancelScan = useCallback(async () => {
        try {
            await invoke("cancel_duplicate_scan");
        } catch (e) {
            console.error(e);
        }
    }, []);

    const filteredGroups = groups.filter((g) =>
        g.files.some((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const totalWasted = groups.reduce((acc, g) => acc + g.total_wasted, 0);

    const handleKeepBest = (group: DuplicateGroup) => {
        const toDelete = group.files.slice(1).map((f) => f.path);
        setDeleteConfig({ mode: "recycle", open: true, targets: toDelete });
    };

    const confirmDelete = async () => {
        setIsDeleting(true);
        try {
            await invoke("delete_items", { paths: deleteConfig.targets, permanent: deleteConfig.mode === "permanent" });
            addToast("success", `Successfully processed duplicates`);

            for (const path of deleteConfig.targets) {
                removeNode(path);
            }
            setGroups((prev) =>
                prev
                    .map((g) => ({
                        ...g,
                        files: g.files.filter((f) => !deleteConfig.targets.includes(f.path)),
                    }))
                    .filter((g) => g.files.length > 1)
            );
        } catch (err) {
            console.error(err);
            addToast("error", `Failed to delete items: ${err}`);
        } finally {
            setIsDeleting(false);
            setDeleteConfig({ ...deleteConfig, open: false, targets: [] });
        }
    };

    const progressLabel =
        progress && progress.total > 0
            ? progress.phase === "full_hash"
                ? `Full hash ${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
                : `Partial hash ${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
            : null;

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-125 border-l border-border bg-popover/90 backdrop-blur-xl shadow-2xl flex flex-col z-30"
        >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <Copy className="text-amber-500 shrink-0" size={20} />
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Duplicate Files</h2>
                        <p className="text-xs text-muted-foreground">
                            {groups.length} groups · {formatBytes(totalWasted)} total wasted
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                >
                    <Trash2 size={20} className="hidden" />
                    ✕
                </button>
            </div>

            <div className="px-4 py-3 border-b border-border/50 shrink-0 bg-background/50 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scan mode</span>
                    <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                        <button
                            type="button"
                            onClick={() => setQuickScan(true)}
                            className={`px-3 py-1.5 transition-colors ${quickScan ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"
                                }`}
                        >
                            Quick
                        </button>
                        <button
                            type="button"
                            onClick={() => setQuickScan(false)}
                            className={`px-3 py-1.5 transition-colors ${!quickScan ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"
                                }`}
                        >
                            Deep
                        </button>
                    </div>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    Deep: size → partial → full SHA-256. Quick: name+size → partial → full (fewer reads, misses renamed dupes).
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        disabled={!scanTree || loading}
                        onClick={() => void runScan()}
                        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
                    >
                        Run scan
                    </button>
                    <button
                        type="button"
                        disabled={!loading}
                        onClick={() => void cancelScan()}
                        className="px-3 py-2 rounded-lg border border-border bg-secondary text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                    >
                        Cancel
                    </button>
                </div>
                <div className="relative w-full flex items-center">
                    <Search className="absolute left-3 text-muted-foreground" size={16} />
                    <input
                        type="text"
                        placeholder="Search duplicates..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-secondary/80 border border-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all font-mono placeholder:font-sans"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span>Analyzing files…</span>
                        {progressLabel && <span className="text-xs font-mono text-center px-2">{progressLabel}</span>}
                    </div>
                ) : !scanTree ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 text-sm text-center px-4">
                        Run a disk scan first, then use Run scan to find duplicates.
                    </div>
                ) : !scanEverRun ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <Copy size={48} className="opacity-20" />
                        <p className="text-sm">Ready to scan</p>
                        <p className="text-xs text-center px-4">Choose Quick or Deep, then Run scan.</p>
                    </div>
                ) : groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <Copy size={48} className="opacity-20" />
                        <p>No duplicates found.</p>
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <p>No duplicates match your search.</p>
                    </div>
                ) : (
                    filteredGroups.map((group, idx) => (
                        <div key={`${group.content_hash}-${idx}`} className="bg-secondary/50 border border-border rounded-xl flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between p-3 bg-secondary/80 border-b border-border gap-2">
                                <div className="min-w-0 flex-1">
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">SHA-256</p>
                                    <span className="text-xs font-mono truncate block" title={group.content_hash}>
                                        {group.content_hash}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded font-mono font-medium whitespace-nowrap">
                                        {formatBytes(group.size)} each
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleKeepBest(group)}
                                        className="px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs rounded transition-colors font-medium"
                                    >
                                        Keep Best
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-col">
                                {group.files.map((f, i) => (
                                    <div
                                        key={i}
                                        className="flex px-3 py-2 border-b border-border/50 last:border-0 bg-background/30 hover:bg-background/80 transition-colors text-xs items-center justify-between group/file"
                                    >
                                        <span className="font-mono text-muted-foreground truncate" title={f.path}>
                                            {f.path}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setDeleteConfig({ mode: "recycle", open: true, targets: [f.path] })
                                            }
                                            className="opacity-0 group-hover/file:opacity-100 p-1 text-destructive hover:bg-destructive/10 rounded transition-all"
                                            title="Delete this file"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <ConfirmModal
                isOpen={deleteConfig.open}
                title="Move Duplicates to Recycle Bin?"
                message={`Are you sure you want to move ${deleteConfig.targets.length} file(s) to the Recycle Bin?`}
                confirmLabel="Move to Bin"
                variant="warning"
                isLoading={isDeleting}
                onConfirm={confirmDelete}
                onCancel={() => setDeleteConfig({ ...deleteConfig, open: false })}
            />
        </motion.div>
    );
}
