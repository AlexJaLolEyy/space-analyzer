import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScanStore } from "../stores/scanStore";
import type { ScanNode, ScanProgress } from "../types/scan";

export function useScan() {
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState<ScanProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { setScanTree } = useScanStore();
    const unlistenRef = useRef<UnlistenFn | null>(null);

    useEffect(() => {
        return () => {
            if (unlistenRef.current) {
                unlistenRef.current();
            }
        };
    }, []);

    const startScan = useCallback(async (path: string) => {
        try {
            if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
                throw new Error("Tauri API is not available (run with 'bun run tauri dev')");
            }
            setIsScanning(true);
            setError(null);
            setProgress(null);
            useScanStore.getState().reset();

            if (unlistenRef.current) {
                unlistenRef.current();
            }

            const unlisten = await listen<ScanProgress>("scan-progress", (event) => {
                setProgress(event.payload);
            });
            unlistenRef.current = unlisten;

            const result = await invoke<ScanNode>("start_scan", { path });
            setScanTree(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsScanning(false);
            setProgress(null);
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
        }
    }, [setScanTree]);

    const cancelScan = useCallback(async () => {
        if (isScanning) {
            try {
                await invoke("cancel_scan");
            } catch (err) {
                console.error("Failed to cancel scan:", err);
            }
        }
    }, [isScanning]);

    return { startScan, cancelScan, progress, isScanning, error };
}
