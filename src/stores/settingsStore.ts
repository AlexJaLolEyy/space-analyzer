import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentColor = "blue" | "purple" | "emerald" | "amber" | "rose";
export type SizeUnit = "binary" | "decimal";

interface SettingsState {
    defaultViewMode: "list" | "pie" | "bar" | "treemap" | "sunburst";
    excludedPaths: string[];
    accentColor: AccentColor;
    sizeUnit: SizeUnit;
    setDefaultViewMode: (mode: "list" | "pie" | "bar" | "treemap" | "sunburst") => void;
    addExcludedPath: (path: string) => void;
    removeExcludedPath: (path: string) => void;
    setAccentColor: (color: AccentColor) => void;
    setSizeUnit: (unit: SizeUnit) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            defaultViewMode: "list",
            excludedPaths: ["$Recycle.Bin", "System Volume Information", "pagefile.sys", "hiberfil.sys"],
            accentColor: "blue",
            sizeUnit: "binary",
            setDefaultViewMode: (defaultViewMode) => set({ defaultViewMode }),
            addExcludedPath: (path) =>
                set((state) => ({
                    excludedPaths: [...state.excludedPaths, path],
                })),
            removeExcludedPath: (path) =>
                set((state) => ({
                    excludedPaths: state.excludedPaths.filter((p) => p !== path),
                })),
            setAccentColor: (accentColor) => set({ accentColor }),
            setSizeUnit: (sizeUnit) => set({ sizeUnit }),
        }),
        {
            name: "space-analyzer-settings",
        }
    )
);
