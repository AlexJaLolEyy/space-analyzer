import { motion } from "framer-motion";
import { GaugeChart } from "../ui/GaugeChart";
import { useScanStore } from "../../stores/scanStore";
import { formatBytes } from "../../lib/format";
import { getCategoryColor } from "../../lib/colors";
import { ArrowRight, Box, HardDrive, File, FolderOutput } from "lucide-react";
import type { ScanNode } from "../../types/scan";

interface BentoDashboardProps {
    onExplore: () => void;
}

import { useMemo } from "react";
import type { Variants } from "framer-motion";

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
        },
    },
};

const cardVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 25 } },
};

export function BentoDashboard({ onExplore }: BentoDashboardProps) {
    const { scanTree, selectedDrive } = useScanStore();

    interface ScanStats {
        topTypes: { category: string; size: number }[];
        largestFile: ScanNode | null;
        topDirs: ScanNode[];
    }

    const stats = useMemo<ScanStats | null>(() => {
        if (!scanTree) return null;

        const types: Record<string, number> = {};
        let largest: ScanNode | null = null;

        // Optimized traverse - only go deep if needed or limit total visits
        const traverse = (n: ScanNode, depth: number) => {
            if (!n.is_dir) {
                if (n.size > 0) {
                    types[n.category] = (types[n.category] || 0) + n.size;
                }
                if (!largest || n.size > largest.size) {
                    largest = n;
                }
            }

            // Limit recursion depth for dashboard summary to keep UI responsive
            if (depth < 5) { // Further limit depth for safety
                for (let i = 0; i < n.children.length; i++) {
                    traverse(n.children[i], depth + 1);
                }
            }
        };

        traverse(scanTree, 0);

        const topTypes = Object.entries(types)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([category, size]) => ({ category, size }));

        const topDirs = [...scanTree.children]
            .filter(c => c.is_dir)
            .sort((a, b) => b.size - a.size)
            .slice(0, 3);

        return { topTypes, largestFile: largest, topDirs };
    }, [scanTree]);

    if (!scanTree || !stats) return null;

    const { topTypes, largestFile, topDirs } = stats;
    const totalCapacity = selectedDrive?.total_bytes || (scanTree.size * 1.1);

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex-1 w-full max-w-5xl mx-auto p-6 md:p-8 overflow-y-auto no-scrollbar pb-24"
        >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(140px,auto)]">

                {/* Large Main Status Card */}
                <motion.div variants={cardVariants} className="md:col-span-2 row-span-2 bg-linear-to-br from-background/80 to-secondary/30 border border-border/50 rounded-3xl p-6 shadow-sm flex flex-col justify-between relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />

                    <div>
                        <div className="flex items-center gap-2 text-primary/80 mb-1">
                            <HardDrive size={18} />
                            <h2 className="font-semibold">{selectedDrive?.name || scanTree.name}</h2>
                        </div>
                        <p className="text-3xl font-bold tracking-tight mb-4">Space Used</p>
                    </div>

                    <div className="flex items-center gap-6 mt-auto relative z-10">
                        <GaugeChart used={scanTree.size} total={totalCapacity} />
                        <div className="flex flex-col gap-1">
                            <span className="text-2xl font-bold">{formatBytes(scanTree.size)}</span>
                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                                of {formatBytes(totalCapacity)} capacity
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onExplore();
                        }}
                        className="absolute bottom-6 right-6 z-30 flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-95 transition-all shadow-xl px-5 py-3 rounded-full font-bold cursor-pointer ring-4 ring-primary/10"
                    >
                        Explore Details <ArrowRight size={18} />
                    </button>
                </motion.div>

                {/* Top Directories */}
                <motion.div variants={cardVariants} className="row-span-2 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col space-y-4">
                    <h3 className="font-semibold flex items-center gap-2"><FolderOutput size={16} className="text-primary" /> Top Directories</h3>
                    <div className="flex-1 flex flex-col gap-3">
                        {topDirs.map(dir => (
                            <div key={dir.name} className="flex justify-between items-center text-sm p-2 rounded-lg bg-background/40 border border-border/20">
                                <span className="truncate flex-1 font-medium mr-2" title={dir.name}>{dir.name}</span>
                                <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">{formatBytes(dir.size)}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Top File Types */}
                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col">
                    <h3 className="font-semibold flex items-center gap-2 mb-4"><Box size={16} className="text-primary" /> Space by Type</h3>
                    <div className="space-y-3">
                        {topTypes.map(t => (
                            <div key={t.category} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCategoryColor(t.category as any) }} />
                                    <span className="text-sm">{t.category}</span>
                                </div>
                                <span className="font-mono text-xs">{formatBytes(t.size)}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* File Count */}
                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col justify-center gap-1">
                    <p className="text-sm text-muted-foreground">Total Files Indexed</p>
                    <p className="text-3xl font-bold font-mono tracking-tighter">{scanTree.file_count.toLocaleString()}</p>
                </motion.div>

                {/* Largest Single File */}
                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col justify-center">
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mb-1"><File size={14} /> Largest File</p>
                    {largestFile ? (
                        <>
                            <p className="text-sm font-semibold truncate" title={largestFile.name}>{largestFile.name}</p>
                            <p className="text-xs text-primary font-mono mt-0.5">{formatBytes(largestFile.size)}</p>
                        </>
                    ) : (
                        <p className="text-sm text-muted">No files found</p>
                    )}
                </motion.div>

            </div>
        </motion.div>
    );
}
