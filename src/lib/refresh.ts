import { invoke } from "@tauri-apps/api/core";
import { findNodeByPath, useScanStore } from "../stores/scanStore";
import { useToastStore } from "../stores/toastStore";
import type { ScanNode } from "../types/scan";

/** Refetches a folder's own totals and its children from the backend arena. */
export async function refreshPath(path: string): Promise<void> {
    try {
        const [info, children] = await Promise.all([
            invoke<ScanNode>("get_node_info", { path }),
            invoke<ScanNode[]>("get_children", { path, childDepth: 2 }),
        ]);
        const s = useScanStore.getState();
        s.patchNode(path, info);
        s.mergeChildren(path, children);
    } catch (e) {
        console.error("refreshPath failed:", e);
    }
}

/** Absolute path of the folder currently shown in the views. */
export function currentFolderPath(): string | null {
    const s = useScanStore.getState();
    return findNodeByPath(s.scanTree, s.currentPath)?.path ?? s.scanTree?.path ?? null;
}

/** Refreshes the scan root and the folder the user is looking at. */
export async function refreshRootAndCurrent(): Promise<void> {
    const root = useScanStore.getState().scanTree?.path;
    if (!root) return;
    const cur = currentFolderPath();
    await refreshPath(root);
    if (cur && cur.toLowerCase() !== root.toLowerCase()) await refreshPath(cur);
}

let rescanning = false;

/**
 * Re-reads a folder from disk (the backend splices it into the loaded scan), then refreshes
 * the folder and the totals of every ancestor up to the scan root.
 */
export async function rescanPath(path: string): Promise<void> {
    if (rescanning) return;
    rescanning = true;
    const toast = useToastStore.getState().addToast;
    try {
        const node = await invoke<ScanNode>("rescan_subtree", { path });
        const s = useScanStore.getState();
        s.invalidatePath(node.path);
        await refreshPath(node.path);
        const root = s.scanTree?.path;
        if (root) {
            let p = node.path;
            for (;;) {
                const i = p.lastIndexOf("\\");
                if (i <= 0) break;
                p = p.slice(0, i);
                if (p.length < root.length) break;
                const info = await invoke<ScanNode>("get_node_info", { path: p }).catch(() => null);
                if (info) useScanStore.getState().patchNode(p, info);
            }
            if (root.toLowerCase() !== node.path.toLowerCase()) {
                const info = await invoke<ScanNode>("get_node_info", { path: root }).catch(() => null);
                if (info) useScanStore.getState().patchNode(root, info);
            }
        }
        toast("success", `Refreshed ${node.name}`);
    } catch (e) {
        toast("error", `Refresh failed: ${e}`);
    } finally {
        rescanning = false;
    }
}

interface QuickRefreshResult {
    status: "refreshed" | "unsupported" | "needs_rescan";
    changed: number;
    message?: string;
}

/**
 * Refresh button: for a Turbo scan of a whole drive the NTFS change journal brings everything
 * up to date in about a second; otherwise the folder is rescanned from disk.
 */
export async function smartRefresh(path: string): Promise<void> {
    const s = useScanStore.getState();
    const root = s.scanTree?.path;
    const toast = useToastStore.getState().addToast;
    if (root && s.scanInfo?.engine === "Turbo" && path.toLowerCase() === root.toLowerCase()) {
        try {
            const r = await invoke<QuickRefreshResult>("quick_refresh");
            if (r.status === "refreshed") {
                // every folder may have changed: re-read the open chain from the root downwards
                const st = useScanStore.getState();
                for (let k = 1; k <= st.currentPath.length; k++) {
                    const p = findNodeByPath(st.scanTree, st.currentPath.slice(0, k))?.path;
                    if (p) await refreshPath(p);
                }
                toast("success", r.changed === 0 ? "Already up to date" : `Applied ${r.changed.toLocaleString()} changes`);
                return;
            }
            if (r.status === "needs_rescan") {
                toast("warning", `${r.message ?? "The change journal can't be replayed"}. Run a new scan to refresh everything.`);
                return;
            }
        } catch (e) {
            toast("error", `Refresh failed: ${e}`);
            return;
        }
    }
    await rescanPath(path);
}