import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, Copy, Download, FolderSearch, Grid2X2, History, List, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DriveSelector } from "./components/drive/DriveSelector";
import { BentoDashboard } from "./components/features/BentoDashboard";
import { BlackHolesPanel } from "./components/features/BlackHolesPanel";
import { CleanupSuggestionsPanel } from "./components/features/CleanupSuggestionsPanel";
import { DuplicatesPanel } from "./components/features/DuplicatesPanel";
import { ExportDialog } from "./components/features/ExportDialog";
import { ScanCompareView } from "./components/features/ScanCompareView";
import { ScanHistoryPanel } from "./components/features/ScanHistoryPanel";
import { TopFilesPanel } from "./components/features/TopFilesPanel";
import { ScanProgress } from "./components/scan/ScanProgress";
import { ScanSummary } from "./components/scan/ScanSummary";
import { CommandPalette } from "./components/ui/CommandPalette";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { SelectionActionBar } from "./components/ui/SelectionActionBar";
import { ViewContainer } from "./components/views/ViewContainer";
import { useScan } from "./hooks/useScan";
import { useScanStore } from "./stores/scanStore";
import { useToastStore } from "./stores/toastStore";
import type { DriveInfo } from "./types/drive";
import type { ScanDiff } from "./types/history";
import type { ScanNode } from "./types/scan";

