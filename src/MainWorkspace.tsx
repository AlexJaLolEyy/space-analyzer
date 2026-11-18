import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, Copy, Download, FolderOpen, FolderSearch, Grid2X2, HardDrive, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { DriveSelector } from "./components/drive/DriveSelector";
import { BentoDashboard } from "./components/features/BentoDashboard";
import { CleanupSuggestionsPanel } from "./components/features/CleanupSuggestionsPanel";
import { DuplicatesPanel } from "./components/features/DuplicatesPanel";
import { ExportDialog } from "./components/features/ExportDialog";
import { TopFilesPanel } from "./components/features/TopFilesPanel";
import { ScanProgress } from "./components/scan/ScanProgress";
import { ScanSummary } from "./components/scan/ScanSummary";
import { CommandPalette } from "./components/ui/CommandPalette";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { SelectionActionBar } from "./components/ui/SelectionActionBar";
import { ViewContainer } from "./components/views/ViewContainer";
import { useScan } from "./hooks/useScan";
import { refreshRootAndCurrent } from "./lib/refresh";
import { useScanStore } from "./stores/scanStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useToastStore } from "./stores/toastStore";
import { useUiStore } from "./stores/uiStore";
import type { DriveInfo } from "./types/drive";

const VIEW_KEYS = ["list", "pie", "bar", "treemap"] as const;

