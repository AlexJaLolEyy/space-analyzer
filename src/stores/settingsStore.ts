import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentColor = "blue" | "purple" | "emerald" | "amber" | "rose";
export type SizeUnit = "binary" | "decimal";
export type ViewMode = "list" | "pie" | "bar" | "treemap";
export type SizeMode = "logical" | "disk";

interface SettingsState {
    defaultViewMode: ViewMode;
    excludedPaths: string[];
    accentColor: AccentColor;
    sizeUnit: SizeUnit;
    /** Show logical size or size on disk (allocated clusters). */
    sizeMode: SizeMode;
    skipElevationPrompt: boolean;
    /** Keep a file watcher on folder scans (drive roots are off unless toggled per scan). */
    liveUpdates: boolean;
    setSkipElevationPrompt: (v: boolean) => void;
    setDefaultViewMode: (mode: ViewMode) => void;
    addExcludedPath: (path: string) => void;
    removeExcludedPath: (path: string) => void;
    setAccentColor: (color: AccentColor) => void;
    setSizeUnit: (unit: SizeUnit) => void;
    setSizeMode: (mode: SizeMode) => void;
    setLiveUpdates: (v: boolean) => void;
}

const OLD_DEFAULT_EXCLUDES = ["$Recycle.Bin", "System Volume Information", "pagefile.sys", "hiberfil.sys"];

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            defaultViewMode: "list",
            excludedPaths: [],
            accentColor: "blue",
            sizeUnit: "binary",
            sizeMode: "logical",
            skipElevationPrompt: false,
            liveUpdates: true,
            setSkipElevationPrompt: (skipElevationPrompt) => set({ skipElevationPrompt }),
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
            setSizeMode: (sizeMode) => set({ sizeMode }),
            setLiveUpdates: (liveUpdates) => set({ liveUpdates }),
        }),
        {
            name: "space-analyzer-settings",
            version: 1,
            migrate: (persisted, version) => {
                const s = (persisted ?? {}) as Partial<Omit<SettingsState, "defaultViewMode">> & { defaultViewMode?: string };
                if (version < 1) {
                    // the old defaults hid pagefile.sys / hiberfil.sys, which are real space users
                    const ex = s.excludedPaths;
                    if (ex && ex.length === OLD_DEFAULT_EXCLUDES.length && ex.every((p, i) => p === OLD_DEFAULT_EXCLUDES[i])) {
                        s.excludedPaths = [];
                    }
                    if (s.defaultViewMode === "sunburst") s.defaultViewMode = "list";
                }
                return s as unknown as SettingsState;
            },
        }
    )
);