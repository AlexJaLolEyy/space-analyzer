import { invoke } from "@tauri-apps/api/core";
import type { ScanNode } from "../types/scan";
import type { ToastType } from "../stores/toastStore";

const DELETE_DELAY_MS = 4500;

type AddToast = (
    type: ToastType,
    message: string,
    options?: { action?: { label: string; onClick: () => void }; durationMs?: number }
) => void;

export function scheduleDeferredDelete(opts: {
    node: ScanNode;
    permanent: boolean;
    removeNode: (path: string) => void;
    restoreRemovedNode: (subtree: ScanNode) => void;
    addToast: AddToast;
}): void {
    const { node, permanent, removeNode, restoreRemovedNode, addToast } = opts;
    const snapshot = structuredClone(node);
    removeNode(node.path);

    let cancelled = false;
    let tid: ReturnType<typeof setTimeout> | null = null;

    addToast(
        permanent ? "warning" : "success",
        permanent
            ? "Queued for permanent delete — Undo to cancel"
            : "Queued for Recycle Bin — Undo to cancel",
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
                    restoreRemovedNode(snapshot);
                },
            },
        }
    );

    tid = setTimeout(async () => {
        tid = null;
        if (cancelled) return;
        try {
            await invoke("delete_item", { path: node.path, permanent });
            addToast("success", permanent ? "Permanently deleted" : "Moved to Recycle Bin");
        } catch (err) {
            restoreRemovedNode(snapshot);
            addToast("error", `Failed to delete: ${err}`);
        }
    }, DELETE_DELAY_MS);
}
