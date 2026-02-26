import { useMemo } from "react";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";
import { ListItem } from "./ListItem";

interface ListViewProps {
    node: ScanNode;
}

export function ListView({ node }: ListViewProps) {
    const { sortBy, sortOrder, setSort, setCurrentPath, currentPath } = useScanStore();

    const sortedChildren = useMemo(() => {
        let sorted = [...node.children];
        sorted.sort((a, b) => {
            let comparison = 0;
            if (sortBy === "size") {
                comparison = a.size - b.size;
            } else if (sortBy === "name") {
                comparison = a.name.localeCompare(b.name);
            } else if (sortBy === "count") {
                comparison = a.file_count - b.file_count;
            } else if (sortBy === "modified") {
                comparison = (a.last_modified || 0) - (b.last_modified || 0);
            }
            return sortOrder === "asc" ? comparison : -comparison;
        });
        return sorted;
    }, [node.children, sortBy, sortOrder]);

    const handleNodeClick = (child: ScanNode) => {
        if (child.is_dir) {
            setCurrentPath([...currentPath, child.name]);
        } else {
            console.log("File clicked:", child.name);
        }
    };

    const handleSortToggle = (by: "size" | "name" | "count" | "modified") => {
        if (sortBy === by) {
            setSort(by, sortOrder === "desc" ? "asc" : "desc");
        } else {
            setSort(by, "desc");
        }
    };

    const getSortIcon = (by: string) => {
        if (sortBy !== by) return <span className="opacity-0 group-hover:opacity-40 ml-1">↓</span>;
        return <span className="ml-1 text-primary">{sortOrder === "desc" ? "↓" : "↑"}</span>;
    };

    return (
        <div className="flex-1 flex flex-col w-full overflow-hidden">
            {/* Table Header Wrapper */}
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleSortToggle("name")}
                        className="hover:text-foreground transition-colors flex items-center group ml-1"
                    >
                        Name {getSortIcon("name")}
                    </button>
                </div>

                <div className="flex items-center gap-4 w-48 justify-end">
                    <button
                        onClick={() => handleSortToggle("size")}
                        className="hover:text-foreground transition-colors flex items-center group"
                    >
                        Size {getSortIcon("size")}
                    </button>
                    <button
                        onClick={() => handleSortToggle("count")}
                        className="hover:text-foreground transition-colors flex items-center group ml-2 w-20 justify-end"
                        title="File Count"
                    >
                        Count {getSortIcon("count")}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto w-full no-scrollbar px-2 py-2">
                {sortedChildren.map((child, idx) => (
                    <ListItem
                        key={`${child.path}-${idx}`}
                        node={child}
                        parentSize={node.size}
                        onClick={handleNodeClick}
                    />
                ))}
                {sortedChildren.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No files or folders found.
                    </div>
                )}
            </div>
        </div>
    );
}
