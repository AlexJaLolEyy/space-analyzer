import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScanStore } from "../stores/scanStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ScanProgress, ScanResult, ScanStreamMsg } from "../types/scan";

export function useScan() {
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState<ScanProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const setScanTree = useScanStore((s) => s.setScanTree);
    const channelRef = useRef<Channel<ScanStreamMsg> | null>(null);

    const startScan = useCallback(
        async (path: string) => {
            try {
                if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
                    throw new Error("Tauri API is not available (run with 'bun run tauri dev')");
                }
                setIsScanning(true);
                setError(null);
                setProgress(null);
                useScanStore.getState().reset();

                const channel = new Channel<ScanStreamMsg>();
                channelRef.current = channel;
                channel.onmessage = (msg) => {
                    if (msg.type === "progress") {
                        setProgress({
                            files_scanned: Number(msg.files_scanned),
                            bytes_scanned: Number(msg.bytes_scanned),
                            current_path: msg.current_path,
                            percent: msg.percent,
                            elapsed_ms: Number(msg.elapsed_ms),
                            engine: msg.engine,
                        });
                    }
                };

                const excluded = useSettingsStore.getState().excludedPaths;
                const res = await invoke<ScanResult>("start_scan", { path, excluded, stream: channel });
                setScanTree(res.root);
                useScanStore.getState().setScanInfo({ engine: res.engine, elapsedMs: res.elapsed_ms });
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsScanning(false);
                setProgress(null);
                channelRef.current = null;
            }
        },
        [setScanTree]
    );

    const cancelScan = useCallback(async () => {
        if (isScanning) {
            try {
                await invoke("cancel_scan");
            } catch (err) {
                console.error("Failed to cancel scan:", err);
            }
        }
    }, [isScanning]);

    useEffect(() => {
        return () => {
            channelRef.current = null;
        };
    }, []);

    return { startScan, cancelScan, progress, isScanning, error };
}
