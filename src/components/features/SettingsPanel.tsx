import { useState } from "react";
import { motion } from "framer-motion";
import { Settings, X, Palette, HardDrive, FolderX, Info, Ruler, Plus, Trash2 } from "lucide-react";
import { useSettingsStore, type AccentColor } from "../../stores/settingsStore";

interface SettingsPanelProps {
    onClose: () => void;
}

const ACCENT_OPTIONS: { id: AccentColor; label: string; color: string }[] = [
    { id: "blue", label: "Ocean", color: "hsl(220, 70%, 52%)" },
    { id: "purple", label: "Violet", color: "hsl(258, 90%, 66%)" },
    { id: "emerald", label: "Forest", color: "hsl(152, 60%, 40%)" },
    { id: "amber", label: "Sunset", color: "hsl(38, 92%, 50%)" },
    { id: "rose", label: "Rose", color: "hsl(346, 87%, 60%)" },
];

const SECTION_TABS = [
    { id: "general", label: "General", icon: Settings },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "exclusions", label: "Exclusions", icon: FolderX },
    { id: "about", label: "About", icon: Info },
];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
    const {
        accentColor, setAccentColor,
        sizeUnit, setSizeUnit,
        defaultViewMode, setDefaultViewMode,
        excludedPaths, addExcludedPath, removeExcludedPath,
    } = useSettingsStore();

    const [activeTab, setActiveTab] = useState<"general" | "appearance" | "exclusions" | "about">("appearance");
    const [newPath, setNewPath] = useState("");

    const handleAddPath = () => {
        const trimmed = newPath.trim();
        if (trimmed && !excludedPaths.includes(trimmed)) {
            addExcludedPath(trimmed);
            setNewPath("");
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 16 }}
                transition={{ type: "spring", stiffness: 360, damping: 30 }}
                className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col"
                style={{ maxHeight: "85vh" }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <Settings size={20} className="text-primary" />
                        <h2 className="text-lg font-bold tracking-tight">Settings</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden min-h-0">
                    {/* Sidebar */}
                    <div className="w-44 border-r border-border/50 p-3 flex flex-col gap-1 shrink-0">
                        {SECTION_TABS.map(tab => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left ${activeTab === tab.id
                                            ? "bg-primary text-primary-foreground"
                                            : "hover:bg-muted text-muted-foreground hover:text-foreground"
                                        }`}
                                >
                                    <Icon size={16} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-6 overflow-y-auto">
                        {/* ── Appearance ── */}
                        {activeTab === "appearance" && (
                            <div className="space-y-8">
                                <div>
                                    <h3 className="text-sm font-semibold mb-1">Accent Color</h3>
                                    <p className="text-xs text-muted-foreground mb-4">Instantly changes the app's primary color everywhere.</p>
                                    <div className="flex gap-3 flex-wrap">
                                        {ACCENT_OPTIONS.map(opt => (
                                            <button
                                                key={opt.id}
                                                onClick={() => setAccentColor(opt.id)}
                                                className={`flex flex-col items-center gap-2 group`}
                                                title={opt.label}
                                            >
                                                <div
                                                    className={`w-10 h-10 rounded-full transition-all duration-200 ${accentColor === opt.id
                                                            ? "ring-2 ring-offset-2 ring-offset-card ring-foreground scale-110"
                                                            : "hover:scale-105"
                                                        }`}
                                                    style={{ backgroundColor: opt.color }}
                                                />
                                                <span className={`text-xs transition-colors ${accentColor === opt.id ? "text-foreground font-semibold" : "text-muted-foreground"
                                                    }`}>
                                                    {opt.label}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── General ── */}
                        {activeTab === "general" && (
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold mb-1">Default View Mode</label>
                                    <p className="text-xs text-muted-foreground mb-3">Which view opens after a scan completes.</p>
                                    <select
                                        value={defaultViewMode}
                                        onChange={e => setDefaultViewMode(e.target.value as any)}
                                        className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm w-48 outline-none focus:ring-2 focus:ring-ring"
                                    >
                                        <option value="list">List View</option>
                                        <option value="pie">Pie Chart</option>
                                        <option value="bar">Bar Chart</option>
                                        <option value="treemap">Treemap</option>
                                        <option value="sunburst">Sunburst</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold mb-1">
                                        <span className="flex items-center gap-2"><Ruler size={14} /> Size Units</span>
                                    </label>
                                    <p className="text-xs text-muted-foreground mb-3">How file sizes are displayed throughout the app.</p>
                                    <div className="flex gap-3">
                                        {(["binary", "decimal"] as const).map(u => (
                                            <button
                                                key={u}
                                                onClick={() => setSizeUnit(u)}
                                                className={`flex flex-col items-start gap-0.5 px-4 py-3 rounded-xl border text-sm transition-all ${sizeUnit === u
                                                        ? "bg-primary/10 border-primary text-primary font-semibold"
                                                        : "border-border hover:border-muted-foreground text-muted-foreground"
                                                    }`}
                                            >
                                                <span className="font-mono">{u === "binary" ? "GiB" : "GB"}</span>
                                                <span className="text-xs font-normal">
                                                    {u === "binary" ? "1 KiB = 1024 B" : "1 kB = 1000 B"}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── Exclusions ── */}
                        {activeTab === "exclusions" && (
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-semibold mb-1">Excluded Paths</h3>
                                    <p className="text-xs text-muted-foreground mb-4">Folder names or path prefixes that will be skipped during scans.</p>
                                </div>

                                <div className="flex gap-2">
                                    <input
                                        value={newPath}
                                        onChange={e => setNewPath(e.target.value)}
                                        onKeyDown={e => e.key === "Enter" && handleAddPath()}
                                        placeholder="e.g. node_modules"
                                        className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring font-mono"
                                    />
                                    <button
                                        onClick={handleAddPath}
                                        className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>

                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {excludedPaths.map(path => (
                                        <div key={path} className="flex items-center justify-between py-2 px-3 bg-secondary/50 rounded-lg border border-border/40">
                                            <span className="text-sm font-mono truncate text-muted-foreground">{path}</span>
                                            <button
                                                onClick={() => removeExcludedPath(path)}
                                                className="ml-2 text-destructive hover:text-destructive/80 transition-colors shrink-0"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── About ── */}
                        {activeTab === "about" && (
                            <div className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                                        <HardDrive className="text-primary" size={32} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold">SpaceAnalyzer</h3>
                                        <p className="text-sm text-muted-foreground">v0.1.0 · Built with Tauri + React</p>
                                    </div>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    A modern, blazing-fast disk space analyzer with premium 2026-era design.
                                    Visualize your drives, find duplicates, and reclaim lost space in seconds.
                                </p>
                                <div className="text-xs text-muted-foreground space-y-1 border-t border-border/50 pt-4 font-mono">
                                    <p>Rust • Tauri v2 • React v19 • TypeScript</p>
                                    <p>framer-motion • recharts • d3-hierarchy • zustand</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}
