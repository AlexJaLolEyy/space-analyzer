import { create } from "zustand";

interface UiState {
    isElevated: boolean | null;
    setIsElevated: (v: boolean | null) => void;
    showElevationDialog: boolean;
    setShowElevationDialog: (v: boolean) => void;
    showSettings: boolean;
    setShowSettings: (v: boolean) => void;
    /** Reported by the live watcher: the disk no longer matches the loaded scan. */
    changedOnDisk: { count: number; dirs: string[] } | null;
    setChangedOnDisk: (v: { count: number; dirs: string[] } | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
    isElevated: null,
    setIsElevated: (isElevated) => set({ isElevated }),
    showElevationDialog: false,
    setShowElevationDialog: (showElevationDialog) => set({ showElevationDialog }),
    showSettings: false,
    setShowSettings: (showSettings) => set({ showSettings }),
    changedOnDisk: null,
    setChangedOnDisk: (changedOnDisk) => set({ changedOnDisk }),
}));
