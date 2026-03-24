export type SizeUnitMode = "binary" | "decimal";

export function formatBytes(bytes: number, decimals = 2, unit: SizeUnitMode = "binary"): string {
    if (!+bytes) return "0 B";

    const k = unit === "binary" ? 1024 : 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = unit === "binary"
        ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
        : ["B", "kB", "MB", "GB", "TB", "PB"];

    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/** Format a number of bytes for display, reading the setting from the store if in React context. */
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
