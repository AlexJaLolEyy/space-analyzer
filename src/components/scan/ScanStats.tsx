import { motion } from "framer-motion";
import { Activity, FileText, HardDrive, Timer } from "lucide-react";
import { formatBytes } from "../../lib/format";
import type { ScanProgress } from "../../types/scan";

interface ScanStatsProps {
    progress: ScanProgress;
}

export function ScanStats({ progress }: ScanStatsProps) {
    const elapsedSeconds = progress.elapsed_ms / 1000;
    const filesPerSecond =
        elapsedSeconds > 0
            ? Math.round(progress.files_scanned / elapsedSeconds)
            : 0;

    const mins = Math.floor(elapsedSeconds / 60);
    const secs = Math.floor(elapsedSeconds % 60).toString().padStart(2, "0");

    const stats = [
        {
            icon: <FileText size={18} />,
            label: "Files Scanned",
            value: progress.files_scanned.toLocaleString(),
            color: "hsl(220, 80%, 60%)",
        },
        {
            icon: <HardDrive size={18} />,
            label: "Data Seen",
            value: formatBytes(progress.bytes_scanned),
            color: "hsl(150, 65%, 48%)",
        },
        {
            icon: <Activity size={18} />,
            label: "Speed",
            value: `${filesPerSecond.toLocaleString()} f/s`,
            color: "hsl(280, 75%, 62%)",
        },
        {
            icon: <Timer size={18} />,
            label: "Elapsed",
            value: `${mins}:${secs}`,
            color: "hsl(30, 90%, 58%)",
        },
    ];

    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
            {stats.map((stat, i) => (
                <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.4 }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border/50 bg-background/40"
                >
                    <div
                        className="p-2 rounded-lg shrink-0"
                        style={{ backgroundColor: `${stat.color}18`, color: stat.color }}
                    >
                        {stat.icon}
                    </div>
                    <div>
                        <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider leading-none">
                            {stat.label}
                        </p>
                        <p className="text-lg font-bold tabular-nums leading-tight mt-1">
                            {stat.value}
                        </p>
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
