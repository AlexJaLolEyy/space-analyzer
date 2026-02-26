import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCategoryColor } from "../../lib/colors";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface TreemapViewProps {
    node: ScanNode;
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
    node: ScanNode;
    color: string;
}

// Vibrant index-based colors for directories
const DIR_COLORS = [
    "hsl(220, 80%, 58%)",
    "hsl(280, 75%, 60%)",
    "hsl(150, 65%, 46%)",
    "hsl(30, 90%, 56%)",
    "hsl(340, 75%, 58%)",
    "hsl(180, 70%, 48%)",
    "hsl(45, 90%, 52%)",
    "hsl(0, 72%, 58%)",
    "hsl(250, 65%, 65%)",
    "hsl(100, 60%, 46%)",
    "hsl(200, 70%, 52%)",
    "hsl(320, 68%, 58%)",
];

const layoutTreemap = (
    nodes: ScanNode[],
    totalSize: number,
    x: number,
    y: number,
    w: number,
    h: number,
    colorMap: Map<string, string>
): Rect[] => {
    let rects: Rect[] = [];
    let curX = x;
    let curY = y;
    let remainingW = w;
    let remainingH = h;
    let remainingSize = totalSize;
    const sorted = [...nodes].sort((a, b) => b.size - a.size);

    for (const n of sorted) {
        if (remainingSize <= 0) break;
        const ratio = n.size / remainingSize;
        const color = colorMap.get(n.name) || getCategoryColor(n.category);

        if (remainingW > remainingH) {
            const sliceW = remainingW * ratio;
            rects.push({ x: curX, y: curY, w: sliceW, h: remainingH, node: n, color });
            curX += sliceW;
            remainingW -= sliceW;
        } else {
            const sliceH = remainingH * ratio;
            rects.push({ x: curX, y: curY, w: remainingW, h: sliceH, node: n, color });
            curY += sliceH;
            remainingH -= sliceH;
        }

        remainingSize -= n.size;
    }

    return rects;
};

export function TreemapView({ node }: TreemapViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { currentPath, setCurrentPath } = useScanStore();
    const [hoverNode, setHoverNode] = useState<ScanNode | null>(null);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const rectsRef = useRef<Rect[]>([]);

    // Stable color map per child name so colors are consistent
    const colorMap = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        const newMap = new Map<string, string>();
        const sorted = [...node.children].sort((a, b) => b.size - a.size);
        sorted.forEach((child, index) => {
            if (child.is_dir) {
                newMap.set(child.name, DIR_COLORS[index % DIR_COLORS.length]);
            } else {
                newMap.set(child.name, getCategoryColor(child.category));
            }
        });
        colorMap.current = newMap;
    }, [node]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const draw = (w: number, h: number) => {
            ctx.clearRect(0, 0, w, h);

            const totalSize = node.children.reduce((acc, c) => acc + c.size, 0);
            if (totalSize === 0) return;

            const rects = layoutTreemap(node.children, totalSize, 0, 0, w, h, colorMap.current);
            rectsRef.current = rects;

            for (const r of rects) {
                // Fill
                ctx.fillStyle = r.color;
                ctx.beginPath();
                ctx.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, 4);
                ctx.fill();

                // Subtle inner border
                ctx.strokeStyle = "rgba(0,0,0,0.15)";
                ctx.lineWidth = 1;
                ctx.stroke();

                // Draw text if enough space
                if (r.w > 48 && r.h > 22) {
                    // Name
                    ctx.fillStyle = "rgba(255,255,255,0.92)";
                    ctx.font = `bold ${Math.min(13, r.h / 4)}px system-ui, sans-serif`;
                    ctx.textBaseline = "top";

                    let text = r.node.name;
                    while (ctx.measureText(text).width > r.w - 10 && text.length > 3) {
                        text = text.slice(0, -1);
                    }
                    if (text !== r.node.name) text += "…";
                    ctx.fillText(text, r.x + 6, r.y + 6);

                    // Size label if tall enough
                    if (r.h > 40) {
                        ctx.fillStyle = "rgba(255,255,255,0.65)";
                        ctx.font = `${Math.min(11, r.h / 5)}px system-ui, sans-serif`;
                        ctx.fillText(formatBytes(r.node.size), r.x + 6, r.y + 22);
                    }
                }
            }
        };

        const resize = () => {
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = `${rect.width}px`;
            canvas.style.height = `${rect.height}px`;
            ctx.scale(dpr, dpr);
            draw(rect.width, rect.height);
        };

        const observer = new ResizeObserver(resize);
        observer.observe(container);
        return () => observer.disconnect();
    }, [node]);

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const found = rectsRef.current.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
        if (found) {
            setHoverNode(found.node);
            setMousePos({ x: e.clientX, y: e.clientY });
        } else {
            setHoverNode(null);
        }
    };

    const handleClick = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const found = rectsRef.current.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
        if (found && found.node.is_dir) {
            setCurrentPath([...currentPath, found.node.name]);
        }
    };

    const canGoBack = currentPath.length > 1;

    const handleBack = () => {
        if (canGoBack) {
            setCurrentPath(currentPath.slice(0, -1));
        }
    };

    return (
        <div className="flex-1 flex flex-col w-full overflow-hidden">
            {/* Treemap toolbar */}
            {canGoBack && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20 shrink-0">
                    <button
                        onClick={handleBack}
                        className="flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-md bg-secondary hover:bg-muted transition-colors"
                    >
                        <ChevronLeft size={15} /> Back
                    </button>
                    <span className="text-xs text-muted-foreground truncate">
                        {currentPath.join(" › ")}
                    </span>
                </div>
            )}

            <div className="flex-1 relative" ref={containerRef}>
                <canvas
                    ref={canvasRef}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => setHoverNode(null)}
                    onClick={handleClick}
                    className="absolute top-0 left-0 w-full h-full cursor-crosshair"
                />

                {hoverNode && (
                    <div
                        className="fixed pointer-events-none glass p-3 rounded-lg z-50 text-sm shadow-xl max-w-56"
                        style={{
                            left: Math.min(mousePos.x + 14, window.innerWidth - 230),
                            top: Math.min(mousePos.y + 14, window.innerHeight - 120),
                        }}
                    >
                        <p className="font-semibold truncate">{hoverNode.name}</p>
                        <p className="text-muted-foreground">{formatBytes(hoverNode.size)}</p>
                        {hoverNode.file_count > 0 && (
                            <p className="text-xs text-muted-foreground">{hoverNode.file_count.toLocaleString()} items</p>
                        )}
                        {hoverNode.is_dir && (
                            <p className="text-xs text-primary mt-1">Click to drill down</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
