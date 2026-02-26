import { create } from "zustand";
import type { ScanNode } from "../types/scan";

interface ScanState {
    scanTree: ScanNode | null;
    currentPath: string[];
    currentNode: ScanNode | null;
    viewMode: "list" | "pie" | "bar" | "treemap";
    sortBy: "size" | "name" | "count" | "modified";
    sortOrder: "asc" | "desc";
    searchQuery: string;
    setScanTree: (tree: ScanNode) => void;
    setCurrentPath: (path: string[]) => void;
    setViewMode: (mode: "list" | "pie" | "bar" | "treemap") => void;
    setSort: (by: "size" | "name" | "count" | "modified", order: "asc" | "desc") => void;
    setSearchQuery: (query: string) => void;
    reset: () => void;
}

const findNodeByPath = (root: ScanNode | null, pathParts: string[]): ScanNode | null => {
    if (!root) return null;
    let current = root;
    for (let i = 1; i < pathParts.length; i++) {
        const next = current.children.find((c) => c.name === pathParts[i]);
        if (!next) return current;
        current = next;
    }
    return current;
};

export const useScanStore = create<ScanState>((set) => ({
    scanTree: null,
    currentPath: [],
    currentNode: null,
    viewMode: "list",
    sortBy: "size",
    sortOrder: "desc",
    searchQuery: "",

    setScanTree: (tree) =>
        set({
            scanTree: tree,
            currentPath: [tree.name],
            currentNode: tree,
        }),

    setCurrentPath: (path) =>
        set((state) => ({
            currentPath: path,
            currentNode: findNodeByPath(state.scanTree, path) || state.scanTree,
        })),

    setViewMode: (mode) => set({ viewMode: mode }),

    setSort: (sortBy, sortOrder) => set({ sortBy, sortOrder }),

    setSearchQuery: (searchQuery) => set({ searchQuery }),

    reset: () =>
        set({
            scanTree: null,
            currentPath: [],
            currentNode: null,
            searchQuery: "",
        }),
}));
