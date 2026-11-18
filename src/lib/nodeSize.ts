import { useSettingsStore, type SizeMode } from "../stores/settingsStore";

/** Logical size or size on disk, depending on the "Size / On disk" toggle. */
export function nodeSize(n: { size: number; alloc?: number }, mode: SizeMode): number {
    return mode === "disk" ? (n.alloc ?? n.size) : n.size;
}

export function useSizeMode(): SizeMode {
    return useSettingsStore((s) => s.sizeMode);
}
