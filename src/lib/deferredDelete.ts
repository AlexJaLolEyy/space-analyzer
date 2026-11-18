import { invoke } from "@tauri-apps/api/core";
import { findNodeByAbsolutePath, useScanStore } from "../stores/scanStore";
import { useToastStore } from "../stores/toastStore";
import type { ScanNode } from "../types/scan";

const DELETE_DELAY_MS = 4500;

interface DeferredOpts {
    permanent?: boolean;
    /** Known nodes for the paths; otherwise they are looked up in the loaded tree. */
    nodes?: ScanNode[];
    /** Called when the user undoes the delete (panels re-add their rows). */
    onUndo?: () => void;
    /** Called with the paths that could not be deleted. */
    onFailed?: (failed: string[]) => void;
}

/**
 * Removes the items from the UI immediately, shows an Undo toast and performs the real
 * delete after a short delay. This is the only delete path in the app.
 */
export function scheduleDeferredDeleteMany(paths: string[], opts: DeferredOpts = {}): void {
    if (paths.length === 0) return;
    const permanent = opts.permanent ?? false;
    const store = useScanStore.getState();
    const { addToast } = useToastStore.getState();

    const snapshots: ScanNode[] = (opts.nodes ??
        paths.map((p) => findNodeByAbsolutePath(store.scanTree, p)).filter((n): n is ScanNode => !!n)
    ).map((n) => structuredClone(n));

    for (const p of paths) store.removeNode(p);
    store.removePathsFromSelection(paths);

    let cancelled = false;
    let tid: ReturnType<typeof setTimeout> | null = null;
    const label = paths.length === 1 ? "" : ` (${paths.length} items)`;

    addToast(
        permanent ? "warning" : "success",
        (permanent ? "Queued for permanent delete" : "Queued for Recycle Bin") + label + " — Undo to cancel",
        {
            durationMs: DELETE_DELAY_MS,
            action: {
                label: "Undo",
                onClick: () => {
                    cancelled = true;
                    if (tid !== null) {
                        clearTimeout(tid);
                        tid = null;
                    }
                    for (const s of snapshots) useScanStore.getState().restoreRemovedNode(s);
                    opts.onUndo?.();
                },
            },
        }
    );

    tid = setTimeout(async () => {
        tid = null;
        if (cancelled) return;
        try {
            const failed = await invoke<string[]>("delete_items", { paths, permanent });
            if (failed.length > 0) {
                const bad = new Set(failed.map((p) => p.toLowerCase()));
                for (const s of snapshots) {
                    if (bad.has(s.path.toLowerCase())) useScanStore.getState().restoreRemovedNode(s);
                }
                opts.onFailed?.(failed);
                addToast("error", `Could not delete ${failed.length} item${failed.length === 1 ? "" : "s"}`);
            } else {
                addToast("success", permanent ? "Permanently deleted" : "Moved to Recycle Bin");
            }
        } catch (err) {
            for (const s of snapshots) useScanStore.getState().restoreRemovedNode(s);
            opts.onFailed?.(paths);
            addToast("error", `Failed to delete: ${err}`);
        }
    }, DELETE_DELAY_MS);
}

export function scheduleDeferredDelete(opts: { node: ScanNode; permanent: boolean }): void {
    scheduleDeferredDeleteMany([opts.node.path], { permanent: opts.permanent, nodes: [opts.node] });
}
