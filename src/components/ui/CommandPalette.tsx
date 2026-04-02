import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { useScanStore } from "../../stores/scanStore";
import {
    BarChart3,
    CircleDashed,
    Copy,
    Download,
    FolderSearch,
    Grid2X2,
    History,
    Keyboard,
    List,
    PieChart,
    RotateCcw,
    Search,
    Sparkles,
    Sun,
    Moon,
    Monitor,
} from "lucide-react";

export interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenExport: () => void;
    onToggleDuplicates: () => void;
    onToggleDashboard: () => void;
    onFocusSearch: () => void;
    onOpenCustomPath: () => void;
    onNewScan: () => void;
    onOpenHistory: () => void;
    duplicatesOpen: boolean;
    dashboardVisible: boolean;
}

export function CommandPalette({
    open,
    onOpenChange,
    onOpenExport,
    onToggleDuplicates,
    onToggleDashboard,
    onFocusSearch,
    onOpenCustomPath,
    onNewScan,
    onOpenHistory,
    duplicatesOpen,
    dashboardVisible,
}: CommandPaletteProps) {
    const { theme, setTheme } = useTheme();
    const scanTree = useScanStore((s) => s.scanTree);
    const viewMode = useScanStore((s) => s.viewMode);
    const setViewMode = useScanStore((s) => s.setViewMode);
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (!open) setSearch("");
    }, [open]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                onOpenChange(!open);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onOpenChange]);

    useEffect(() => {
        if (!open) return;
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onOpenChange(false);
            }
        };
        window.addEventListener("keydown", onEsc);
        return () => window.removeEventListener("keydown", onEsc);
    }, [open, onOpenChange]);

    if (!open) return null;

    const run = (fn: () => void) => {
        fn();
        onOpenChange(false);
    };

    return (
        <div
            className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => {
                if (e.target === e.currentTarget) onOpenChange(false);
            }}
        >
            <Command
                className="w-full max-w-lg rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
                label="Command palette"
                shouldFilter
            >
                <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search size={16} className="text-muted-foreground shrink-0" />
                    <Command.Input
                        value={search}
                        onValueChange={setSearch}
                        placeholder="Search commands…"
                        className="flex-1 py-3 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                    />
                    <kbd className="hidden sm:inline text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                        Esc
                    </kbd>
                </div>
                <Command.List className="max-h-72 overflow-y-auto p-2">
                    <Command.Empty className="py-6 text-center text-sm text-muted-foreground">No matches.</Command.Empty>

                    <Command.Group heading="Views" className="text-[11px] font-semibold text-muted-foreground px-2 py-1.5">
                        <Command.Item
                            disabled={!scanTree || dashboardVisible}
                            onSelect={() => run(() => setViewMode("list"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <List size={14} /> List view {viewMode === "list" && "· current"}
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree || dashboardVisible}
                            onSelect={() => run(() => setViewMode("treemap"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <Grid2X2 size={14} /> Treemap {viewMode === "treemap" && "· current"}
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree || dashboardVisible}
                            onSelect={() => run(() => setViewMode("sunburst"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <CircleDashed size={14} /> Sunburst {viewMode === "sunburst" && "· current"}
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree || dashboardVisible}
                            onSelect={() => run(() => setViewMode("pie"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <PieChart size={14} /> Pie chart {viewMode === "pie" && "· current"}
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree || dashboardVisible}
                            onSelect={() => run(() => setViewMode("bar"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <BarChart3 size={14} /> Bar chart {viewMode === "bar" && "· current"}
                        </Command.Item>
                    </Command.Group>

                    <Command.Group heading="Navigate" className="text-[11px] font-semibold text-muted-foreground px-2 py-1.5">
                        <Command.Item
                            disabled={!scanTree}
                            onSelect={() => run(onToggleDashboard)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <Grid2X2 size={14} /> {dashboardVisible ? "Leave dashboard" : "Open dashboard"}
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree}
                            onSelect={() => run(onFocusSearch)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <Keyboard size={14} /> Focus list filter
                        </Command.Item>
                    </Command.Group>

                    <Command.Group heading="Actions" className="text-[11px] font-semibold text-muted-foreground px-2 py-1.5">
                        <Command.Item
                            disabled={!scanTree}
                            onSelect={() => run(onOpenExport)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <Download size={14} /> Export scan…
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree}
                            onSelect={() => run(onToggleDuplicates)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <Copy size={14} /> {duplicatesOpen ? "Close duplicates" : "Find duplicates"}
                        </Command.Item>
                        <Command.Item
                            onSelect={() => run(onOpenHistory)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted"
                        >
                            <History size={14} /> Scan history
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree}
                            onSelect={() => run(onOpenCustomPath)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <FolderSearch size={14} /> Scan custom folder…
                        </Command.Item>
                        <Command.Item
                            disabled={!scanTree}
                            onSelect={() => run(onNewScan)}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted data-[disabled=true]:opacity-40"
                        >
                            <RotateCcw size={14} /> New scan (drives)
                        </Command.Item>
                    </Command.Group>

                    <Command.Group heading="Appearance" className="text-[11px] font-semibold text-muted-foreground px-2 py-1.5">
                        <Command.Item
                            onSelect={() => run(() => setTheme("light"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted"
                        >
                            <Sun size={14} /> Light theme {theme === "light" && "· on"}
                        </Command.Item>
                        <Command.Item
                            onSelect={() => run(() => setTheme("dark"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted"
                        >
                            <Moon size={14} /> Dark theme {theme === "dark" && "· on"}
                        </Command.Item>
                        <Command.Item
                            onSelect={() => run(() => setTheme("system"))}
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm cursor-pointer aria-selected:bg-muted"
                        >
                            <Monitor size={14} /> System theme {theme === "system" && "· on"}
                        </Command.Item>
                    </Command.Group>
                </Command.List>
                <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-2">
                    <Sparkles size={12} />
                    Ctrl+K to toggle · Enter runs · Esc closes
                </div>
            </Command>
        </div>
    );
}
