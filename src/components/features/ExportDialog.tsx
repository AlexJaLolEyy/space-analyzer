import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { motion } from "framer-motion";
import { CheckCircle2, Download, FileText as FileCsv, FileJson, X } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "../../lib/format";
import { findNodeByPath, useScanStore } from "../../stores/scanStore";
import { useToastStore } from "../../stores/toastStore";
import type { ScanNode } from "../../types/scan";

interface ExportDialogProps {
    onClose: () => void;
}

function flattenToCSV(node: ScanNode, rows: string[] = []): string[] {
    const escapedName = `"${node.name.replace(/"/g, '""')}"`;
    const escapedPath = `"${node.path.replace(/"/g, '""')}"`;
    rows.push(`${escapedName},${escapedPath},${node.size},${node.is_dir ? "dir" : "file"},${node.category},${node.file_count},${node.last_modified ?? ""}`);
    for (const child of node.children) {
        flattenToCSV(child, rows);
    }
    return rows;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
    const scanTree = useScanStore((s) => s.scanTree);
    const currentNode = useScanStore((s) => findNodeByPath(s.scanTree, s.currentPath) ?? s.scanTree);
    const addToast = useToastStore((s) => s.addToast);
    const [scope, setScope] = useState<"all" | "current">("all");
    const [done, setDone] = useState<"json" | "csv" | null>(null);
    const [busy, setBusy] = useState(false);

    const targetNode = scope === "all" ? scanTree : currentNode;

    const exportJSON = async () => {
        if (!targetNode) return;
        setBusy(true);
        try {
            const filename = `space-analyzer-${targetNode.name.replace(/[:\\/]/g, "-")}.json`;
            const file = await save({
                defaultPath: filename,
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (file) {
                await writeTextFile(file, JSON.stringify(targetNode, null, 2));
                setDone("json");
            }
        } catch (e) {
            console.error("Export JSON failed:", e);
            addToast("error", `Export failed: ${e}`);
        } finally {
            setBusy(false);
        }
    };

    const exportCSV = async () => {
        if (!targetNode) return;
        setBusy(true);
        try {
            const header = "Name,Path,Size,Type,Category,FileCount,LastModified";
            const rows = flattenToCSV(targetNode);
            const filename = `space-analyzer-${targetNode.name.replace(/[:\\/]/g, "-")}.csv`;
            const file = await save({
                defaultPath: filename,
                filters: [{ name: "CSV", extensions: ["csv"] }],
            });
            if (file) {
                await writeTextFile(file, [header, ...rows].join("\n"));
                setDone("csv");
            }
        } catch (e) {
            console.error("Export CSV failed:", e);
            addToast("error", `Export failed: ${e}`);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 16 }}
                transition={{ duration: 0.22 }}
                className="glass rounded-2xl p-6 w-full max-w-md shadow-2xl border border-border"
            >
                <div className="flex items-center justify-between mb-5">
                    <h2 className="font-bold text-base flex items-center gap-2">
                        <Download size={17} className="text-primary" />
                        Export Scan Results
                    </h2>
                    <button type="button" onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                        <X size={15} />
                    </button>
                </div>

                {done ? (
                    <div className="text-center space-y-4 py-4">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                            <CheckCircle2 size={24} className="text-green-500" />
                        </div>
                        <p className="font-semibold">
                            {done === "json" ? "JSON" : "CSV"} saved to the path you chose.
                        </p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            Done
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                                Scope
                            </p>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setScope("all")}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${scope === "all"
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-secondary border-border hover:bg-muted"
                                        }`}
                                >
                                    Entire Scan
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScope("current")}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${scope === "current"
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-secondary border-border hover:bg-muted"
                                        }`}
                                >
                                    Current Folder
                                </button>
                            </div>
                        </div>

                        {targetNode && (
                            <div className="px-3 py-2 bg-secondary/50 rounded-lg text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{targetNode.name}</span>
                                {" · "}{formatBytes(targetNode.size)}, {targetNode.file_count.toLocaleString()} files
                            </div>
                        )}

                        <div>
                            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                                Format
                            </p>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={exportJSON}
                                    disabled={!targetNode || busy}
                                    className="flex-1 flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl border border-border bg-secondary hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                    <FileJson size={20} className="text-amber-500" />
                                    <div className="text-left">
                                        <p>JSON</p>
                                        <p className="text-xs text-muted-foreground">Full tree structure</p>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={exportCSV}
                                    disabled={!targetNode || busy}
                                    className="flex-1 flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl border border-border bg-secondary hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                    <FileCsv size={20} className="text-green-500" />
                                    <div className="text-left">
                                        <p>CSV</p>
                                        <p className="text-xs text-muted-foreground">Flat list, Excel-ready</p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
