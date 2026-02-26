import { motion } from "framer-motion";
import { HardDrive, Loader2, XCircle, Zap } from "lucide-react";
import type { ScanProgress as ProgressType } from "../../types/scan";
import { ScanStats } from "./ScanStats";

interface ScanProgressProps {
    progress: ProgressType | null;
    path: string;
    onCancel: () => void;
}

export function ScanProgress({ progress, path, onCancel }: ScanProgressProps) {
    const rootName = path.replace(/[/\\]$/, "").split(/[/\\]/).pop() || path;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col items-center justify-center p-8 w-full max-w-4xl mx-auto"
        >
            {/* Central icon animation */}
            <div className="relative mb-8 flex flex-col items-center gap-4">
                <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                        <HardDrive className="w-9 h-9 text-primary/50" />
                    </div>
                    <motion.div
                        className="absolute inset-0 rounded-full border-2 border-primary/30"
                        animate={{ scale: [1, 1.5, 1.5], opacity: [0.5, 0, 0] }}
                        transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
                    />
                    <motion.div
                        className="absolute inset-0 rounded-full border-2 border-primary/20"
                        animate={{ scale: [1, 1.8, 1.8], opacity: [0.3, 0, 0] }}
                        transition={{ repeat: Infinity, duration: 2, ease: "easeOut", delay: 0.5 }}
                    />
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-background border-2 border-border flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    </div>
                </div>

                <div className="text-center">
                    <h2 className="text-2xl font-bold tracking-tight">
                        Scanning <span className="text-primary">{rootName}</span>
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm truncate" title={progress?.current_path || path}>
                        {progress?.current_path || path}
                    </p>
                </div>
            </div>

            {/* Stats card */}
            <div className="w-full max-w-3xl glass p-8 rounded-2xl relative overflow-hidden">
                {/* Animated shimmer progress bar */}
                <div className="absolute top-0 left-0 w-full h-0.5 bg-secondary overflow-hidden">
                    <motion.div
                        className="absolute h-full bg-linear-to-r from-transparent via-primary to-transparent"
                        style={{ width: "40%" }}
                        animate={{ left: ["-40%", "140%"] }}
                        transition={{ repeat: Infinity, duration: 1.8, ease: "linear" }}
                    />
                </div>

                {progress ? (
                    <ScanStats progress={progress} />
                ) : (
                    <div className="h-32 flex flex-col items-center justify-center gap-3">
                        <Zap className="w-8 h-8 text-primary/40 animate-pulse" />
                        <p className="text-muted-foreground text-sm animate-pulse">
                            Initializing scan engine…
                        </p>
                    </div>
                )}
            </div>

            <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onCancel}
                className="mt-8 flex items-center gap-2 px-6 py-3 rounded-xl bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors font-medium"
            >
                <XCircle size={18} />
                Cancel Scan
            </motion.button>
        </motion.div>
    );
}
