import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
    defaultViewMode: "list" | "pie" | "bar" | "treemap";
    excludedPaths: string[];
    setDefaultViewMode: (mode: "list" | "pie" | "bar" | "treemap") => void;
    addExcludedPath: (path: string) => void;
    removeExcludedPath: (path: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            defaultViewMode: "list",
            excludedPaths: ["$Recycle.Bin", "System Volume Information", "pagefile.sys", "hiberfil.sys"],
            setDefaultViewMode: (defaultViewMode) => set({ defaultViewMode }),
            addExcludedPath: (path) =>
                set((state) => ({
                    excludedPaths: [...state.excludedPaths, path],
                })),
            removeExcludedPath: (path) =>
                set((state) => ({
                    excludedPaths: state.excludedPaths.filter((p) => p !== path),
                })),
        }),
        {
            name: "space-analyzer-settings",
        }
    )
);
