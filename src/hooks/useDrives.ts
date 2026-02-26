import { useEffect, useState } from "react";
import { listDrives } from "../lib/tauri";
import type { DriveInfo } from "../types/drive";

export function useDrives() {
    const [drives, setDrives] = useState<DriveInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchDrives() {
            try {
                setIsLoading(true);
                const data = await listDrives();
                setDrives(data);
                setError(null);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsLoading(false);
            }
        }

        fetchDrives();
    }, []);

    return { drives, isLoading, error };
}
