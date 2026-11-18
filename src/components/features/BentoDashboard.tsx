import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ArrowRight, Box, Clock, File, FolderOutput, HardDrive, TrendingUp, Zap } from "lucide-react";
import { getCategoryColor } from "../../lib/colors";
import { formatDelta, useFormatBytes } from "../../lib/format";
import { nodeSize, useSizeMode } from "../../lib/nodeSize";
import { useScanStore } from "../../stores/scanStore";
import type { ChangesSummary, ExtStat, ScanNode } from "../../types/scan";
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
    const fmt = useFormatBytes();
    const mode = useSizeMode();
    const scanTree = useScanStore((s) => s.scanTree);
    const selectedDrive = useScanStore((s) => s.selectedDrive);
    const scanInfo = useScanStore((s) => s.scanInfo);
    const deltasVersion = useScanStore((s) => s.deltasVersion);
    const navigateToAbsolutePath = useScanStore((s) => s.navigateToAbsolutePath);
    const setSearchQuery = useScanStore((s) => s.setSearchQuery);
    const setViewMode = useScanStore((s) => s.setViewMode);
    const [exts, setExts] = useState<ExtStat[]>([]);
    const [stats, setStats] = useState<DashboardStatsPayload | null>(null);
    const [changes, setChanges] = useState<ChangesSummary | null>(null);

    useEffect(() => {
        if (!scanTree) {
            setExts([]);
            return;
        }
        let cancelled = false;
        invoke<ExtStat[]>("get_extension_stats", { n: 8 })
            .then((v) => {
                if (!cancelled) setExts(v);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [scanTree, scanTree?.size]);

    useEffect(() => {
        if (!scanTree) {
            setChanges(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const data = await invoke<ChangesSummary>("get_changes_summary", { n: 5 });
                if (!cancelled) setChanges(data);
            } catch (e) {
                console.error("get_changes_summary failed:", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [scanTree, deltasVersion]);

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
                            <span className="text-2xl font-bold">{fmt(stats.total_size)}</span>
                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                                of {fmt(totalCapacity)} capacity
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
                                    {fmt(nodeSize(dir, mode))}
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
                                <span className="font-mono text-xs">{fmt(t.size)}</span>
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
                            <p className="text-xs text-primary font-mono mt-0.5">{fmt(largest_file.size)}</p>
                        </>
                    ) : (
                        <p className="text-sm text-muted">No files found</p>
                    )}
                </motion.div>

                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col justify-center gap-1">
                    <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <Zap size={14} /> Scan engine
                    </p>
                    <p className="text-2xl font-bold tracking-tight">{scanInfo?.engine ?? "—"}</p>
                    {scanInfo && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock size={12} /> {(scanInfo.elapsedMs / 1000).toFixed(1)} s
                        </p>
                    )}
                </motion.div>

                <motion.div variants={cardVariants} className="md:col-span-2 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col gap-3">
                    <h3 className="font-semibold flex items-center gap-2">
                        <TrendingUp size={16} className="text-primary" />
                        {changes?.since
                            ? `${changes.origin === 1 ? "Since background snapshot" : "Since"} ${new Date(changes.since * 1000).toLocaleString()}`
                            : "Changes since last scan"}
                    </h3>
                    {changes?.since ? (
                        <>
                            <p className={`text-2xl font-bold font-mono ${changes.total_delta > 0 ? "text-amber-500" : changes.total_delta < 0 ? "text-emerald-500" : ""}`}>
                                {changes.total_delta === 0 ? "No change" : formatDelta(changes.total_delta, fmt)}
                            </p>
                            <div className="flex flex-col gap-1.5">
                                {changes.top.map((n) => (
                                    <button
                                        key={n.path}
                                        onClick={() => {
                                            navigateToAbsolutePath(n.path);
                                            onExplore();
                                        }}
                                        className="flex justify-between items-center text-sm p-2 rounded-lg bg-background/40 border border-border/20 hover:bg-muted/50 text-left"
                                    >
                                        <span className="truncate flex-1 mr-2" title={n.path}>{n.name}</span>
                                        <span className={`font-mono text-xs shrink-0 ${(n.delta ?? 0) > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                                            {formatDelta(n.delta ?? 0, fmt)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Scan this location again later and the biggest changes will show up here.
                        </p>
                    )}
                </motion.div>

                <motion.div variants={cardVariants} className="md:col-span-1 bg-secondary/30 border border-border/50 rounded-3xl p-5 shadow-sm flex flex-col gap-3">
                    <h3 className="font-semibold flex items-center gap-2">
                        <File size={16} className="text-primary" /> Top file types
                    </h3>
                    <div className="flex flex-col gap-1.5">
                        {exts.map((e) => (
                            <button
                                key={e.ext || "(none)"}
                                onClick={() => {
                                    setSearchQuery(`ext:${e.ext}`);
                                    setViewMode("list");
                                    onExplore();
                                }}
                                title={`${e.count.toLocaleString()} files`}
                                className="flex justify-between items-center text-sm px-2 py-1 rounded-lg hover:bg-muted/50 text-left"
                            >
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getCategoryColor(e.category) }} />
                                    <span className="font-mono truncate">{e.ext ? `.${e.ext}` : "(none)"}</span>
                                </span>
                                <span className="font-mono text-xs shrink-0">{fmt(mode === "disk" ? e.alloc : e.size)}</span>
                            </button>
                        ))}
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}
