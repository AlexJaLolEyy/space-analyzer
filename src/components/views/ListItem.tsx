import { AlignLeft, Archive, Code, Component, FileKey, Folder, HardDrive, Hexagon, Image, Music, Shield, Video } from "lucide-react";
import { useState } from "react";
import { getCategoryColor } from "../../lib/colors";
import { formatBytes } from "../../lib/format";
import type { FileCategory, ScanNode } from "../../types/scan";

interface ListItemProps {
    node: ScanNode;
    parentSize: number;
    onClick: (node: ScanNode) => void;
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

export function ListItem({ node, parentSize, onClick }: ListItemProps) {
    const isDir = node.is_dir;
    const percentage = parentSize > 0 ? (node.size / parentSize) * 100 : 0;
    const color = getCategoryColor(node.category);

    // Context Menu State
    const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

    const MENU_W = 168;
    const MENU_H = 84;
    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const x = Math.min(e.clientX, window.innerWidth - MENU_W - 4);
        const y = Math.min(e.clientY, window.innerHeight - MENU_H - 4);
        setMenuPos({ x, y });
    };

    const handleCloseMenu = () => setMenuPos(null);

    const handleOpenInExplorer = async (e: React.MouseEvent) => {
        e.stopPropagation();
        handleCloseMenu();
        try {
            const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
            await revealItemInDir(node.path);
        } catch (err) {
            console.error("Failed to open path:", err);
        }
    };

    const handleCopyPath = async (e: React.MouseEvent) => {
        e.stopPropagation();
        handleCloseMenu();
        try {
            await navigator.clipboard.writeText(node.path);
        } catch (err) {
            console.error("Failed to copy path:", err);
        }
    };

    return (
        <>
            <div
                onClick={() => onClick(node)}
                onContextMenu={handleContextMenu}
                className="flex items-center justify-between p-3 border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors group relative"
            >
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="shrink-0">
                        {getCategoryIcon(node.category, isDir, color)}
                    </div>
                    <div className="truncate">
                        <p className="text-sm font-medium truncate" title={node.name}>
                            {node.name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            {isDir ? (
                                <span>{node.file_count.toLocaleString()} items</span>
                            ) : (
                                <span>{node.category}</span>
                            )}
                            <span className="hidden group-hover:inline-block">
                                • {(percentage).toFixed(2)}%
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 w-48 justify-end">
                    <span className="text-sm font-medium whitespace-nowrap">
                        {formatBytes(node.size)}
                    </span>
                    <div className="w-20 h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full opacity-80"
                            style={{ width: `${percentage}%`, backgroundColor: color }}
                        />
                    </div>
                </div>
            </div>

            {/* Context Menu Overlay */}
            {menuPos && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={(e) => { e.stopPropagation(); handleCloseMenu(); }}
                        onContextMenu={(e) => { e.preventDefault(); handleCloseMenu(); }}
                    />
                    <div
                        className="fixed z-50 min-w-40 bg-popover text-popover-foreground border border-border shadow-lg rounded-lg p-1 text-sm flex flex-col backdrop-blur-sm"
                        style={{ top: menuPos.y, left: menuPos.x }}
                    >
                        <button
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-muted rounded-sm transition-colors"
                            onClick={handleOpenInExplorer}
                        >
                            <Folder size={14} /> Open in Explorer
                        </button>
                        <button
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-muted rounded-sm transition-colors"
                            onClick={handleCopyPath}
                        >
                            <FileKey size={14} /> Copy Path
                        </button>
                    </div>
                </>
            )}
        </>
    );
}
