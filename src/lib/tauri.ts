import { invoke } from "@tauri-apps/api/core";
import type { DriveInfo } from "../types/drive";

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const listDrives = async (): Promise<DriveInfo[]> => {
    if (!isTauri) {
        throw new Error("Tauri API is not available. Please run the application using 'bun run tauri dev' instead of just 'bun run dev'.");
    }
    return invoke<DriveInfo[]>("list_drives");
};
