import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useScanStore } from "../../stores/scanStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useToastStore } from "../../stores/toastStore";
import { useUiStore } from "../../stores/uiStore";

interface Schedule {
    path: string;
    frequency: "daily" | "weekly";
    time: string;
    day: string;
    excluded: string[];
}

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function ScheduleSection() {
    const excludedPaths = useSettingsStore((s) => s.excludedPaths);
    const rootPath = useScanStore((s) => s.scanTree?.path ?? "");
    const isElevated = useUiStore((s) => s.isElevated);
    const addToast = useToastStore((s) => s.addToast);

    const [active, setActive] = useState(false);
    const [path, setPath] = useState(rootPath);
    const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
    const [time, setTime] = useState("03:00");
    const [day, setDay] = useState("MON");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        invoke<Schedule | null>("get_schedule")
            .then((s) => {
                if (!s) return;
                setActive(true);
                setPath(s.path);
                setFrequency(s.frequency);
                setTime(s.time);
                setDay(s.day);
            })
            .catch(() => {});
    }, []);

    const save = async () => {
        setBusy(true);
        try {
            await invoke("set_schedule", { schedule: { path, frequency, time, day, excluded: excludedPaths } });
            setActive(true);
            addToast("success", "Scheduled snapshot saved");
        } catch (e) {
            addToast("error", `${e}`);
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        setBusy(true);
        try {
            await invoke("remove_schedule");
            setActive(false);
            addToast("success", "Scheduled snapshot removed");
        } catch (e) {
            addToast("error", `${e}`);
        } finally {
            setBusy(false);
        }
    };

    const browse = async () => {
        const p = await open({ directory: true, multiple: false }).catch(() => null);
        if (typeof p === "string") setPath(p);
    };

    const field = "bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

    return (
        <div className="space-y-4">
            <div>
                <h3 className="text-sm font-semibold mb-1">Scheduled snapshots</h3>
                <p className="text-xs text-muted-foreground">
                    Windows Task Scheduler scans this folder in the background and saves a snapshot, so the next scan can show what
                    changed. The app does not need to be open.
                    {isElevated
                        ? " The task runs with highest privileges, so it can use fast Turbo scans."
                        : " Created without admin rights, the task uses Standard scans. Run the app as admin to schedule Turbo scans."}
                </p>
            </div>

            <div className="flex gap-2">
                <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\" className={`flex-1 font-mono ${field}`} />
                <button onClick={browse} title="Browse" className="px-3 py-2 bg-secondary hover:bg-muted rounded-lg border border-border">
                    <FolderOpen size={16} />
                </button>
            </div>

            <div className="flex flex-wrap gap-3 items-center">
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as "daily" | "weekly")} className={field}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                </select>
                {frequency === "weekly" && (
                    <select value={day} onChange={(e) => setDay(e.target.value)} className={field}>
                        {DAYS.map((d) => (
                            <option key={d}>{d}</option>
                        ))}
                    </select>
                )}
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} />
            </div>

            <div className="flex gap-2">
                <button
                    onClick={save}
                    disabled={busy || !path.trim()}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                    {active ? "Update schedule" : "Create schedule"}
                </button>
                {active && (
                    <button
                        onClick={remove}
                        disabled={busy}
                        className="px-4 py-2 bg-secondary hover:bg-muted rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                        Remove
                    </button>
                )}
            </div>
            {excludedPaths.length > 0 && (
                <p className="text-xs text-muted-foreground">Your {excludedPaths.length} exclusion(s) are applied to scheduled scans too.</p>
            )}
        </div>
    );
}
