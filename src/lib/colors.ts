import type { FileCategory } from "../types/scan";

export const categoryColors: Record<FileCategory, string> = {
    Video: "hsl(280, 70%, 55%)",       // Purple
    Image: "hsl(150, 70%, 45%)",       // Green
    Audio: "hsl(30, 80%, 55%)",        // Orange
    Document: "hsl(210, 80%, 55%)",    // Blue
    Archive: "hsl(45, 90%, 50%)",      // Yellow
    Code: "hsl(180, 70%, 45%)",        // Cyan
    System: "hsl(0, 70%, 55%)",        // Red
    Executable: "hsl(340, 70%, 55%)",  // Pink
    Database: "hsl(20, 70%, 45%)",     // Brown
    Font: "hsl(250, 60%, 65%)",        // Soft Purple
    Other: "hsl(220, 10%, 60%)",       // Gray
};

export const getCategoryColor = (category: FileCategory) => {
    return categoryColors[category] || categoryColors.Other;
};
