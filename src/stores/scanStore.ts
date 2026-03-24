import { create } from "zustand";
import type { ScanNode } from "../types/scan";

interface ScanState {
    scanTree: ScanNode | null;
    currentPath: string[];
    currentNode: ScanNode | null;
    viewMode: "list" | "pie" | "bar" | "treemap" | "sunburst";
    sortBy: "size" | "name" | "count" | "modified";
    sortOrder: "asc" | "desc";
    searchQuery: string;
    categoryFilter: string;
    selectedDrive: { total_bytes: number; name: string } | null;
    setScanTree: (tree: ScanNode) => void;
    setSelectedDrive: (drive: { total_bytes: number; name: string } | null) => void;
    setCurrentPath: (path: string[]) => void;
    setViewMode: (mode: "list" | "pie" | "bar" | "treemap" | "sunburst") => void;
    setSort: (by: "size" | "name" | "count" | "modified", order: "asc" | "desc") => void;
    setSearchQuery: (query: string) => void;
    setCategoryFilter: (categoryFilter: string) => void;
    removeNode: (path: string) => void;
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
    categoryFilter: "all",
    selectedDrive: null,

    setScanTree: (tree) =>
        set({
            scanTree: tree,
            currentPath: [tree.name],
            currentNode: tree,
        }),

    setSelectedDrive: (drive) => set({ selectedDrive: drive }),

    setCurrentPath: (path) =>
        set((state) => ({
            currentPath: path,
            currentNode: findNodeByPath(state.scanTree, path) || state.scanTree,
        })),

    setViewMode: (mode) => set({ viewMode: mode }),

    setSort: (sortBy, sortOrder) => set({ sortBy, sortOrder }),

    setSearchQuery: (searchQuery) => set({ searchQuery }),

    setCategoryFilter: (categoryFilter) => set({ categoryFilter }),

    removeNode: (pathToRemove) =>
        set((state) => {
            if (!state.scanTree) return state;

            // Deep clone function to avoid mutating state directly
            const cloneNode = (node: ScanNode): ScanNode => ({
                ...node,
                children: node.children.map(cloneNode)
            });

            const newTree = cloneNode(state.scanTree);

            // Recursive function to find, remove, and update sizes
            const removeAndPropagate = (node: ScanNode): { removed: boolean; sizeSubtracted: number } => {
                const childIndex = node.children.findIndex(c => c.path === pathToRemove);

                if (childIndex !== -1) {
                    const removedChild = node.children[childIndex];
                    node.children.splice(childIndex, 1);
                    node.size -= removedChild.size;
                    node.file_count -= removedChild.file_count;
                    return { removed: true, sizeSubtracted: removedChild.size };
                }

                for (let i = 0; i < node.children.length; i++) {
                    const result = removeAndPropagate(node.children[i]);
                    if (result.removed) {
                        node.size -= result.sizeSubtracted;
                        // For file count, if a folder is deleted, we subtract its total files from parent
                        // Assuming file_count trickles up. This is a simplification.
                        return result;
                    }
                }

                return { removed: false, sizeSubtracted: 0 };
            };

            if (newTree.path === pathToRemove) {
                // If the root is removed, reset
                return { scanTree: null, currentPath: [], currentNode: null };
            }

            removeAndPropagate(newTree);

            return {
                scanTree: newTree,
                currentNode: findNodeByPath(newTree, state.currentPath) || newTree,
            };
        }),

    reset: () =>
        set({
            scanTree: null,
            currentPath: [],
            currentNode: null,
            searchQuery: "",
            categoryFilter: "all",
            selectedDrive: null,
        }),
}));
