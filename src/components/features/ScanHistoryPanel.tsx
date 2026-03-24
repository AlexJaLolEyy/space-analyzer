import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import { History, Trash2, Download, Scale } from "lucide-react";
import { formatBytes } from "../../lib/format";
import { ConfirmModal } from "../ui/ConfirmModal";
import type { ScanHistoryEntry } from "../../types/history";
import { useToastStore } from "../../stores/toastStore";

interface ScanHistoryPanelProps {
    onClose: () => void;
    onLoadScan: (id: string) => void;
    onCompare: (idA: string, idB: string) => void;
}

export function ScanHistoryPanel({ onClose, onLoadScan, onCompare }: ScanHistoryPanelProps) {
    const [scans, setScans] = useState<ScanHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const addToast = useToastStore(s => s.addToast);

    const fetchScans = async () => {
        try {
            setLoading(true);
            const data = await invoke<ScanHistoryEntry[]>("list_scans");
            setScans(data);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchScans();
    }, []);

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await invoke("delete_scan_history", { id: deleteTarget });
            setScans(scans.filter(s => s.id !== deleteTarget));
            setSelectedIds(selectedIds.filter(id => id !== deleteTarget));
            setDeleteTarget(null);
            addToast("success", "Scan history deleted");
        } catch (err: any) {
            addToast("error", `Failed to delete: ${err}`);
        }
    };

    const toggleSelect = (id: string) => {
        if (selectedIds.includes(id)) {
            setSelectedIds(selectedIds.filter(x => x !== id));
        } else {
            if (selectedIds.length < 2) {
                setSelectedIds([...selectedIds, id]);
            } else {
                // If 2 already selected, replace the second one
                setSelectedIds([selectedIds[0], id]);
            }
        }
    };

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-125 border-l border-border bg-popover/90 backdrop-blur-xl shadow-2xl flex flex-col z-30"
        >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <History className="text-primary shrink-0" size={20} />
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Scan History</h2>
                        <p className="text-xs text-muted-foreground">
                            Load or compare past snapshots
                        </p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                >
                    ✕
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loading ? (
                    <div className="text-center text-sm text-muted-foreground mt-10">Loading history...</div>
                ) : scans.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <History size={48} className="opacity-20" />
                        <p>No saved scans found.</p>
                    </div>
                ) : (
                    scans.map((scan) => {
                        const isSelected = selectedIds.includes(scan.id);
                        return (
                            <div
                                key={scan.id}
                                className={`flex flex-col gap-3 p-3 rounded-xl border transition-colors ${isSelected
                                    ? "bg-primary/5 border-primary shadow-sm"
                                    : "bg-secondary/50 border-border hover:bg-secondary/80"
                                    }`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-sm">{scan.label}</span>
                                        <span className="text-xs text-muted-foreground">{scan.drive_path} • {new Date(scan.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="font-mono text-xs font-semibold">{formatBytes(scan.total_size)}</span>
                                        <span className="font-mono text-[10px] text-muted-foreground">{scan.file_count.toLocaleString()} files</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 opacity-80 mt-1">
                                    <button
                                        onClick={() => toggleSelect(scan.id)}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition ${isSelected ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                                    >
                                        <Scale size={13} /> {isSelected ? "Selected" : "Select for Compare"}
                                    </button>
                                    <button
                                        onClick={() => onLoadScan(scan.id)}
                                        className="flex items-center justify-center gap-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-background hover:bg-muted transition"
                                    >
                                        <Download size={13} /> Load
                                    </button>
                                    <button
                                        onClick={() => setDeleteTarget(scan.id)}
                                        className="py-1.5 px-2.5 rounded-lg text-xs hover:bg-destructive/20 text-destructive transition"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {selectedIds.length === 2 && (
                <div className="p-4 border-t border-border/50 bg-background/50 backdrop-blur shrink-0 animate-in slide-in-from-bottom-2">
                    <button
                        onClick={() => onCompare(selectedIds[0], selectedIds[1])}
                        className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition shadow-md flex items-center justify-center gap-2"
                    >
                        <Scale size={16} /> Compare Selected Scans
                    </button>
                </div>
            )}

            <ConfirmModal
                isOpen={!!deleteTarget}
                title="Delete History Entry"
                message="Are you sure you want to delete this scan from history? This cannot be undone."
                confirmLabel="Delete"
                variant="danger"
                onConfirm={handleDelete}
                onCancel={() => setDeleteTarget(null)}
            />
        </motion.div>
    );
}
