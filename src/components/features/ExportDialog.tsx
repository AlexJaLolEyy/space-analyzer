import { motion } from "framer-motion";
import { CheckCircle2, Download, FileText as FileCsv, FileJson, X } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface ExportDialogProps {
    onClose: () => void;
}

// Flatten tree to CSV rows
function flattenToCSV(node: ScanNode, rows: string[] = []): string[] {
    const escapedName = `"${node.name.replace(/"/g, '""')}"`;
    const escapedPath = `"${node.path.replace(/"/g, '""')}"`;
    rows.push(`${escapedName},${escapedPath},${node.size},${node.is_dir ? "dir" : "file"},${node.category},${node.file_count},${node.last_modified ?? ""}`);
    for (const child of node.children) {
        flattenToCSV(child, rows);
    }
    return rows;
}

function downloadBlob(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function ExportDialog({ onClose }: ExportDialogProps) {
    const { scanTree, currentNode } = useScanStore();
    const [scope, setScope] = useState<"all" | "current">("all");
    const [done, setDone] = useState<"json" | "csv" | null>(null);

    const targetNode = scope === "all" ? scanTree : currentNode;

    const exportJSON = () => {
        if (!targetNode) return;
        const filename = `space-analyzer-${targetNode.name.replace(/[:\\/]/g, "-")}.json`;
        downloadBlob(JSON.stringify(targetNode, null, 2), filename, "application/json");
        setDone("json");
    };

    const exportCSV = () => {
        if (!targetNode) return;
        const header = "Name,Path,Size,Type,Category,FileCount,LastModified";
        const rows = flattenToCSV(targetNode);
        const filename = `space-analyzer-${targetNode.name.replace(/[:\\/]/g, "-")}.csv`;
        downloadBlob([header, ...rows].join("\n"), filename, "text/csv");
        setDone("csv");
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
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
                    <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                        <X size={15} />
                    </button>
                </div>

                {done ? (
                    <div className="text-center space-y-4 py-4">
                        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                            <CheckCircle2 size={24} className="text-green-500" />
                        </div>
                        <p className="font-semibold">
                            {done === "json" ? "JSON" : "CSV"} export saved to your Downloads folder!
                        </p>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                        >
                            Done
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Scope selection */}
                        <div>
                            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                                Scope
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setScope("all")}
                                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${scope === "all"
                                            ? "bg-primary text-primary-foreground border-primary"
                                            : "bg-secondary border-border hover:bg-muted"
                                        }`}
                                >
                                    Entire Scan
                                </button>
                                <button
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

                        {/* Target info */}
                        {targetNode && (
                            <div className="px-3 py-2 bg-secondary/50 rounded-lg text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{targetNode.name}</span>
                                {" · "}{formatBytes(targetNode.size)}, {targetNode.file_count.toLocaleString()} files
                            </div>
                        )}

                        {/* Format buttons */}
                        <div>
                            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                                Format
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={exportJSON}
                                    disabled={!targetNode}
                                    className="flex-1 flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl border border-border bg-secondary hover:bg-muted transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                    <FileJson size={20} className="text-amber-500" />
                                    <div className="text-left">
                                        <p>JSON</p>
                                        <p className="text-xs text-muted-foreground">Full tree structure</p>
                                    </div>
                                </button>
                                <button
                                    onClick={exportCSV}
                                    disabled={!targetNode}
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
