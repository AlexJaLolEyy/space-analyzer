import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRight, Box, File, FolderOutput, HardDrive } from "lucide-react";
import { getCategoryColor } from "../../lib/colors";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";
import { GaugeChart } from "../ui/GaugeChart";
import type { Variants } from "framer-motion";

interface BentoDashboardProps {
    onExplore: () => void;
}

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

interface DashboardStatsPayload {
    top_categories: { category: string; size: number }[];
    largest_file: ScanNode | null;
    top_dirs: ScanNode[];
    total_file_count: number;
    total_size: number;
}

export function BentoDashboard({ onExplore }: BentoDashboardProps) {
    const scanTree = useScanStore((s) => s.scanTree);
    const selectedDrive = useScanStore((s) => s.selectedDrive);
    const [stats, setStats] = useState<DashboardStatsPayload | null>(null);

    useEffect(() => {
        if (!scanTree) {
            setStats(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const data = await invoke<DashboardStatsPayload>("get_dashboard_stats");
                if (!cancelled) setStats(data);
            } catch (e) {
                console.error("get_dashboard_stats failed:", e);
                if (!cancelled) setStats(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [scanTree]);

    if (!scanTree || !stats) return null;

    const { top_categories, largest_file, top_dirs } = stats;
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
                        <GaugeChart used={stats.total_size} total={totalCapacity} />
                        <div className="flex flex-col gap-1">
                            <span className="text-2xl font-bold">{formatBytes(stats.total_size)}</span>
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

                <motion.div variants={cardVariants} className="row-span-2 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                        <FolderOutput size={16} className="text-primary" /> Top Directories
                    </h3>
                    <div className="flex-1 flex flex-col gap-3">
                        {top_dirs.map((dir) => (
                            <div
                                key={dir.path}
                                className="flex justify-between items-center text-sm p-2 rounded-lg bg-background/40 border border-border/20"
                            >
                                <span className="truncate flex-1 font-medium mr-2" title={dir.name}>
                                    {dir.name}
                                </span>
                                <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-0.5 rounded shrink-0">
                                    {formatBytes(dir.size)}
                                </span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col">
                    <h3 className="font-semibold flex items-center gap-2 mb-4">
                        <Box size={16} className="text-primary" /> Space by Type
                    </h3>
                    <div className="space-y-3">
                        {top_categories.map((t) => (
                            <div key={t.category} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div
                                        className="w-2.5 h-2.5 rounded-full"
                                        style={{ backgroundColor: getCategoryColor(t.category as any) }}
                                    />
                                    <span className="text-sm">{t.category}</span>
                                </div>
                                <span className="font-mono text-xs">{formatBytes(t.size)}</span>
                            </div>
                        ))}
                    </div>
                </motion.div>

                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col justify-center gap-1">
                    <p className="text-sm text-muted-foreground">Total Files Indexed</p>
                    <p className="text-3xl font-bold font-mono tracking-tighter">{stats.total_file_count.toLocaleString()}</p>
                </motion.div>

                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col justify-center">
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5 mb-1">
                        <File size={14} /> Largest File
                    </p>
                    {largest_file ? (
                        <>
                            <p className="text-sm font-semibold truncate" title={largest_file.name}>
                                {largest_file.name}
                            </p>
                            <p className="text-xs text-primary font-mono mt-0.5">{formatBytes(largest_file.size)}</p>
                        </>
                    ) : (
                        <p className="text-sm text-muted">No files found</p>
                    )}
                </motion.div>
            </div>
        </motion.div>
    );
}
