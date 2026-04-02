import { AnimatePresence, motion } from "framer-motion";
import { BarChartHorizontal, ChevronLeft, ChevronRight, Grid2X2, Home, LayoutList, PieChart, Search, CircleDashed } from "lucide-react";
import { useMemo } from "react";
import { findNodeByPath, useScanStore } from "../../stores/scanStore";
import { BarChartView } from "./BarChartView";
import { ListView } from "./ListView";
import { PieChartView } from "./PieChartView";
import { TreemapView } from "./TreemapView";
import { SunburstView } from "./SunburstView";

const VIEW_BUTTONS = [
    { id: "list" as const, label: "List", icon: <LayoutList size={15} /> },
    { id: "pie" as const, label: "Pie", icon: <PieChart size={15} /> },
    { id: "bar" as const, label: "Bar", icon: <BarChartHorizontal size={15} /> },
    { id: "treemap" as const, label: "Map", icon: <Grid2X2 size={15} /> },
    { id: "sunburst" as const, label: "Sunburst", icon: <CircleDashed size={15} /> },
];

export function ViewContainer() {
    const scanTree = useScanStore((s) => s.scanTree);
    const currentPath = useScanStore((s) => s.currentPath);
    const currentNode = useScanStore((s) => findNodeByPath(s.scanTree, s.currentPath) ?? s.scanTree);
    const viewMode = useScanStore((s) => s.viewMode);
    const setViewMode = useScanStore((s) => s.setViewMode);
    const searchQuery = useScanStore((s) => s.searchQuery);
    const setSearchQuery = useScanStore((s) => s.setSearchQuery);
    const categoryFilter = useScanStore((s) => s.categoryFilter);
    const setCategoryFilter = useScanStore((s) => s.setCategoryFilter);
    const setCurrentPath = useScanStore((s) => s.setCurrentPath);

    const filteredNode = useMemo(() => {
        if (!currentNode) return null;
        let children = currentNode.children;
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            children = children.filter(c => c.name.toLowerCase().includes(query));
        }
        if (categoryFilter !== "all") {
            children = children.filter(c => c.category === categoryFilter || c.is_dir);
        }
        return { ...currentNode, children };
    }, [currentNode, searchQuery, categoryFilter]);

    const canGoBack = currentPath.length > 1;

    if (!scanTree || !currentNode || !filteredNode) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
                No data to display. Please run a scan.
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col w-full h-full overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 bg-background/40 flex-wrap shrink-0">
                {/* View mode tabs */}
                <div className="flex gap-1 p-1 bg-secondary rounded-lg">
                    {VIEW_BUTTONS.map((btn, index) => (
                        <button
                            key={btn.id}
                            title={`${btn.label} view (${index + 1})`}
                            onClick={() => setViewMode(btn.id)}
                            className={`px-2.5 py-1.5 rounded-md flex items-center gap-1.5 text-xs font-semibold transition-all duration-150 ${viewMode === btn.id
                                ? "bg-background shadow-sm text-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                }`}
                        >
                            {btn.icon} {btn.label}
                        </button>
                    ))}
                </div>

                {/* Breadcrumb nav */}
                <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-hidden flex-1 min-w-0">
                    {canGoBack && (
                        <button
                            onClick={() => setCurrentPath(currentPath.slice(0, -1))}
                            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
                            title="Go up (Esc, Ctrl+Backspace)"
                        >
                            <ChevronLeft size={13} />
                        </button>
                    )}
                    <button
                        onClick={() => setCurrentPath([currentPath[0]])}
                        className="hover:text-foreground transition-colors shrink-0"
                        title="Go to root"
                    >
                        <Home size={12} />
                    </button>
                    {currentPath.slice(1).map((segment, i) => {
                        const targetIndex = i + 1;
                        const isLast = targetIndex === currentPath.length - 1;
                        return (
                            <span key={`bc-${i}`} className="flex items-center gap-1 min-w-0">
                                <ChevronRight size={11} className="opacity-40 shrink-0" />
                                <button
                                    onClick={() => !isLast && setCurrentPath(currentPath.slice(0, targetIndex + 1))}
                                    className={`truncate max-w-28 transition-colors ${isLast
                                        ? "text-foreground font-semibold pointer-events-none"
                                        : "hover:text-foreground"
                                        }`}
                                    title={segment}
                                >
                                    {segment}
                                </button>
                            </span>
                        );
                    })}
                </div>

                {/* Category Filter */}
                <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value as any)}
                    className="bg-secondary/60 border border-border/60 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-ring outline-none"
                    title="Filter by category"
                >
                    <option value="all">All Types</option>
                    <option value="Image">Images</option>
                    <option value="Video">Videos</option>
                    <option value="Audio">Audio</option>
                    <option value="Document">Documents</option>
                    <option value="Archive">Archives</option>
                    <option value="Code">Code</option>
                    <option value="Executable">Executables</option>
                    <option value="System">System</option>
                    <option value="Database">Databases</option>
                    <option value="Font">Fonts</option>
                    <option value="Unknown">Others</option>
                </select>

                {/* Search */}
                <div className="flex items-center gap-2 bg-secondary/60 px-3 py-1.5 rounded-lg border border-border/60 focus-within:ring-2 focus-within:ring-ring w-52 transition-shadow shrink-0">
                    <Search size={13} className="text-muted-foreground shrink-0" />
                    <input
                        type="text"
                        placeholder="Filter items… (Ctrl+F)"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="bg-transparent border-none outline-none text-xs w-full placeholder:text-muted-foreground"
                    />
                </div>
            </div>

            {/* Main View Area */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={viewMode}
                    initial={{ opacity: 0, scale: 0.98, x: 10 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.98, x: -10 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="flex-1 overflow-hidden relative glass m-3 mb-2 rounded-xl flex flex-col min-h-0"
                >
                    {viewMode === "list" && <ListView node={filteredNode} />}
                    {viewMode === "pie" && <PieChartView node={filteredNode} />}
                    {viewMode === "bar" && <BarChartView node={filteredNode} />}
                    {viewMode === "treemap" && <TreemapView node={filteredNode} />}
                    {viewMode === "sunburst" && <SunburstView node={filteredNode} />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
