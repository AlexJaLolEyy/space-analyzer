import type { FileCategory } from "../types/scan";

// Read category colors from CSS custom properties — single source of truth.
// Falls back to hardcoded values if CSS vars aren't available (e.g. during SSR/tests).
const CSS_VAR_MAP: Record<FileCategory, string> = {
    Video: "--cat-video",
    Image: "--cat-image",
    Audio: "--cat-audio",
    Document: "--cat-document",
    Archive: "--cat-archive",
    Code: "--cat-code",
    System: "--cat-system",
    Executable: "--cat-executable",
    Database: "--cat-database",
    Font: "--cat-font",
    Other: "--cat-other",
};

// Static fallbacks (match the CSS values)
const FALLBACK_COLORS: Record<FileCategory, string> = {
    Video: "hsl(280, 70%, 55%)",
    Image: "hsl(150, 70%, 42%)",
    Audio: "hsl(30, 80%, 55%)",
    Document: "hsl(210, 80%, 55%)",
    Archive: "hsl(45, 90%, 50%)",
    Code: "hsl(180, 70%, 42%)",
    System: "hsl(0, 70%, 55%)",
    Executable: "hsl(340, 70%, 55%)",
    Database: "hsl(20, 70%, 45%)",
    Font: "hsl(250, 60%, 65%)",
    Other: "hsl(220, 10%, 60%)",
};

export function getCategoryColor(category: FileCategory): string {
    if (typeof window !== "undefined") {
        const val = getComputedStyle(document.documentElement)
            .getPropertyValue(CSS_VAR_MAP[category])
            .trim();
        if (val) return val;
    }
    return FALLBACK_COLORS[category] ?? FALLBACK_COLORS.Other;
}

// Convenience array of all category keys in display order
export const CATEGORY_KEYS: FileCategory[] = [
    "Video", "Image", "Audio", "Document", "Archive",
    "Code", "Executable", "System", "Database", "Font", "Other",
];

// Directory colors — a curated palette for folder color-coding in charts
export const DIR_COLORS = [
    "hsl(220, 80%, 60%)",
    "hsl(258, 70%, 65%)",
    "hsl(180, 60%, 45%)",
    "hsl(150, 60%, 45%)",
    "hsl(38, 85%, 55%)",
    "hsl(340, 70%, 60%)",
    "hsl(30, 80%, 55%)",
    "hsl(280, 60%, 60%)",
    "hsl(199, 80%, 52%)",
    "hsl(120, 55%, 45%)",
];

export function getDirColor(index: number): string {
    return DIR_COLORS[index % DIR_COLORS.length];
}