export function MainWorkspace() {
    const { startScan, cancelScan, isScanning, progress, error } = useScan();
    const scanTree = useScanStore((s) => s.scanTree);
    const scanInfo = useScanStore((s) => s.scanInfo);
    const reset = useScanStore((s) => s.reset);
    const currentPath = useScanStore((s) => s.currentPath);
    const setSkipElevationPrompt = useSettingsStore((s) => s.setSkipElevationPrompt);
    const sizeMode = useSettingsStore((s) => s.sizeMode);
    const setSizeMode = useSettingsStore((s) => s.setSizeMode);
    const [dontAskAgain, setDontAskAgain] = useState(false);
    const showElevationDialog = useUiStore((s) => s.showElevationDialog);
    const setShowElevationDialog = useUiStore((s) => s.setShowElevationDialog);
    const setShowSettings = useUiStore((s) => s.setShowSettings);
    const isElevated = useUiStore((s) => s.isElevated);
    const setIsElevated = useUiStore((s) => s.setIsElevated);
    const [elevateLoading, setElevateLoading] = useState(false);
    const [targetPath, setTargetPath] = useState<string | null>(null);
    const [pathInput, setPathInput] = useState("");
    const [showPathInput, setShowPathInput] = useState(false);
    const [showLargest, setShowLargest] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [showDuplicates, setShowDuplicates] = useState(false);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [showDashboard, setShowDashboard] = useState(true);
    const [showCleanup, setShowCleanup] = useState(false);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [dragHighlight, setDragHighlight] = useState(false);
    const addToast = useToastStore((s) => s.addToast);

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const status = await invoke<{ is_elevated: boolean }>("get_privilege_status");
                if (!mounted) return;
                setIsElevated(status.is_elevated);
                setShowElevationDialog(!status.is_elevated && !useSettingsStore.getState().skipElevationPrompt);
            } catch {
                if (!mounted) return;
                setIsElevated(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, [setIsElevated, setShowElevationDialog]);

    // background deltas finished: refresh badges and the dashboard card
    useEffect(() => {
        if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
        let unlisten: (() => void) | undefined;
        listen("deltas-ready", () => {
            useScanStore.getState().bumpDeltasVersion();
            void refreshRootAndCurrent();
        })
            .then((u) => {
                unlisten = u;
            })
            .catch(() => {});
        return () => unlisten?.();
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
                    const p = event.payload.paths[0];
                    if (p) {
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
            name: drive.name || drive.mount_point,
        });
        setTargetPath(path);
        startScan(path);
    };

    const scanCustomPath = (path: string) => {
        const trimmed = path.trim();
        if (!trimmed) return;
        setTargetPath(trimmed);
        setShowPathInput(false);
        setShowDashboard(true);
        startScan(trimmed);
    };

    const handleCustomPath = (e: React.FormEvent) => {
        e.preventDefault();
        scanCustomPath(pathInput);
    };

    const handleBrowse = async () => {
        try {
            const picked = await open({ directory: true, multiple: false });
            if (typeof picked === "string" && picked) {
                setTargetPath(picked);
                setShowDashboard(true);
                startScan(picked);
            }
        } catch (err: any) {
            addToast("error", `Could not open folder picker: ${err}`);
        }
    };

    const handleReset = useCallback(() => {
        reset();
        setTargetPath(null);
        setPathInput("");
        setShowPathInput(false);
        setShowLargest(false);
        setShowExport(false);
        setShowDashboard(true);
    }, [reset]);

    const focusSearch = () => {
        const el = document.querySelector('input[placeholder^="Search"]') as HTMLInputElement | null;
        el?.focus();
    };

    // Global keyboard shortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (commandPaletteOpen) {
                    e.preventDefault();
                    setCommandPaletteOpen(false);
                    return;
                }
                if (showPathInput) {
                    setShowPathInput(false);
                    return;
                }
                if (scanTree && currentPath.length > 1) {
                    useScanStore.getState().setCurrentPath(currentPath.slice(0, -1));
                }
            }

            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case ",":
                        e.preventDefault();
                        setShowSettings(true);
                        break;
                    case "d":
                        e.preventDefault();
                        if (scanTree) setShowDashboard((v) => !v);
                        break;
                    case "e":
                        e.preventDefault();
                        if (scanTree) setShowExport(true);
                        break;
                    case "f":
                        e.preventDefault();
                        focusSearch();
                        break;
                    case "backspace":
                        e.preventDefault();
                        if (scanTree && currentPath.length > 1) {
                            useScanStore.getState().setCurrentPath(currentPath.slice(0, -1));
                        }
                        break;
                }
            } else {
                if (document.activeElement?.tagName === "INPUT") return;
                if (scanTree && !showDashboard) {
                    const num = parseInt(e.key);
                    if (num >= 1 && num <= VIEW_KEYS.length) {
                        e.preventDefault();
                        useScanStore.getState().setViewMode(VIEW_KEYS[num - 1]);
                    }
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [showPathInput, scanTree, currentPath, showDashboard, commandPaletteOpen, setShowSettings]);

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

    const headerButton = (active: boolean) =>
        `flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors font-medium ${active ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`;

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
                onFocusSearch={focusSearch}
                onOpenCustomPath={() => {
                    setShowPathInput(true);
                    setShowDashboard(false);
                }}
                onNewScan={handleReset}
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
                        className="flex-1 flex flex-col w-full h-full min-h-0"
                    >
                        {/* Results header: always visible, above both the overview and the views */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-background/70 backdrop-blur-md gap-4 flex-wrap shrink-0">
                            <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <FolderSearch size={16} className="text-primary shrink-0" />
                                    <h2 className="text-sm font-bold tracking-tight truncate" title={scanTree.name}>
                                        {scanTree.name}
                                    </h2>
                                    {scanInfo && (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-secondary text-muted-foreground">
                                            {scanInfo.engine}
                                        </span>
                                    )}
                                </div>
                                {isElevated === false && (
                                    <button
                                        type="button"
                                        onClick={() => setShowElevationDialog(true)}
                                        className="text-[11px] text-muted-foreground hover:text-foreground text-left underline-offset-2 hover:underline"
                                    >
                                        Standard mode. Enable Turbo (admin) for much faster scans.
                                    </button>
                                )}
                            </div>

                            <ScanSummary tree={scanTree} />

                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
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
                                                onChange={(e) => setPathInput(e.target.value)}
                                                placeholder="C:\Custom\Path"
                                                className="w-full text-sm px-3 py-1.5 rounded-lg bg-secondary border border-border focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                                            />
                                        </motion.form>
                                    )}
                                </AnimatePresence>
                                <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium" title="Show logical size or size on disk (allocated clusters)">
                                    <button
                                        onClick={() => setSizeMode("logical")}
                                        className={`px-2.5 py-1.5 transition-colors ${sizeMode === "logical" ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`}
                                    >
                                        Size
                                    </button>
                                    <button
                                        onClick={() => setSizeMode("disk")}
                                        className={`px-2.5 py-1.5 transition-colors flex items-center gap-1 ${sizeMode === "disk" ? "bg-primary text-primary-foreground" : "bg-secondary hover:bg-muted"}`}
                                    >
                                        <HardDrive size={12} /> On disk
                                    </button>
                                </div>
                                <button
                                    onClick={() => setShowLargest((v) => !v)}
                                    title="Largest files and folders"
                                    className={headerButton(showLargest)}
                                >
                                    <ArrowUpDown size={14} /> Largest
                                </button>
                                <button
                                    onClick={() => setShowDuplicates((v) => !v)}
                                    title="Find Duplicate Files"
                                    className={headerButton(showDuplicates)}
                                >
                                    <Copy size={14} /> Duplicates
                                </button>
                                <button onClick={() => setShowCleanup((v) => !v)} title="Smart Cleanup" className={headerButton(showCleanup)}>
                                    <Sparkles size={14} /> Cleanup
                                </button>
                                <button
                                    onClick={() => setShowExport(true)}
                                    title="Export scan results (Ctrl+E)"
                                    className={headerButton(false)}
                                >
                                    <Download size={14} /> Export
                                </button>
                                <button onClick={handleBrowse} title="Choose a folder to scan" className={headerButton(false)}>
                                    <FolderOpen size={14} /> Browse
                                </button>
                                <button
                                    onClick={() => setShowPathInput((v) => !v)}
                                    title="Scan custom folder path"
                                    className={headerButton(false)}
                                >
                                    <FolderSearch size={14} /> Custom
                                </button>
                                <button
                                    onClick={() => setShowDashboard((v) => !v)}
                                    title="Toggle Dashboard (Ctrl+D)"
                                    className={headerButton(showDashboard)}
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

                        {showDashboard ? (
                            <BentoDashboard onExplore={() => setShowDashboard(false)} />
                        ) : (
                            <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
                                <ViewContainer />
                            </div>
                        )}
                    </motion.div>
                ) : (
                    <DriveSelector
                        key="drive"
                        onDriveSelected={handleDriveClick}
                        onBrowse={handleBrowse}
                        onCustomPath={scanCustomPath}
                    />
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
                checkbox={{ label: "Don't ask again", checked: dontAskAgain, onChange: setDontAskAgain }}
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
                onCancel={() => {
                    if (dontAskAgain) setSkipElevationPrompt(true);
                    setShowElevationDialog(false);
                }}
            />

            <AnimatePresence>
                {showLargest && <TopFilesPanel onClose={() => setShowLargest(false)} />}
                {showDuplicates && <DuplicatesPanel onClose={() => setShowDuplicates(false)} />}
                {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
                {showCleanup && <CleanupSuggestionsPanel onClose={() => setShowCleanup(false)} />}
            </AnimatePresence>
        </div>
    );
}
