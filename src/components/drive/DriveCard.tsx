import { motion, useMotionValue, useTransform, useSpring } from "framer-motion";
import { ArrowRight, HardDrive, Network, Server, Usb } from "lucide-react";
import { useRef } from "react";
import { formatBytes } from "../../lib/format";
import type { DriveInfo } from "../../types/drive";

interface DriveCardProps {
    drive: DriveInfo;
    onClick: (drive: DriveInfo) => void;
}

export function DriveCard({ drive, onClick }: DriveCardProps) {
    const ref = useRef<HTMLDivElement>(null);

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

    // 3D tilt micro-interaction
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [3, -3]), { stiffness: 200, damping: 30 });
    const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-3, 3]), { stiffness: 200, damping: 30 });
    const glowX = useTransform(mouseX, [-0.5, 0.5], [0, 100]);
    const glowY = useTransform(mouseY, [-0.5, 0.5], [0, 100]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
        mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
    };

    const handleMouseLeave = () => {
        mouseX.set(0);
        mouseY.set(0);
    };

    const getIcon = () => {
        switch (drive.drive_type) {
            case "SSD": return <HardDrive className="w-7 h-7" />;
            case "HDD": return <Server className="w-7 h-7" />;
            case "Removable": return <Usb className="w-7 h-7" />;
            case "Network": return <Network className="w-7 h-7" />;
            default: return <HardDrive className="w-7 h-7" />;
        }
    };

    return (
        <motion.div
            ref={ref}
            whileTap={{ scale: 0.98 }}
            onClick={() => onClick(drive)}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="glass p-5 rounded-2xl cursor-pointer transition-shadow duration-200 group flex flex-col gap-4 relative overflow-hidden"
            style={{ rotateX, rotateY, perspective: 800, transformStyle: "preserve-3d" }}
        >
            {/* Dynamic glow following mouse */}
            <motion.div
                className="absolute inset-0 pointer-events-none rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                    background: useTransform(
                        [glowX, glowY],
                        ([x, y]) =>
                            `radial-gradient(ellipse at ${x}% ${y}%, ${usageColor}22 0%, transparent 65%)`
                    ),
                }}
            />

            {/* Primary color hover glow ring */}
            <div
                className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ boxShadow: `0 0 0 1px ${usageColor}40, 0 8px 32px ${usageColor}20` }}
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
                    <span className="text-muted-foreground font-mono">{formatBytes(drive.used_bytes)} used</span>
                    <span className="font-mono font-semibold" style={{ color: usageColor }}>
                        {usagePercentage.toFixed(0)}%
                    </span>
                </div>
                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                    <motion.div
                        className="h-full rounded-full"
                        style={{
                            background: `linear-gradient(90deg, ${usageColor}, color-mix(in hsl, ${usageColor} 80%, white))`
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${usagePercentage}%` }}
                        transition={{ duration: 1, ease: "easeOut", delay: 0.1 }}
                    />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground font-mono">
                    <span>{formatBytes(drive.free_bytes)} free</span>
                    <span>{formatBytes(drive.total_bytes)} total</span>
                </div>
            </div>
        </motion.div>
    );
}
