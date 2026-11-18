import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FolderMinus, Sparkles, Trash2 } from "lucide-react";
import { useFormatBytes } from "../../lib/format";
import { invoke } from "@tauri-apps/api/core";
import { scheduleDeferredDeleteMany } from "../../lib/deferredDelete";
import { useToastStore } from "../../stores/toastStore";
import { ConfirmModal } from "../ui/ConfirmModal";

const SAFE_EXT = [".tmp", ".log", ".cache", ".bak"];

function fileMatchesSafeMode(name: string): boolean {
    const lower = name.toLowerCase();
    return SAFE_EXT.some((ext) => lower.endsWith(ext));
}

interface CleanupFileRef {
    path: string;
    size: number;
    name: string;
}

interface Suggestion {
    id: "temp" | "cache" | "downloads";
    title: string;
    description: string;
    files: CleanupFileRef[];
}

interface CleanupSuggestionsPanelProps {
    onClose: () => void;
}

const ONE_GB = 1024 ** 3;

export function CleanupSuggestionsPanel({ onClose }: CleanupSuggestionsPanelProps) {
    const fmt = useFormatBytes();
    const addToast = useToastStore((state) => state.addToast);
    const [safeMode, setSafeMode] = useState(true);
    const [confirmTarget, setConfirmTarget] = useState<Suggestion | null>(null);

    const [rawSuggestions, setRawSuggestions] = useState<Suggestion[]>([]);
    const [loading, setLoading] = useState(true);

    // Detection runs in the backend over the full scan (not just the folders loaded in the UI).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await invoke<{ temp: CleanupFileRef[]; cache: CleanupFileRef[]; downloads: CleanupFileRef[] }>(
                    "get_cleanup_candidates"
                );
                if (cancelled) return;
                const found: Suggestion[] = [];
                if (res.temp.length > 0)
                    found.push({ id: "temp", title: "System Temp Files", description: "Direct files under temp folders (not whole directories).", files: res.temp });
                if (res.cache.length > 0)
                    found.push({ id: "cache", title: "Application Caches", description: "Direct files under common cache locations.", files: res.cache });
                if (res.downloads.length > 0)
                    found.push({ id: "downloads", title: "User Downloads", description: "Direct files in Downloads folders (one level only).", files: res.downloads });
                setRawSuggestions(found);
            } catch (err) {
                if (!cancelled) addToast("error", `Cleanup scan failed: ${err}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [addToast]);

    const suggestions = useMemo(() => {
        return rawSuggestions
            .map((s) => {
                const activeFiles = safeMode ? s.files.filter((f) => fileMatchesSafeMode(f.name)) : s.files;
                const totalSize = activeFiles.reduce((a, f) => a + f.size, 0);
                return { ...s, activeFiles, totalSize };
            })
            .filter((s) => s.activeFiles.length > 0)
            .sort((a, b) => b.totalSize - a.totalSize);
    }, [rawSuggestions, safeMode]);

    const runClean = (_s: Suggestion, paths: string[]) => {
        const drop = new Set(paths);
        const before = rawSuggestions;
        setRawSuggestions((prev) =>
            prev
                .map((x) => ({ ...x, files: x.files.filter((f) => !drop.has(f.path)) }))
                .filter((x) => x.files.length > 0)
        );
        setConfirmTarget(null);
        scheduleDeferredDeleteMany(paths, {
            onUndo: () => setRawSuggestions(before),
            onFailed: () => setRawSuggestions(before),
        });
    };

    const confirmBody = confirmTarget
        ? (() => {
              const active = safeMode
                  ? confirmTarget.files.filter((f) => fileMatchesSafeMode(f.name))
                  : confirmTarget.files;
              const n = active.length;
              const bytes = active.reduce((a, f) => a + f.size, 0);
              const lines = [
                  `This will move ${n.toLocaleString()} file(s) (${fmt(bytes)}) to the Recycle Bin.`,
                  bytes > ONE_GB
                      ? "Warning: total size is over 1 GB. Make sure you intend to remove this much data."
                      : null,
              ].filter(Boolean);
              return lines.join("\n\n");
          })()
        : "";

    return (
        <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-120 border-l border-border bg-popover/90 backdrop-blur-xl shadow-2xl flex flex-col z-30"
        >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles className="text-primary shrink-0" size={20} />
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Smart Cleanup</h2>
                        <p className="text-xs text-muted-foreground">Files matched in your scan tree (direct children only)</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-foreground"
                >
                    ✕
                </button>
            </div>

            <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between gap-3 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">Safe Mode</span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={safeMode}
                    onClick={() => setSafeMode((v) => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${safeMode ? "bg-primary" : "bg-muted"}`}
                >
                    <span
                        className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-background shadow transition-transform ${safeMode ? "translate-x-5" : ""}`}
                    />
                </button>
            </div>
            {!safeMode && (
                <div className="mx-5 mt-3 flex items-start gap-2 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>Safe Mode is off: all direct files in these folders are listed. Confirm carefully before cleaning.</span>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {suggestions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 min-h-48">
                        <Sparkles size={48} className="opacity-20" />
                        <p>{loading ? "Searching the scan for cleanup candidates…" : "No matching cleanup files found in this scan."}</p>
                        <p className="text-[11px] text-center max-w-xs opacity-80">
                            Only immediate file children of temp/cache/downloads folders are listed.
                        </p>
                    </div>
                ) : (
                    suggestions.map((s) => (
                        <div key={s.id} className="bg-secondary/30 border border-border/50 rounded-2xl p-4 flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    {s.id === "temp" && <FolderMinus className="text-orange-500 shrink-0" size={18} />}
                                    {s.id === "cache" && <FolderMinus className="text-blue-500 shrink-0" size={18} />}
                                    {s.id === "downloads" && <AlertTriangle className="text-yellow-500 shrink-0" size={18} />}
                                    <h3 className="font-semibold truncate">{s.title}</h3>
                                </div>
                                <span className="font-mono text-sm font-bold text-primary shrink-0">
                                    {fmt(s.totalSize)}
                                </span>
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
                            <p className="text-xs text-muted-foreground">
                                {s.activeFiles.length.toLocaleString()} file(s)
                                {safeMode ? " matching .tmp, .log, .cache, .bak" : ""}
                            </p>
                            <ul className="max-h-28 overflow-y-auto text-xs font-mono bg-background/40 rounded-lg border border-border/40 divide-y divide-border/30">
                                {s.activeFiles.slice(0, 80).map((f) => (
                                    <li key={f.path} className="px-2 py-1 truncate" title={f.path}>
                                        {f.name}
                                    </li>
                                ))}
                                {s.activeFiles.length > 80 && (
                                    <li className="px-2 py-1 text-muted-foreground italic">
                                        +{s.activeFiles.length - 80} more…
                                    </li>
                                )}
                            </ul>
                            <button
                                onClick={() => setConfirmTarget(s)}
                                className="mt-1 w-full py-2 bg-primary text-primary-foreground font-medium rounded-xl hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                <Trash2 size={16} /> Clean {fmt(s.totalSize)}
                            </button>
                        </div>
                    ))
                )}
            </div>

            <ConfirmModal
                isOpen={!!confirmTarget}
                title={confirmTarget ? `Clean ${confirmTarget.title}?` : "Confirm"}
                message={confirmBody}
                confirmLabel="Move to Recycle Bin"
                variant="warning"
                isLoading={false}
                onConfirm={() => {
                    if (!confirmTarget) return;
                    const active = safeMode
                        ? confirmTarget.files.filter((f) => fileMatchesSafeMode(f.name))
                        : confirmTarget.files;
                    void runClean(
                        confirmTarget,
                        active.map((f) => f.path)
                    );
                }}
                onCancel={() => setConfirmTarget(null)}
            />
        </motion.div>
    );
}
