import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { scheduleDeferredDelete } from "../../lib/deferredDelete";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import { useToastStore } from "../../stores/toastStore";
import type { ScanNode } from "../../types/scan";
import { ConfirmModal } from "../ui/ConfirmModal";
import { ListItem } from "./ListItem";

interface ListViewProps {
    node: ScanNode;
}

const itemVariants = {
    hidden: { opacity: 0, x: -12 },
    visible: (i: number) => ({
        opacity: 1,
        x: 0,
        transition: {
            delay: Math.min(i * 0.018, 0.25),
            duration: 0.22,
            ease: "easeOut" as const,
        },
    }),
};

export function ListView({ node }: ListViewProps) {
    const { sortBy, sortOrder, setSort, setCurrentPath, currentPath, selectRowClick, selectedPaths } = useScanStore();
    const addToast = useToastStore((s) => s.addToast);
    const removeNode = useScanStore((s) => s.removeNode);
    const restoreRemovedNode = useScanStore((s) => s.restoreRemovedNode);

    const [focusedIndex, setFocusedIndex] = useState(0);
    const [keyDeleteTarget, setKeyDeleteTarget] = useState<ScanNode | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

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

    const orderedPaths = useMemo(() => sortedChildren.map((c) => c.path), [sortedChildren]);

    const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

    useEffect(() => {
        setFocusedIndex((i) => {
            if (sortedChildren.length === 0) return 0;
            return Math.min(Math.max(0, i), sortedChildren.length - 1);
        });
    }, [sortedChildren.length]);

    useEffect(() => {
        const el = rowRefs.current[focusedIndex];
        el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [focusedIndex]);

    useEffect(() => {
        listRef.current?.focus({ preventScroll: true });
    }, [node.path]);

    const handleActivate = useCallback(
        (index: number, child: ScanNode, e: React.MouseEvent) => {
            setFocusedIndex(index);
            selectRowClick(child.path, orderedPaths, {
                ctrlOrMeta: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                isDir: child.is_dir,
            });
            if (child.is_dir && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                setCurrentPath([...currentPath, child.name]);
            }
        },
        [orderedPaths, selectRowClick, setCurrentPath, currentPath]
    );

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

    const onListKeyDown = (e: React.KeyboardEvent) => {
        if (sortedChildren.length === 0) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIndex((i) => Math.min(i + 1, sortedChildren.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const ch = sortedChildren[focusedIndex];
            if (ch?.is_dir) setCurrentPath([...currentPath, ch.name]);
        } else if (e.key === "Delete") {
            const ch = sortedChildren[focusedIndex];
            if (!ch || ch.path.includes(".space-analyzer")) return;
            e.preventDefault();
            setKeyDeleteTarget(ch);
        } else if (e.key === "Escape") {
            if (currentPath.length > 1) {
                e.preventDefault();
                e.stopPropagation();
                setCurrentPath(currentPath.slice(0, -1));
            }
        }
    };

    const confirmKeyboardDelete = () => {
        if (!keyDeleteTarget) return;
        const target = keyDeleteTarget;
        setKeyDeleteTarget(null);
        scheduleDeferredDelete({
            node: target,
            permanent: false,
            removeNode,
            restoreRemovedNode,
            addToast,
        });
    };

    return (
        <div className="flex-1 flex flex-col w-full overflow-hidden">
            <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none shrink-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => handleSortToggle("name")}
                        className="hover:text-foreground transition-colors flex items-center group ml-1"
                    >
                        Name {getSortIcon("name")}
                    </button>
                </div>

                <div className="flex items-center gap-6 pr-1">
                    <span className="text-muted-foreground/70 w-10 text-right">%</span>
                    <button
                        onClick={() => handleSortToggle("size")}
                        className="hover:text-foreground transition-colors flex items-center group"
                    >
                        Size {getSortIcon("size")}
                    </button>
                    <button
                        onClick={() => handleSortToggle("modified")}
                        className="hover:text-foreground transition-colors flex items-center group"
                    >
                        Modified {getSortIcon("modified")}
                    </button>
                    <span className="w-20">Bar</span>
                </div>
            </div>

            <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={onListKeyDown}
                className="flex-1 overflow-y-auto w-full no-scrollbar px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-md"
            >
                <AnimatePresence mode="wait">
                    <motion.div
                        key={node.path}
                        initial="hidden"
                        animate="visible"
                        className="flex flex-col"
                    >
                        {sortedChildren.slice(0, 1000).map((child, i) => (
                            <motion.div
                                key={`${child.path}-${i}`}
                                custom={i}
                                variants={i < 25 ? itemVariants : undefined}
                                className={i >= 25 ? "opacity-100" : ""}
                            >
                                <ListItem
                                    node={child}
                                    parentSize={node.size}
                                    onActivate={(n, ev) => handleActivate(i, n, ev)}
                                    isSelected={selectedSet.has(child.path)}
                                    isFocused={focusedIndex === i}
                                    rowRef={(el) => {
                                        rowRefs.current[i] = el;
                                    }}
                                />
                            </motion.div>
                        ))}
                        {sortedChildren.length > 1000 && (
                            <div className="p-4 text-center text-muted-foreground text-xs italic bg-muted/10 border-t border-border/50">
                                Showing top 1,000 items of {sortedChildren.length.toLocaleString()}.
                                <span className="block mt-1 opacity-70">Use the search bar or navigate deeper to find specific files.</span>
                            </div>
                        )}
                        {sortedChildren.length === 0 && (
                            <div className="p-16 text-center text-muted-foreground text-sm flex flex-col items-center gap-3">
                                <div className="w-16 h-16 rounded-2xl bg-muted/60 flex items-center justify-center text-3xl opacity-40">
                                    📂
                                </div>
                                <p>This folder appears to be empty.</p>
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

            <ConfirmModal
                isOpen={!!keyDeleteTarget}
                title="Move to Recycle Bin?"
                message={
                    keyDeleteTarget
                        ? `Move "${keyDeleteTarget.name}" (${formatBytes(keyDeleteTarget.size)}) to the Recycle Bin? You can undo for a few seconds after confirming.`
                        : ""
                }
                confirmLabel="Move to Bin"
                variant="warning"
                isLoading={false}
                onConfirm={confirmKeyboardDelete}
                onCancel={() => setKeyDeleteTarget(null)}
            />
        </div>
    );
}
