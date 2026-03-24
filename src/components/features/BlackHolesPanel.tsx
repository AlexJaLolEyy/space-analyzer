import { AlertOctagon } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import { motion } from "framer-motion";
import { useMemo } from "react";
import type { ScanNode } from "../../types/scan";

interface BlackHolesPanelProps {
    onClose: () => void;
}

export function BlackHolesPanel({ onClose }: BlackHolesPanelProps) {
    const { scanTree } = useScanStore();

    // Algorithm: folders > 1GB, and rank them by depth and size.
    // For now we don't have true staleness, so we just do depth * size.
    const blackHoles = useMemo(() => {
        if (!scanTree) return [];

        const holes: { node: ScanNode, score: number, depth: number }[] = [];

        const MIN_SIZE = 1024 * 1024 * 1024; // 1 GB

        const traverse = (node: ScanNode, depth: number) => {
            if (node.is_dir && node.size > MIN_SIZE && depth > 3) {
                holes.push({
                    node,
                    depth,
                    score: node.size * depth
                });
            }
            for (const child of node.children) {
                if (child.is_dir) {
                    traverse(child, depth + 1);
                }
            }
        };

        traverse(scanTree, 0);
        return holes.sort((a, b) => b.score - a.score).slice(0, 50);
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
                                <span className="text-sm font-semibold truncate flex-1" title={hole.node.path}>
                                    {hole.node.name}
                                </span>
                                <span className="text-xs bg-purple-500/20 text-purple-500 px-2 py-0.5 rounded font-mono font-medium shrink-0 ml-2">
                                    {formatBytes(hole.node.size)}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="truncate flex-1 mr-2" title={hole.node.path}>
                                    {hole.node.path}
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
