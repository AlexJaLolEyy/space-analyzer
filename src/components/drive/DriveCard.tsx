import { motion } from "framer-motion";
import { ArrowRight, HardDrive, Network, Server, Usb } from "lucide-react";
import { formatBytes } from "../../lib/format";
import type { DriveInfo } from "../../types/drive";

interface DriveCardProps {
    drive: DriveInfo;
    onClick: (drive: DriveInfo) => void;
}

export function DriveCard({ drive, onClick }: DriveCardProps) {
    const usagePercentage =
        drive.total_bytes > 0
            ? (drive.used_bytes / drive.total_bytes) * 100
            : 0;

    const usageColor =
        usagePercentage > 90
            ? "hsl(0, 72%, 58%)"
            : usagePercentage > 70
                ? "hsl(35, 90%, 55%)"
                : "hsl(220, 80%, 60%)";

    const getIcon = () => {
        switch (drive.drive_type) {
            case "SSD":
                return <HardDrive className="w-7 h-7" />;
            case "HDD":
                return <Server className="w-7 h-7" />;
            case "Removable":
                return <Usb className="w-7 h-7" />;
            case "Network":
                return <Network className="w-7 h-7" />;
            default:
                return <HardDrive className="w-7 h-7" />;
        }
    };

    return (
        <motion.div
            whileHover={{ y: -4, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onClick(drive)}
            className="glass p-5 rounded-2xl cursor-pointer transition-shadow duration-200 group flex flex-col gap-4 hover:shadow-xl relative overflow-hidden"
        >
            {/* Subtle gradient shimmer on hover */}
            <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none rounded-2xl"
                style={{
                    background: `radial-gradient(ellipse at 20% 50%, ${usageColor}10 0%, transparent 70%)`,
                }}
            />

            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div
                        className="p-2.5 rounded-xl transition-colors"
                        style={{ backgroundColor: `${usageColor}18`, color: usageColor }}
                    >
                        {getIcon()}
                    </div>
                    <div>
                        <h3 className="text-base font-bold tracking-tight leading-tight">
                            {drive.name || "Local Disk"}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                            {drive.mount_point.replace(/\\$/, "")} · {drive.file_system} · {drive.drive_type}
                        </p>
                    </div>
                </div>
                <ArrowRight
                    size={16}
                    className="text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-1 transition-all"
                />
            </div>

            {/* Usage bar */}
            <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{formatBytes(drive.used_bytes)} used</span>
                    <span className="font-medium" style={{ color: usageColor }}>
                        {usagePercentage.toFixed(0)}%
                    </span>
                </div>
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: usageColor }}
                        initial={{ width: 0 }}
                        animate={{ width: `${usagePercentage}%` }}
                        transition={{ duration: 0.8, ease: "easeOut", delay: 0.1 }}
                    />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatBytes(drive.free_bytes)} free</span>
                    <span>{formatBytes(drive.total_bytes)} total</span>
                </div>
            </div>
        </motion.div>
    );
}
