import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Download, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useScanStore } from "../../stores/scanStore";
import { useToastStore } from "../../stores/toastStore";
import type { ScanNode } from "../../types/scan";
import { ConfirmModal } from "./ConfirmModal";

function collectNodesByPaths(root: ScanNode, paths: Set<string>): ScanNode[] {
    const out: ScanNode[] = [];
    function walk(n: ScanNode) {
        if (paths.has(n.path)) out.push(n);
        for (const c of n.children) walk(c);
    }
    walk(root);
    return out;
}

export function SelectionActionBar() {
    const scanTree = useScanStore((s) => s.scanTree);
    const selectedPaths = useScanStore((s) => s.selectedPaths);
    const clearSelection = useScanStore((s) => s.clearSelection);
    const removeNode = useScanStore((s) => s.removeNode);
    const removePathsFromSelection = useScanStore((s) => s.removePathsFromSelection);
    const addToast = useToastStore((s) => s.addToast);

    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    if (!scanTree || selectedPaths.length === 0) return null;

    const paths = new Set(selectedPaths);
    const blocked = selectedPaths.filter((p) => p.includes(".space-analyzer"));
    const deletable = selectedPaths.filter((p) => !blocked.includes(p));

    const exportSelected = async () => {
        const nodes = collectNodesByPaths(scanTree, paths);
        if (nodes.length === 0) return;
        const json = JSON.stringify(nodes, null, 2);
        try {
            const file = await save({
                defaultPath: "space-analyzer-selection.json",
                filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (file) {
                await writeTextFile(file, json);
                addToast("success", "Selection exported");
            }
        } catch (e) {
            addToast("error", `Export failed: ${e}`);
        }
    };

    const confirmBatchDelete = async () => {
        if (deletable.length === 0) return;
        setDeleting(true);
        try {
            await invoke("delete_items", { paths: deletable, permanent: false });
            for (const p of deletable) removeNode(p);
            removePathsFromSelection(deletable);
            addToast("success", `Moved ${deletable.length} item(s) to Recycle Bin`);
        } catch (e) {
            addToast("error", `Delete failed: ${e}`);
        } finally {
            setDeleting(false);
            setDeleteOpen(false);
        }
    };

    return (
        <>
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-xl">
                <span className="text-sm font-medium text-foreground pr-2 border-r border-border">
                    {selectedPaths.length} selected
                </span>
                {blocked.length > 0 && (
                    <span className="text-xs text-amber-600 max-w-40 truncate" title="Some entries cannot be deleted">
                        {blocked.length} protected
                    </span>
                )}
                <button
                    type="button"
                    onClick={exportSelected}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted text-sm font-medium transition-colors"
                >
                    <Download size={14} /> Export
                </button>
                <button
                    type="button"
                    disabled={deletable.length === 0}
                    onClick={() => setDeleteOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive/15 hover:bg-destructive/25 text-destructive text-sm font-medium transition-colors disabled:opacity-40"
                >
                    <Trash2 size={14} /> Delete
                </button>
                <button
                    type="button"
                    onClick={clearSelection}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                    title="Clear selection"
                >
                    <X size={16} />
                </button>
            </div>

            <ConfirmModal
                isOpen={deleteOpen}
                title="Move selected to Recycle Bin?"
                message={`Move ${deletable.length} item(s) to the Recycle Bin?`}
                confirmLabel="Move to Bin"
                variant="warning"
                isLoading={deleting}
                onConfirm={confirmBatchDelete}
                onCancel={() => setDeleteOpen(false)}
            />
        </>
    );
}
