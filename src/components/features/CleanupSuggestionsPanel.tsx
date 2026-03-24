import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Sparkles, Trash2, FolderMinus, AlertTriangle } from "lucide-react";
import { useScanStore } from "../../stores/scanStore";
import { formatBytes } from "../../lib/format";
import { invoke } from "@tauri-apps/api/core";
import { useToastStore } from "../../stores/toastStore";
import type { ScanNode } from "../../types/scan";

interface CleanupSuggestionsPanelProps {
    onClose: () => void;
}

interface Suggestion {
    id: string;
    title: string;
    description: string;
    type: "temp" | "cache" | "downloads" | "recycle_bin";
    size: number;
    paths: string[];
}

export function CleanupSuggestionsPanel({ onClose }: CleanupSuggestionsPanelProps) {
    const scanTree = useScanStore(state => state.scanTree);
    const addToast = useToastStore(state => state.addToast);
    const [cleaning, setCleaning] = useState<string | null>(null);

    const suggestions = useMemo(() => {
        if (!scanTree) return [];
        const found: Suggestion[] = [];

        let tempSize = 0;
        let tempPaths: string[] = [];
        let cacheSize = 0;
        let cachePaths: string[] = [];
        let downloadsSize = 0;
        let downloadsPaths: string[] = [];
        let recycleSize = 0;
        let recyclePaths: string[] = [];

        const walk = (node: ScanNode) => {
            const lowerPath = node.path.toLowerCase();

            if (!node.is_dir) return;

            // Temp files
            if (lowerPath.endsWith("\\temp") || lowerPath.endsWith("\\tmp") || lowerPath.includes("\\appdata\\local\\temp")) {
                tempSize += node.size;
                tempPaths.push(node.path);
                return; // Stop walking deeper into temp
            }

            // Cache
            if (lowerPath.includes("\\.cache") || lowerPath.includes("\\.npm") || lowerPath.includes("\\appdata\\local\\google\\chrome\\user data\\default\\cache")) {
                cacheSize += node.size;
                cachePaths.push(node.path);
                return;
            }

            // Downloads
            if (lowerPath.endsWith("\\downloads")) {
                downloadsSize += node.size;
                downloadsPaths.push(node.path);
                // Dont return, keep walking but maybe just track top level
            }

            // Recycle Bin
            if (lowerPath.includes("\\$recycle.bin")) {
                recycleSize += node.size;
                recyclePaths.push(node.path);
                return;
            }

            for (const child of node.children) {
                walk(child);
            }
        };

        walk(scanTree);

        if (tempSize > 0) {
            found.push({
                id: "temp",
                title: "System Temp Files",
                description: "Temporary files created by Windows and applications.",
                type: "temp",
                size: tempSize,
                paths: tempPaths
            });
        }
        if (cacheSize > 0) {
            found.push({
                id: "cache",
                title: "Application Caches",
                description: "Browser and developer tool cache files (.npm, .cache, etc).",
                type: "cache",
                size: cacheSize,
                paths: cachePaths
            });
        }
        if (downloadsSize > 0) {
            found.push({
                id: "downloads",
                title: "User Downloads",
                description: "Your downloads folder might contain old installers or forgotten files.",
                type: "downloads",
                size: downloadsSize,
                paths: downloadsPaths
            });
        }
        if (recycleSize > 0) {
            found.push({
                id: "recycle_bin",
                title: "Recycle Bin",
                description: "Files waiting to be permanently deleted.",
                type: "recycle_bin",
                size: recycleSize,
                paths: recyclePaths
            });
        }

        return found.sort((a, b) => b.size - a.size);
    }, [scanTree]);

    const handleClean = async (suggestion: Suggestion) => {
        setCleaning(suggestion.id);
        try {
            await invoke("delete_items", { paths: suggestion.paths, permanent: false });
            addToast("success", `Cleaned up ${suggestion.title}`);
        } catch (err: any) {
            addToast("error", `Failed to clean ${suggestion.title}: ${err}`);
        } finally {
            setCleaning(null);
        }
    };

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-120 border-l border-border bg-popover/90 backdrop-blur-xl shadow-2xl flex flex-col z-30"
        >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles className="text-primary shrink-0" size={20} />
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Smart Cleanup</h2>
                        <p className="text-xs text-muted-foreground">
                            Suggestions to free up space instantly
                        </p>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground">
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {suggestions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <Sparkles size={48} className="opacity-20" />
                        <p>No obvious cleanup targets found.</p>
                    </div>
                ) : (
                    suggestions.map(s => (
                        <div key={s.id} className="bg-secondary/30 border border-border/50 rounded-2xl p-4 flex flex-col gap-3">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-2">
                                    {s.type === 'temp' && <FolderMinus className="text-orange-500" size={18} />}
                                    {s.type === 'cache' && <FolderMinus className="text-blue-500" size={18} />}
                                    {s.type === 'downloads' && <AlertTriangle className="text-yellow-500" size={18} />}
                                    {s.type === 'recycle_bin' && <Trash2 className="text-emerald-500" size={18} />}
                                    <h3 className="font-semibold">{s.title}</h3>
                                </div>
                                <span className="font-mono text-sm font-bold text-primary">
                                    {formatBytes(s.size)}
                                </span>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                                {s.description}
                            </p>
                            <button
                                onClick={() => handleClean(s)}
                                disabled={cleaning === s.id}
                                className="mt-2 w-full py-2 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {cleaning === s.id ? (
                                    "Cleaning..."
                                ) : (
                                    <>
                                        <Trash2 size={16} /> Clean {formatBytes(s.size)}
                                    </>
                                )}
                            </button>
                        </div>
                    ))
                )}
            </div>
        </motion.div>
    );
}
