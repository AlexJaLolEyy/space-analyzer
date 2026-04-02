import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ScanNode } from "../types/scan";

interface ScanState {
    scanTree: ScanNode | null;
    currentPath: string[];
    viewMode: "list" | "pie" | "bar" | "treemap" | "sunburst";
    sortBy: "size" | "name" | "count" | "modified";
    sortOrder: "asc" | "desc";
    searchQuery: string;
    categoryFilter: string;
    selectedDrive: { total_bytes: number; name: string } | null;
    selectedPaths: string[];
    selectionAnchorPath: string | null;
    setScanTree: (tree: ScanNode) => void;
    setSelectedDrive: (drive: { total_bytes: number; name: string } | null) => void;
    setCurrentPath: (path: string[]) => void;
    setViewMode: (mode: "list" | "pie" | "bar" | "treemap" | "sunburst") => void;
    setSort: (by: "size" | "name" | "count" | "modified", order: "asc" | "desc") => void;
    setSearchQuery: (query: string) => void;
    setCategoryFilter: (categoryFilter: string) => void;
    clearSelection: () => void;
    selectRowClick: (
        path: string,
        orderedPaths: string[],
        opts: { ctrlOrMeta: boolean; shift: boolean; isDir: boolean }
    ) => void;
    removeNode: (path: string) => void;
    restoreRemovedNode: (subtree: ScanNode) => void;
    removePathsFromSelection: (paths: string[]) => void;
    reset: () => void;
}

export const findNodeByPath = (root: ScanNode | null, pathParts: string[]): ScanNode | null => {
    if (!root) return null;
    let current = root;
    for (let i = 1; i < pathParts.length; i++) {
        const next = current.children.find((c) => c.name === pathParts[i]);
        if (!next) return current;
        current = next;
    }
    return current;
};

function findPathChain(root: ScanNode, targetPath: string): ScanNode[] | null {
    const norm = (p: string) => p.replace(/[/\\]+$/, "").toLowerCase();
    if (norm(root.path) === norm(targetPath)) return [root];
    for (const c of root.children) {
        const sub = findPathChain(c, targetPath);
        if (sub) return [root, ...sub];
    }
    return null;
}

function getParentPath(filePath: string): string | null {
    const norm = filePath.replace(/[/\\]+$/, "");
    const si = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
    if (si <= 0) return null;
    return norm.slice(0, si);
}

function removeNodeAndPropagate(root: ScanNode, pathToRemove: string): boolean {
    const childIndex = root.children.findIndex((c) => c.path === pathToRemove);
    if (childIndex !== -1) {
        const removedChild = root.children[childIndex];
        root.children.splice(childIndex, 1);
        root.size -= removedChild.size;
        root.file_count -= removedChild.file_count;
        return true;
    }

    for (const child of root.children) {
        const removed = removeNodeAndPropagate(child, pathToRemove);
        if (removed) {
            root.size = root.children.reduce((acc, c) => acc + c.size, 0);
            root.file_count = root.children.reduce((acc, c) => acc + c.file_count, 0);
            return true;
        }
    }

    return false;
}

function recomputeDirTotals(node: ScanNode) {
    if (!node.is_dir) return;
    node.size = node.children.reduce((acc, c) => acc + c.size, 0);
    node.file_count = node.children.reduce((acc, c) => acc + c.file_count, 0);
}

export const useScanStore = create<ScanState>()(
    immer((set) => ({
        scanTree: null,
        currentPath: [],
        viewMode: "list",
        sortBy: "size",
        sortOrder: "desc",
        searchQuery: "",
        categoryFilter: "all",
        selectedDrive: null,
        selectedPaths: [],
        selectionAnchorPath: null,

        setScanTree: (tree) =>
            set((state) => {
                state.scanTree = tree;
                state.currentPath = [tree.name];
                state.selectedPaths = [];
                state.selectionAnchorPath = null;
            }),

        setSelectedDrive: (drive) =>
            set((state) => {
                state.selectedDrive = drive;
            }),

        setCurrentPath: (path) =>
            set((state) => {
                state.currentPath = path;
            }),

        setViewMode: (mode) =>
            set((state) => {
                state.viewMode = mode;
            }),

        setSort: (sortBy, sortOrder) =>
            set((state) => {
                state.sortBy = sortBy;
                state.sortOrder = sortOrder;
            }),

        setSearchQuery: (searchQuery) =>
            set((state) => {
                state.searchQuery = searchQuery;
            }),

        setCategoryFilter: (categoryFilter) =>
            set((state) => {
                state.categoryFilter = categoryFilter;
            }),

        clearSelection: () =>
            set((state) => {
                state.selectedPaths = [];
                state.selectionAnchorPath = null;
            }),

        selectRowClick: (path, orderedPaths, opts) =>
            set((state) => {
                if (opts.isDir && !opts.ctrlOrMeta && !opts.shift) {
                    state.selectedPaths = [];
                    state.selectionAnchorPath = null;
                    return;
                }

                if (opts.shift && state.selectionAnchorPath) {
                    const a = orderedPaths.indexOf(state.selectionAnchorPath);
                    const b = orderedPaths.indexOf(path);
                    if (a >= 0 && b >= 0) {
                        const lo = Math.min(a, b);
                        const hi = Math.max(a, b);
                        const slice = orderedPaths.slice(lo, hi + 1);
                        state.selectedPaths = slice;
                        return;
                    }
                }

                if (opts.ctrlOrMeta) {
                    const set = new Set(state.selectedPaths);
                    if (set.has(path)) set.delete(path);
                    else set.add(path);
                    state.selectedPaths = Array.from(set);
                    state.selectionAnchorPath = path;
                    return;
                }

                state.selectedPaths = [path];
                state.selectionAnchorPath = path;
            }),

        removeNode: (pathToRemove) =>
            set((state) => {
                if (!state.scanTree) return;

                if (state.scanTree.path === pathToRemove) {
                    state.scanTree = null;
                    state.currentPath = [];
                    state.selectedPaths = [];
                    state.selectionAnchorPath = null;
                    return;
                }

                removeNodeAndPropagate(state.scanTree, pathToRemove);

                const currentNode = findNodeByPath(state.scanTree, state.currentPath);
                if (!currentNode) {
                    state.currentPath = [state.scanTree.name];
                }

                state.selectedPaths = state.selectedPaths.filter((p) => p !== pathToRemove);
            }),

        restoreRemovedNode: (subtree) =>
            set((state) => {
                if (!state.scanTree) return;
                const pp = getParentPath(subtree.path);
                if (!pp) return;
                const chain = findPathChain(state.scanTree, pp);
                if (!chain?.length) return;
                const parent = chain[chain.length - 1];
                if (parent.children.some((c) => c.path === subtree.path)) return;
                parent.children.push(subtree);
                parent.children.sort((a, b) => b.size - a.size);
                for (let i = chain.length - 1; i >= 0; i--) {
                    const n = chain[i];
                    if (n.is_dir) recomputeDirTotals(n);
                }
            }),

        removePathsFromSelection: (paths) =>
            set((state) => {
                const drop = new Set(paths);
                state.selectedPaths = state.selectedPaths.filter((p) => !drop.has(p));
            }),

        reset: () =>
            set((state) => {
                state.scanTree = null;
                state.currentPath = [];
                state.searchQuery = "";
                state.categoryFilter = "all";
                state.selectedDrive = null;
                state.selectedPaths = [];
                state.selectionAnchorPath = null;
            }),
    }))
);
