import { AlignLeft, Archive, ArchiveX, Code, Component, FileKey, Folder, HardDrive, Hexagon, Image, Music, RefreshCw, Shield, ShieldAlert, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { getCategoryColor } from "../../lib/colors";
import { scheduleDeferredDelete } from "../../lib/deferredDelete";
import { formatDelta, useFormatBytes } from "../../lib/format";
import { nodeSize, useSizeMode } from "../../lib/nodeSize";
import { rescanPath } from "../../lib/refresh";
import { useToastStore } from "../../stores/toastStore";
import type { FileCategory, ScanNode } from "../../types/scan";
import { ConfirmModal } from "../ui/ConfirmModal";

export const LIST_ROW_HEIGHT = 60;

interface ListItemProps {
    node: ScanNode;
    parentSize: number;
    onActivate: (node: ScanNode, e: React.MouseEvent) => void;
    isSelected?: boolean;
    isFocused?: boolean;
    rowRef?: React.RefCallback<HTMLDivElement | null>;
}

const getCategoryIcon = (category: FileCategory, isDir: boolean, color: string) => {
    if (isDir) return <Folder color={color} size={18} className="fill-current opacity-70" />;
    switch (category) {
        case "Video": return <Video color={color} size={18} />;
        case "Image": return <Image color={color} size={18} />;
        case "Audio": return <Music color={color} size={18} />;
        case "Document": return <AlignLeft color={color} size={18} />;
        case "Archive": return <Archive color={color} size={18} />;
        case "Code": return <Code color={color} size={18} />;
        case "System": return <Shield color={color} size={18} />;
        case "Executable": return <Hexagon color={color} size={18} />;
        case "Database": return <HardDrive color={color} size={18} />;
        case "Font": return <Component color={color} size={18} />;
        default: return <FileKey color={color} size={18} />;
    }
};

const getExtBadge = (name: string): string | null => {
    const dot = name.lastIndexOf(".");
    if (dot < 0) return null;
    const ext = name.slice(dot).toLowerCase();
    if (ext.length > 6) return null;
    return ext;
};

export function ListItem({ node, parentSize, onActivate, isSelected, isFocused, rowRef }: ListItemProps) {
    const isDir = node.is_dir;
    const fmt = useFormatBytes();
    const mode = useSizeMode();
    const shownSize = nodeSize(node, mode);
    const percentage = parentSize > 0 ? (shownSize / parentSize) * 100 : 0;
    const color = getCategoryColor(node.category);
    const extBadge = !isDir ? getExtBadge(node.name) : null;

    const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [deleteConfig, setDeleteConfig] = useState<{ mode: "recycle" | "permanent"; open: boolean }>({ mode: "recycle", open: false });

    const isSynthetic = node.path.includes(".space-analyzer");
    const isProtected = node.protected === true;
    const isBlockedDelete = isSynthetic || isProtected;

    const MENU_W = 168;
    const MENU_H = 180;
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const x = Math.min(e.clientX, window.innerWidth - MENU_W - 4);
        const y = Math.min(e.clientY, window.innerHeight - MENU_H - 4);
        setMenuPos({ x, y });
    };

    const handleCloseMenu = () => setMenuPos(null);

    const toast = (type: Parameters<ReturnType<typeof useToastStore.getState>["addToast"]>[0], msg: string) =>
        useToastStore.getState().addToast(type, msg);

    const handleOpenInExplorer = async (e: React.MouseEvent) => {
        e.stopPropagation();
        handleCloseMenu();
        try {
            const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
            await revealItemInDir(node.path);
        } catch {
            toast("error", "Failed to open path");
        }
    };

    const handleCopyPath = async (e: React.MouseEvent) => {
        e.stopPropagation();
        handleCloseMenu();
        try {
            await navigator.clipboard.writeText(node.path);
            toast("success", "Path copied to clipboard");
        } catch {
            toast("error", "Failed to copy path");
        }
    };

    const handleDeleteClick = (mode: "recycle" | "permanent", e: React.MouseEvent) => {
        e.stopPropagation();
        handleCloseMenu();
        if (isBlockedDelete) {
            toast(
                "warning",
                isProtected ? "System-protected file — deletion disabled." : "This aggregate entry cannot be deleted."
            );
            return;
        }
        setDeleteConfig({ mode, open: true });
    };

    const confirmDelete = () => {
        const permanent = deleteConfig.mode === "permanent";
        setDeleteConfig({ mode: deleteConfig.mode, open: false });
        scheduleDeferredDelete({ node, permanent });
    };

    return (
        <>
            <div
                ref={rowRef}
                onClick={(e) => onActivate(node, e)}
                onContextMenu={handleContextMenu}
                data-list-row="1"
                style={{ height: LIST_ROW_HEIGHT }}
                className={`flex items-center justify-between px-3 border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors group relative outline-none ${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""
                    } ${isFocused ? "ring-2 ring-inset ring-ring" : ""}`}
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="shrink-0">
                        {getCategoryIcon(node.category, isDir, color)}
                    </div>
                    <div className="truncate min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-1.5" title={node.name}>
                            {isProtected && (
                                <span title="System-protected file — deletion disabled" className="shrink-0 inline-flex">
                                    <ShieldAlert size={14} className="text-amber-500" aria-hidden />
                                </span>
                            )}
                            <span className="truncate">{node.name}</span>
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            {isDir ? (
                                <span>{node.file_count.toLocaleString()} items</span>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <span>{node.category}</span>
                                    {extBadge && (
                                        <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                            {extBadge}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                    <span className="text-xs font-mono text-muted-foreground tabular-nums w-10 text-right">
                        {percentage.toFixed(1)}%
                    </span>

                    <span className="text-sm font-mono font-medium whitespace-nowrap tabular-nums">
                        {fmt(shownSize)}
                    </span>

                    {node.delta !== undefined && Math.abs(node.delta) >= 1048576 && (
                        <span
                            title={"Change since the previous scan"}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded tabular-nums whitespace-nowrap ${node.delta > 0 ? "bg-amber-500/15 text-amber-500" : "bg-emerald-500/15 text-emerald-500"}`}
                        >
                            {formatDelta(node.delta, fmt)}
                        </span>
                    )}

                    <span className="text-xs text-muted-foreground tabular-nums w-24 text-right">
                        {node.last_modified ? new Date(node.last_modified * 1000).toLocaleDateString() : "—"}
                    </span>

                    <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full opacity-90 transition-all duration-500"
                            style={{
                                width: `${percentage}%`,
                                background: `linear-gradient(90deg, ${color}, color-mix(in hsl, ${color} 60%, transparent))`
                            }}
                        />
                    </div>

                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <button
                            type="button"
                            disabled={isBlockedDelete}
                            onClick={(e) => handleDeleteClick("recycle", e)}
                            title={
                                isProtected
                                    ? "System-protected file — deletion disabled"
                                    : "Move to Recycle Bin"
                            }
                            className="p-1 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
            </div>

            {menuPos && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={(e) => { e.stopPropagation(); handleCloseMenu(); }}
                        onContextMenu={(e) => { e.preventDefault(); handleCloseMenu(); }}
                    />
                    <div
                        className="fixed z-50 min-w-44 bg-popover text-popover-foreground border border-border shadow-xl rounded-xl p-1 text-sm flex flex-col backdrop-blur-sm"
                        style={{ top: menuPos.y, left: menuPos.x }}
                    >
                        <button
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors"
                            onClick={handleOpenInExplorer}
                        >
                            <Folder size={14} /> Open in Explorer
                        </button>
                        <button
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors"
                            onClick={handleCopyPath}
                        >
                            <FileKey size={14} /> Copy Path
                        </button>
                        <button
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors disabled:opacity-40"
                            disabled={isSynthetic}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCloseMenu();
                                void rescanPath(node.path);
                            }}
                        >
                            <RefreshCw size={14} /> {node.is_dir ? "Rescan folder" : "Rescan parent folder"}
                        </button>                        <div className="h-px bg-border my-1" />
                        <button
                            type="button"
                            disabled={isBlockedDelete}
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-muted rounded-lg transition-colors text-amber-500 disabled:opacity-40"
                            onClick={(e) => handleDeleteClick("recycle", e)}
                        >
                            <Trash2 size={14} /> Move to Recycle Bin
                        </button>
                        <button
                            type="button"
                            disabled={isBlockedDelete}
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-destructive rounded-lg transition-colors text-destructive disabled:opacity-40"
                            onClick={(e) => handleDeleteClick("permanent", e)}
                        >
                            <ArchiveX size={14} /> Delete Permanently
                        </button>
                    </div>
                </>
            )}

            <ConfirmModal
                isOpen={deleteConfig.open}
                title={deleteConfig.mode === "permanent" ? "Delete Permanently?" : "Move to Recycle Bin?"}
                message={`Are you sure you want to ${deleteConfig.mode === "permanent" ? "permanently delete" : "move"} "${node.name}" (${fmt(node.size)}) ${deleteConfig.mode === "permanent" ? "from disk" : "to the Recycle Bin"}? You can undo for a few seconds after confirming.`}
                confirmLabel={deleteConfig.mode === "permanent" ? "Delete" : "Move to Bin"}
                variant={deleteConfig.mode === "permanent" ? "danger" : "warning"}
                isLoading={false}
                onConfirm={confirmDelete}
                onCancel={() => setDeleteConfig({ ...deleteConfig, open: false })}
            />
        </>
    );
}
