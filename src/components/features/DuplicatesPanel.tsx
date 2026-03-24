import { invoke } from "@tauri-apps/api/core";
import { Copy, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
    hash: string;
    size: number;
    files: DuplicateFile[];
    total_wasted: number;
}

interface DuplicatesPanelProps {
    onClose: () => void;
}

export function DuplicatesPanel({ onClose }: DuplicatesPanelProps) {
    const { scanTree, removeNode } = useScanStore();
    const { addToast } = useToastStore();
    const [groups, setGroups] = useState<DuplicateGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [deleteConfig, setDeleteConfig] = useState<{ mode: "recycle" | "permanent"; open: boolean, targets: string[] }>({ mode: "recycle", open: false, targets: [] });
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (!scanTree) return;
        invoke<DuplicateGroup[]>("find_duplicates", { scanTree })
            .then((res) => setGroups(res))
            .catch((err) => console.error(err))
            .finally(() => setLoading(false));
    }, [scanTree]);

    const filteredGroups = groups.filter((g) =>
        g.files.some((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const totalWasted = groups.reduce((acc, g) => acc + g.total_wasted, 0);

    const handleKeepBest = (group: DuplicateGroup) => {
        // Keep the first one (usually the shortest path or whatever)
        const toDelete = group.files.slice(1).map((f) => f.path);
        setDeleteConfig({ mode: "recycle", open: true, targets: toDelete });
    };

    const confirmDelete = async () => {
        setIsDeleting(true);
        try {
            await invoke("delete_items", { paths: deleteConfig.targets, permanent: deleteConfig.mode === "permanent" });
            addToast("success", `Successfully processed duplicates`);

            // Remove from local scan tree
            for (const path of deleteConfig.targets) {
                removeNode(path);
            }
            // Remove from local groups state
            setGroups((prev) =>
                prev.map(g => ({
                    ...g,
                    files: g.files.filter(f => !deleteConfig.targets.includes(f.path))
                })).filter(g => g.files.length > 1)
            );

        } catch (err) {
            console.error(err);
            addToast("error", `Failed to delete items: ${err}`);
        } finally {
            setIsDeleting(false);
            setDeleteConfig({ ...deleteConfig, open: false, targets: [] });
        }
    };

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
                    onClick={onClose}
                    className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                >
                    <Trash2 size={20} className="hidden" />
                    ✕
                </button>
            </div>

            <div className="p-3 border-b border-border/50 shrink-0 bg-background/50">
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
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                        <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
                        Analyzing files...
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <Copy size={48} className="opacity-20" />
                        <p>No duplicates found.</p>
                    </div>
                ) : (
                    filteredGroups.map((group, idx) => (
                        <div key={idx} className="bg-secondary/50 border border-border rounded-xl flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between p-3 bg-secondary/80 border-b border-border">
                                <span className="text-sm font-semibold truncate flex-1 mr-2" title={group.hash}>
                                    {group.hash}
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xs bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded font-mono font-medium">
                                        {formatBytes(group.size)} each
                                    </span>
                                    <button
                                        onClick={() => handleKeepBest(group)}
                                        className="px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 text-xs rounded transition-colors font-medium"
                                    >
                                        Keep Best
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-col">
                                {group.files.map((f, i) => (
                                    <div key={i} className="flex px-3 py-2 border-b border-border/50 last:border-0 bg-background/30 hover:bg-background/80 transition-colors text-xs items-center justify-between group/file">
                                        <span className="font-mono text-muted-foreground truncate" title={f.path}>{f.path}</span>
                                        <button
                                            onClick={() => setDeleteConfig({ mode: "recycle", open: true, targets: [f.path] })}
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
