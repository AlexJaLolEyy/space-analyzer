import { motion, Variants } from "framer-motion";
import { HardDrive } from "lucide-react";
import { useDrives } from "../../hooks/useDrives";
import type { DriveInfo } from "../../types/drive";
import { DriveCard } from "./DriveCard";

interface DriveSelectorProps {
    onDriveSelected: (drive: DriveInfo) => void;
}

const containerVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07 } },
};

const cardVariants: Variants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export function DriveSelector({ onDriveSelected }: DriveSelectorProps) {
    const { drives, isLoading, error } = useDrives();

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                >
                    <HardDrive className="w-12 h-12 text-primary/40" />
                </motion.div>
                <p className="text-muted-foreground text-sm animate-pulse tracking-wide">
                    Detecting drives…
                </p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
                <div className="p-4 rounded-full bg-destructive/10">
                    <HardDrive className="w-10 h-10 text-destructive" />
                </div>
                <p className="text-destructive font-semibold text-lg">Error loading drives</p>
                <p className="text-muted-foreground max-w-md text-sm">{error}</p>
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.35 }}
            className="flex-1 overflow-y-auto p-8 flex flex-col items-center"
        >
            <div className="w-full max-w-4xl space-y-8">
                {/* Hero header */}
                <motion.div
                    initial={{ opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="text-center space-y-3 pb-2"
                >
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-2">
                        <HardDrive className="w-8 h-8" />
                    </div>
                    <h1 className="text-4xl font-bold tracking-tight">Space Analyzer</h1>
                    <p className="text-muted-foreground text-base max-w-md mx-auto">
                        Select a drive to scan and visualize what's eating your disk space.
                    </p>
                </motion.div>

                {/* Drive grid */}
                <motion.div
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                >
                    {drives.map((drive) => (
                        <motion.div
                            key={drive.mount_point}
                            variants={cardVariants}
                        >
                            <DriveCard
                                drive={drive}
                                onClick={() => onDriveSelected(drive)}
                            />
                        </motion.div>
                    ))}
                    {drives.length === 0 && (
                        <motion.p
                            variants={cardVariants}
                            className="text-muted-foreground col-span-full text-center py-12"
                        >
                            No accessible drives found.
                        </motion.p>
                    )}
                </motion.div>

                {/* Keyboard hint */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="text-center text-xs text-muted-foreground/60"
                >
                    Click on a drive card to begin scanning
                </motion.div>
            </div>
        </motion.div>
    );
}
