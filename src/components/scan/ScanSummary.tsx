import { motion } from "framer-motion";
import { Clock, Files, FolderOpen, HardDrive } from "lucide-react";
import { formatBytes } from "../../lib/format";
import type { ScanNode } from "../../types/scan";

interface ScanSummaryProps {
    tree: ScanNode;
}

export function ScanSummary({ tree }: ScanSummaryProps) {
    const stats = [
        {
            icon: <HardDrive size={18} />,
            label: "Total Size",
            value: formatBytes(tree.size),
            color: "hsl(220, 80%, 60%)",
        },
        {
            icon: <Files size={18} />,
            label: "Files",
            value: tree.file_count.toLocaleString(),
            color: "hsl(150, 65%, 48%)",
        },
        {
            icon: <FolderOpen size={18} />,
            label: "Top Folder",
            value: tree.children.length > 0
                ? tree.children.reduce((a, b) => (a.size > b.size ? a : b)).name
                : "—",
            color: "hsl(30, 90%, 58%)",
        },
        {
            icon: <Clock size={18} />,
            label: "Folders",
            value: tree.children.filter(c => c.is_dir).length.toLocaleString(),
            color: "hsl(280, 70%, 62%)",
        },
    ];

    return (
        <div className="flex items-center gap-3 flex-wrap">
            {stats.map((stat, i) => (
                <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06, duration: 0.3 }}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/60 border border-border/50"
                >
                    <span style={{ color: stat.color }}>{stat.icon}</span>
                    <div className="text-xs">
                        <p className="text-muted-foreground leading-none">{stat.label}</p>
                        <p className="font-semibold mt-0.5 leading-none truncate max-w-32" title={stat.value}>
                            {stat.value}
                        </p>
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