export function MainWorkspace() {
    const { startScan, cancelScan, isScanning, progress, error } = useScan();
    const { scanTree, reset, currentPath } = useScanStore();
    const [isElevated, setIsElevated] = useState<boolean | null>(null);
    const [showElevationDialog, setShowElevationDialog] = useState(false);
    const [elevateLoading, setElevateLoading] = useState(false);
    const [targetPath, setTargetPath] = useState<string | null>(null);
    const [pathInput, setPathInput] = useState("");
    const [showPathInput, setShowPathInput] = useState(false);
    const [showTopFiles, setShowTopFiles] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [showDuplicates, setShowDuplicates] = useState(false);
    const [showBlackHoles, setShowBlackHoles] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [showDashboard, setShowDashboard] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [showCleanup, setShowCleanup] = useState(false);
    const [compareData, setCompareData] = useState<ScanDiff | null>(null);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [dragHighlight, setDragHighlight] = useState(false);
    const addToast = useToastStore(s => s.addToast);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const status = await invoke<{ is_elevated: boolean }>("get_privilege_status");
                if (!mounted) return;
                setIsElevated(status.is_elevated);
                setShowElevationDialog(!status.is_elevated);
            } catch {
                if (!mounted) return;
                setIsElevated(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
        let unlisten: (() => void) | undefined;
        getCurrentWebview()
            .onDragDropEvent((event) => {
                const t = event.payload.type;
                if (t === "enter" || t === "over") setDragHighlight(true);
                if (t === "leave") setDragHighlight(false);
                if (t === "drop") {
                    setDragHighlight(false);
                    if (isScanning) return;
                    const paths = event.payload.paths;
                    const p = paths[0];
                    if (p) {
                        if (import.meta.env.DEV) {
                            console.log("[drag-drop] dropped path:", p);
                        }
                        setTargetPath(p);
                        startScan(p);
                    }
                }
            })
            .then((u) => {
                unlisten = u;
            })
            .catch(() => {});
        return () => {
            unlisten?.();
        };
    }, [startScan, isScanning]);

    const handleDriveClick = (drive: DriveInfo) => {
        const path = drive.mount_point;
        useScanStore.getState().setSelectedDrive({
            total_bytes: drive.total_bytes,
            name: drive.name || drive.mount_point
        });
        setTargetPath(path);
        startScan(path);
    };

    const handleCustomPath = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = pathInput.trim();
        if (!trimmed) return;
        setTargetPath(trimmed);
        setShowPathInput(false);
        setShowDashboard(true);
        startScan(trimmed);
    };

    const handleLoadScan = async (id: string) => {
        try {
            const tree = await invoke<ScanNode>("load_scan", { id });
            useScanStore.getState().setScanTree(tree);
            setShowHistory(false);
            setShowDashboard(true);
            setCompareData(null);
            addToast("success", "Scan loaded from history");
        } catch (err: any) {
            addToast("error", `Failed to load scan: ${err}`);
        }
    };

    const handleCompare = async (idA: string, idB: string) => {
        try {
            const diff = await invoke<ScanDiff>("compare_scans", { idA, idB });
            setCompareData(diff);
            setShowHistory(false);
        } catch (err: any) {
            addToast("error", `Failed to compare scans: ${err}`);
        }
    };

    const handleReset = useCallback(() => {
        reset();
        setTargetPath(null);
        setPathInput("");
        setShowPathInput(false);
        setShowTopFiles(false);
        setShowExport(false);
        setShowDashboard(true);
    }, [reset]);

    // Global keyboard shortcuts (Phase 6)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (commandPaletteOpen) {
                    e.preventDefault();
                    setCommandPaletteOpen(false);
                    return;
                }
                if (showPathInput) { setShowPathInput(false); return; }
                if (scanTree && currentPath.length > 1) {
                    useScanStore.getState().setCurrentPath(currentPath.slice(0, -1));
                }
            }

            // Ctrl/Cmd shortcuts
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'd':
                        e.preventDefault();
                        if (scanTree) setShowDashboard(v => !v);
                        break;
                    case 'e':
                        e.preventDefault();
                        if (scanTree) setShowExport(true);
                        break;
                    case 'f':
                        e.preventDefault();
                        // Focus on search input by finding it conceptually or ref 
                        const searchInput = document.querySelector('input[placeholder="Filter items…"]') as HTMLInputElement;
                        if (searchInput) searchInput.focus();
                        break;
                    case 'backspace':
                        e.preventDefault();
                        if (scanTree && currentPath.length > 1) {
                            useScanStore.getState().setCurrentPath(currentPath.slice(0, -1));
                        }
                        break;
                }
            } else {
                // Number shortcuts for view modes
                if (document.activeElement?.tagName === 'INPUT') return;

                if (scanTree && !showDashboard) {
                    const views = ['list', 'pie', 'bar', 'treemap', 'sunburst'];
                    const num = parseInt(e.key);
                    if (num >= 1 && num <= 5) {
                        e.preventDefault();
                        useScanStore.getState().setViewMode(views[num - 1] as any);
                    }
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showPathInput, scanTree, currentPath, showDashboard, commandPaletteOpen]);

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
        <div className="flex flex-col h-full w-full relative overflow-hidden">
            {dragHighlight && !isScanning && (
                <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center border-4 border-dashed border-primary bg-primary/15 backdrop-blur-sm">
                    <div className="text-center space-y-1 px-6 py-4 rounded-2xl bg-background/90 border-2 border-primary shadow-lg max-w-sm">
                        <p className="text-lg font-bold text-primary">Drop to scan</p>
                        <p className="text-sm text-muted-foreground">Release the mouse to scan that folder</p>
                    </div>
                </div>
            )}

            <CommandPalette
                open={commandPaletteOpen}
                onOpenChange={setCommandPaletteOpen}
                onOpenExport={() => setShowExport(true)}
                onToggleDuplicates={() => setShowDuplicates((v) => !v)}
                onToggleDashboard={() => setShowDashboard((v) => !v)}
                onFocusSearch={() => {
                    const el = document.querySelector('input[placeholder="Filter items… (Ctrl+F)"]') as HTMLInputElement | null;
                    el?.focus();
                }}
                onOpenCustomPath={() => {
                    setShowPathInput(true);
                    setShowDashboard(false);
                }}
                onNewScan={handleReset}
                onOpenHistory={() => setShowHistory(true)}
                duplicatesOpen={showDuplicates}
                dashboardVisible={showDashboard}
            />

            <SelectionActionBar />

            <AnimatePresence mode="wait">
                {isScanning ? (
                    <ScanProgress
                        key="scan"
                        progress={progress}
                        path={targetPath || "Unknown Path"}
                        onCancel={() => setShowCancelModal(true)}
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
                        {showDashboard ? (
                            <BentoDashboard onExplore={() => setShowDashboard(false)} />
                        ) : (
                            <>
                                {/* Results header */}
                                <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-background/70 backdrop-blur-md gap-4 flex-wrap shrink-0">
                                    <div className="flex flex-col gap-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <FolderSearch size={16} className="text-primary shrink-0" />
                                            <h2 className="text-sm font-bold tracking-tight truncate" title={scanTree.name}>
                                                {scanTree.name}
                                            </h2>
                                        </div>
                                        {isElevated === false && (
                                            <div className="text-[11px] text-muted-foreground">
                                                Standard scan mode — MFT Turbo available if you run elevated.
                                            </div>
                                        )}
                                    </div>

                                    <ScanSummary tree={scanTree} />

                                    <div className="flex items-center gap-2 shrink-0">
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
                                            onClick={() => setShowDuplicates(v => !v)}
                                            title="Find Duplicate Files"
                                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${showDuplicates ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"
                                                }`}
                                        >
                                            <Copy size={14} /> Duplicates
                                        </button>
                                        <button
                                            onClick={() => setShowHistory(true)}
                                            title="View saved scans"
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium bg-secondary hover:bg-muted"
                                        >
                                            <History size={14} /> History
                                        </button>
                                        <button
                                            onClick={() => setShowBlackHoles(v => !v)}
                                            title="Find Black Holes (Deep massive folders)"
                                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${showBlackHoles ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"
                                                }`}
                                        >
                                            <AlertOctagon size={14} /> Black Holes
                                        </button>
                                        <button
                                            onClick={() => setShowCleanup(v => !v)}
                                            title="Smart Cleanup"
                                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${showCleanup ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`}
                                        >
                                            <Sparkles size={14} /> Cleanup
                                        </button>
                                        <button
                                            onClick={() => setShowExport(true)}
                                            title="Export scan results (Ctrl+E)"
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
                                            onClick={() => setShowDashboard(v => !v)}
                                            title="Toggle Dashboard (Ctrl+D)"
                                            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${showDashboard ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`}
                                        >
                                            <Grid2X2 size={14} /> Dashboard
                                        </button>
                                        <button
                                            onClick={handleReset}
                                            title="Back to Drives"
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors font-medium"
                                        >
                                            <RotateCcw size={14} /> New Scan
                                        </button>
                                    </div>
                                </div>

                                <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
                                    <ViewContainer />
                                </div>
                            </>
                        )}
                    </motion.div>
                ) : compareData ? (
                    <ScanCompareView key="compare" diff={compareData} onClose={() => setCompareData(null)} />
                ) : (
                    <DriveSelector key="drive" onDriveSelected={handleDriveClick} onOpenHistory={() => setShowHistory(true)} />
                )}
            </AnimatePresence>

            <ConfirmModal
                isOpen={showCancelModal}
                title="Cancel Scan?"
                message="Are you sure you want to cancel the current scan? All progress will be lost."
                confirmLabel="Cancel Scan"
                onConfirm={() => {
                    cancelScan();
                    setTargetPath(null);
                    setShowCancelModal(false);
                }}
                onCancel={() => setShowCancelModal(false)}
            />

            <ConfirmModal
                isOpen={showElevationDialog}
                title="Run elevated?"
                message="Elevated mode enables faster MFT scanning on Windows root drives. Run elevated now?"
                confirmLabel="Run Elevated"
                cancelLabel="Continue Standard"
                variant="info"
                isLoading={elevateLoading}
                onConfirm={async () => {
                    try {
                        setElevateLoading(true);
                        await invoke("relaunch_as_admin");
                    } catch (err: any) {
                        addToast("error", `Failed to relaunch elevated: ${err}`);
                        setShowElevationDialog(false);
                    } finally {
                        setElevateLoading(false);
                    }
                }}
                onCancel={() => setShowElevationDialog(false)}
            />

            <AnimatePresence>
                {showTopFiles && <TopFilesPanel onClose={() => setShowTopFiles(false)} />}
                {showDuplicates && <DuplicatesPanel onClose={() => setShowDuplicates(false)} />}
                {showBlackHoles && <BlackHolesPanel onClose={() => setShowBlackHoles(false)} />}
                {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
                {showCleanup && <CleanupSuggestionsPanel onClose={() => setShowCleanup(false)} />}
                {showHistory && (
                    <ScanHistoryPanel
                        onClose={() => setShowHistory(false)}
                        onLoadScan={handleLoadScan}
                        onCompare={handleCompare}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
