import { AnimatePresence, motion } from "framer-motion";
import { BarChartHorizontal, ChevronLeft, ChevronRight, Grid2X2, Home, LayoutList, PieChart, Search } from "lucide-react";
import { useMemo } from "react";
import { useScanStore } from "../../stores/scanStore";
import { BarChartView } from "./BarChartView";
import { ListView } from "./ListView";
import { PieChartView } from "./PieChartView";
import { TreemapView } from "./TreemapView";

const VIEW_BUTTONS = [
    { id: "list" as const, label: "List", icon: <LayoutList size={15} /> },
    { id: "pie" as const, label: "Pie", icon: <PieChart size={15} /> },
    { id: "bar" as const, label: "Bar", icon: <BarChartHorizontal size={15} /> },
    { id: "treemap" as const, label: "Map", icon: <Grid2X2 size={15} /> },
];

export function ViewContainer() {
    const {
        currentNode, currentPath,
        viewMode, setViewMode,
        searchQuery, setSearchQuery,
        setCurrentPath,
    } = useScanStore();

    const filteredNode = useMemo(() => {
        if (!currentNode) return null;
        let children = currentNode.children;
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            children = children.filter(c => c.name.toLowerCase().includes(query));
        }
        return { ...currentNode, children };
    }, [currentNode, searchQuery]);

    const canGoBack = currentPath.length > 1;

    if (!currentNode || !filteredNode) {
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
                    {VIEW_BUTTONS.map(btn => (
                        <button
                            key={btn.id}
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
                            title="Go up (Esc)"
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

                {/* Search */}
                <div className="flex items-center gap-2 bg-secondary/60 px-3 py-1.5 rounded-lg border border-border/60 focus-within:ring-2 focus-within:ring-ring w-52 transition-shadow shrink-0">
                    <Search size={13} className="text-muted-foreground shrink-0" />
                    <input
                        type="text"
                        placeholder="Filter items…"
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
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="flex-1 overflow-hidden relative glass m-3 mb-2 rounded-xl flex flex-col min-h-0"
                >
                    {viewMode === "list" && <ListView node={filteredNode} />}
                    {viewMode === "pie" && <PieChartView node={filteredNode} />}
                    {viewMode === "bar" && <BarChartView node={filteredNode} />}
                    {viewMode === "treemap" && <TreemapView node={filteredNode} />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
