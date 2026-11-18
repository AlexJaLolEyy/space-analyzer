import { useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";

export type SizeUnitMode = "binary" | "decimal";
export function formatBytes(bytes: number, decimals = 2, unit: SizeUnitMode = useSettingsStore.getState().sizeUnit): string {
    if (!+bytes) return "0 B";

    const k = unit === "binary" ? 1024 : 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = unit === "binary"
        ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
        : ["B", "kB", "MB", "GB", "TB", "PB"];

    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/** Size formatter bound to the `sizeUnit` setting; re-renders the caller when it changes. */
export function useFormatBytes(): (bytes: number, decimals?: number) => string {
    const unit = useSettingsStore((s) => s.sizeUnit);
    return useCallback((bytes: number, decimals = 2) => formatBytes(bytes, decimals, unit), [unit]);
}

/** Signed size change, e.g. "+12.3 GiB" or "−4 GiB". */
export function formatDelta(delta: number, fmt: (b: number, d?: number) => string = formatBytes): string {
    return `${delta < 0 ? "−" : "+"}${fmt(Math.abs(delta), 1)}`;
}

export function formatRelativeDate(timestamp: number | null): string {
    if (!timestamp) return "Unknown";
    const now = Date.now();
    const diffMs = now - (timestamp * 1000); // timestamps are seconds
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 1) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
}
