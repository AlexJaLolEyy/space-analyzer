import { invoke } from "@tauri-apps/api/core";
import { AlertOctagon } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface BlackHolesPanelProps {
    onClose: () => void;
}

interface BlackHoleEntry {
    name: string;
    path: string;
    size: number;
    depth: number;
}

export function BlackHolesPanel({ onClose }: BlackHolesPanelProps) {
    const scanTree = useScanStore((s) => s.scanTree);
    const [blackHoles, setBlackHoles] = useState<BlackHoleEntry[]>([]);

    useEffect(() => {
        if (!scanTree) {
            setBlackHoles([]);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const rows = await invoke<BlackHoleEntry[]>("get_black_holes", { limit: 50 });
                if (!cancelled) setBlackHoles(rows);
            } catch (e) {
                console.error("get_black_holes failed:", e);
                if (!cancelled) setBlackHoles([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [scanTree]);

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-112.5 border-l border-border bg-popover/90 backdrop-blur-xl shadow-2xl flex flex-col z-30"
        >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <AlertOctagon className="text-purple-500 shrink-0" size={20} />
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Black Holes</h2>
                        <p className="text-xs text-muted-foreground">
                            Deep, massive folders consuming disk space
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                >
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {blackHoles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <AlertOctagon size={48} className="opacity-20" />
                        <p>No black holes detected.</p>
                    </div>
                ) : (
                    blackHoles.map((hole, idx) => (
                        <div key={idx} className="bg-secondary/50 border border-border rounded-xl p-3 flex flex-col gap-2">
                            <div className="flex items-start justify-between">
                                <span className="text-sm font-semibold truncate flex-1" title={hole.path}>
                                    {hole.name}
                                </span>
                                <span className="text-xs bg-purple-500/20 text-purple-500 px-2 py-0.5 rounded font-mono font-medium shrink-0 ml-2">
                                    {formatBytes(hole.size)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="truncate flex-1 mr-2" title={hole.path}>
                                    {hole.path}
                                </span>
                                <span className="bg-background px-1.5 py-0.5 rounded shrink-0">
                                    Depth: {hole.depth}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </motion.div>
    );
}
