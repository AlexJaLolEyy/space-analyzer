import { AnimatePresence, motion } from "framer-motion";
import { Download, FolderSearch, List, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DriveSelector } from "./components/drive/DriveSelector";
import { ExportDialog } from "./components/features/ExportDialog";
import { TopFilesPanel } from "./components/features/TopFilesPanel";
import { ScanProgress } from "./components/scan/ScanProgress";
import { ScanSummary } from "./components/scan/ScanSummary";
import { ViewContainer } from "./components/views/ViewContainer";
import { useScan } from "./hooks/useScan";
import { useScanStore } from "./stores/scanStore";
import type { DriveInfo } from "./types/drive";

export function MainWorkspace() {
    const { startScan, cancelScan, isScanning, progress, error } = useScan();
    const { scanTree, reset, currentPath } = useScanStore();
    const [targetPath, setTargetPath] = useState<string | null>(null);
    const [pathInput, setPathInput] = useState("");
    const [showPathInput, setShowPathInput] = useState(false);
    const [showTopFiles, setShowTopFiles] = useState(false);
    const [showExport, setShowExport] = useState(false);

    const handleDriveClick = (drive: DriveInfo) => {
        const path = drive.mount_point;
        setTargetPath(path);
        startScan(path);
    };

    const handleCustomPath = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = pathInput.trim();
        if (!trimmed) return;
        setTargetPath(trimmed);
        setShowPathInput(false);
        startScan(trimmed);
    };

    const handleCancel = () => {
        cancelScan();
        setTargetPath(null);
    };

    const handleReset = useCallback(() => {
        reset();
        setTargetPath(null);
        setPathInput("");
        setShowPathInput(false);
        setShowTopFiles(false);
        setShowExport(false);
    }, [reset]);

    // Global keyboard shortcuts (Phase 6)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Escape: go back or reset
            if (e.key === "Escape") {
                if (showPathInput) { setShowPathInput(false); return; }
                if (scanTree && currentPath.length > 1) {
                    useScanStore.getState().setCurrentPath(currentPath.slice(0, -1));
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showPathInput, scanTree, currentPath]);

    if (error) {
        return (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6"
            >
                <div className="p-4 rounded-full bg-destructive/10">
                    <FolderSearch className="w-10 h-10 text-destructive" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-destructive mb-2">Scan Error</h2>
                    <p className="text-muted-foreground break-all max-w-xl text-sm">{error}</p>
                </div>
                <button
                    onClick={handleReset}
                    className="px-6 py-3 bg-secondary text-secondary-foreground hover:bg-muted rounded-xl transition font-medium"
                >
                    Go Back
                </button>
            </motion.div>
        );
    }

    return (
        <AnimatePresence mode="wait">
            {isScanning ? (
                <ScanProgress
                    key="scan"
                    progress={progress}
                    path={targetPath || "Unknown Path"}
                    onCancel={handleCancel}
                />
            ) : scanTree ? (
                <motion.div
                    key="results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex-1 flex flex-col w-full h-full"
                >
                    {/* Results header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-background/70 backdrop-blur-md gap-4 flex-wrap shrink-0">
                        <div className="flex flex-col gap-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <FolderSearch size={16} className="text-primary shrink-0" />
                                <h2 className="text-sm font-bold tracking-tight truncate" title={scanTree.name}>
                                    {scanTree.name}
                                </h2>
                            </div>
                        </div>

                        <ScanSummary tree={scanTree} />

                        <div className="flex items-center gap-2 shrink-0">
                            {/* Custom path scan — Phase 6 */}
                            <AnimatePresence>
                                {showPathInput && (
                                    <motion.form
                                        initial={{ width: 0, opacity: 0 }}
                                        animate={{ width: 220, opacity: 1 }}
                                        exit={{ width: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        onSubmit={handleCustomPath}
                                        className="overflow-hidden"
                                    >
                                        <input
                                            autoFocus
                                            type="text"
                                            value={pathInput}
                                            onChange={e => setPathInput(e.target.value)}
                                            placeholder="C:\Custom\Path"
                                            className="w-full text-sm px-3 py-1.5 rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                                        />
                                    </motion.form>
                                )}
                            </AnimatePresence>
                            <button
                                onClick={() => setShowTopFiles(v => !v)}
                                title="Top 100 largest files"
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${showTopFiles ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"
                                    }`}
                            >
                                <List size={14} /> Top Files
                            </button>
                            <button
                                onClick={() => setShowExport(true)}
                                title="Export scan results"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-muted rounded-lg transition-colors font-medium"
                            >
                                <Download size={14} /> Export
                            </button>
                            <button
                                onClick={() => setShowPathInput(v => !v)}
                                title="Scan custom folder path"
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-secondary hover:bg-muted rounded-lg transition-colors font-medium"
                            >
                                <FolderSearch size={14} /> Custom
                            </button>
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors font-medium"
                            >
                                <RotateCcw size={14} /> New Scan
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
                        <ViewContainer />
                    </div>

                    {/* Slide-out panels */}
                    <AnimatePresence>
                        {showTopFiles && <TopFilesPanel onClose={() => setShowTopFiles(false)} />}
                    </AnimatePresence>
                    <AnimatePresence>
                        {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
                    </AnimatePresence>
                </motion.div>
            ) : (
                <DriveSelector key="drive" onDriveSelected={handleDriveClick} />
            )}
        </AnimatePresence>
    );
}
