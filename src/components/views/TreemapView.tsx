import { invoke } from "@tauri-apps/api/core";
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from "d3-hierarchy";
import { ChevronDown, ChevronLeft, ChevronUp, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCategoryColor, getDirColor } from "../../lib/colors";
import { useFormatBytes } from "../../lib/format";
import { nodeSize, useSizeMode } from "../../lib/nodeSize";
import { useScanStore } from "../../stores/scanStore";
import type { ExtStat, ScanNode } from "../../types/scan";

interface TreemapViewProps {
    node: ScanNode;
}

type RNode = HierarchyRectangularNode<ScanNode>;

const HEADER_H = 17;
const isSynthetic = (n: ScanNode) => n.path.includes(".space-analyzer");

export function TreemapView({ node }: TreemapViewProps) {
    const fmt = useFormatBytes();
    const sizeMode = useSizeMode();
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const nodesRef = useRef<RNode[]>([]);
    const seqRef = useRef(0);

    const setSearchQuery = useScanStore((s) => s.setSearchQuery);
    const setViewMode = useScanStore((s) => s.setViewMode);
    const navigateToAbsolutePath = useScanStore((s) => s.navigateToAbsolutePath);

    const [rootPath, setRootPath] = useState(node.path);
    const [data, setData] = useState<ScanNode | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [hover, setHover] = useState<RNode | null>(null);
    const [mouse, setMouse] = useState({ x: 0, y: 0 });
    const [legendOpen, setLegendOpen] = useState(true);
    const [exts, setExts] = useState<ExtStat[]>([]);

    // the folder shown in the list/charts is the zoom root; re-anchor when it changes
    useEffect(() => {
        setRootPath(node.path);
    }, [node.path]);

    // fetch a pruned nested tree for the zoom root; keep showing the old one meanwhile
    useEffect(() => {
        const seq = ++seqRef.current;
        invoke<ScanNode>("get_treemap", {
            path: rootPath,
            depth: 3,
            minFraction: 0.0005,
            maxNodes: 4000,
            onDisk: sizeMode === "disk",
        })
            .then((d) => {
                if (seq === seqRef.current) setData(d);
            })
            .catch((e) => console.error("get_treemap failed:", e));
    }, [rootPath, sizeMode, node.size, node.alloc]);

    useEffect(() => {
        let cancelled = false;
        invoke<ExtStat[]>("get_extension_stats", { n: 16 })
            .then((v) => {
                if (!cancelled) setExts(v);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [node.size]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // d3 squarified layout (nested, with a header strip on every folder that has children)
    const layout = useMemo(() => {
        if (!data || size.w < 10 || size.h < 10) return [] as RNode[];
        const root = hierarchy<ScanNode>(data, (d) => (d.children.length ? d.children : null))
            .sum((d) => (d.children.length ? 0 : nodeSize(d, sizeMode)))
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        if (!root.value) return [] as RNode[];
        const laid = treemap<ScanNode>()
            .tile(treemapSquarify)
            .size([size.w, size.h])
            .paddingOuter(2)
            .paddingInner(1)
            .paddingTop((d) => (d.depth > 0 && d.children ? HEADER_H : 2))(root);
        return laid.descendants();
    }, [data, size, sizeMode]);

    nodesRef.current = layout;

    // colors: each top-level folder gets a hue, files use their category; deeper = darker
    const topIndex = useMemo(() => {
        const m = new Map<ScanNode, number>();
        layout[0]?.children?.forEach((c, i) => {
            c.descendants().forEach((d) => m.set(d.data, i));
        });
        return m;
    }, [layout]);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || size.w < 10) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = size.w * dpr;
        canvas.height = size.h * dpr;
        canvas.style.width = `${size.w}px`;
        canvas.style.height = `${size.h}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.w, size.h);
        ctx.textBaseline = "middle";

        const clip = (text: string, maxW: number) => {
            if (ctx.measureText(text).width <= maxW) return text;
            let t = text;
            while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
            return t + "…";
        };

        for (const n of layout) {
            if (n.depth === 0) continue;
            const w = n.x1 - n.x0;
            const h = n.y1 - n.y0;
            if (w < 2 || h < 2) continue;
            const d = n.data;
            const hasKids = !!n.children;
            const base = d.is_dir
                ? getDirColor(topIndex.get(d) ?? 0)
                : isSynthetic(d)
                  ? getCategoryColor("Other")
                  : getCategoryColor(d.category);

            ctx.fillStyle = base;
            ctx.fillRect(n.x0, n.y0, w, h);
            const shade = Math.min(0.5, (n.depth - 1) * 0.13 + (hasKids ? 0.1 : 0));
            if (shade > 0) {
                ctx.fillStyle = `rgba(0,0,0,${shade})`;
                ctx.fillRect(n.x0, n.y0, w, h);
            }
            if (isSynthetic(d)) {
                ctx.fillStyle = "rgba(0,0,0,0.25)";
                ctx.fillRect(n.x0, n.y0, w, h);
            }
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth = 1;
            ctx.strokeRect(n.x0 + 0.5, n.y0 + 0.5, w - 1, h - 1);

            if (hasKids) {
                if (w > 36 && h > HEADER_H) {
                    ctx.font = "600 11px system-ui, sans-serif";
                    ctx.fillStyle = "rgba(255,255,255,0.95)";
                    const label = `${d.name}  ${fmt(nodeSize(d, sizeMode))}`;
                    ctx.fillText(clip(label, w - 8), n.x0 + 4, n.y0 + HEADER_H / 2 + 1);
                }
            } else if (w > 46 && h > 20) {
                ctx.font = "600 11px system-ui, sans-serif";
                ctx.fillStyle = "rgba(255,255,255,0.92)";
                ctx.fillText(clip(d.name, w - 8), n.x0 + 4, n.y0 + 10);
                if (h > 34) {
                    ctx.font = "10px system-ui, sans-serif";
                    ctx.fillStyle = "rgba(255,255,255,0.7)";
                    ctx.fillText(clip(fmt(nodeSize(d, sizeMode)), w - 8), n.x0 + 4, n.y0 + 24);
                }
            }
        }
    }, [layout, size, topIndex, fmt, sizeMode]);

    useEffect(() => {
        draw();
    }, [draw]);

    // hover outline on its own canvas so mouse moves never redraw the map
    useEffect(() => {
        const o = overlayRef.current;
        if (!o) return;
        const dpr = window.devicePixelRatio || 1;
        o.width = size.w * dpr;
        o.height = size.h * dpr;
        o.style.width = `${size.w}px`;
        o.style.height = `${size.h}px`;
        const ctx = o.getContext("2d");
        if (!ctx || !hover) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(hover.x0 + 1, hover.y0 + 1, hover.x1 - hover.x0 - 2, hover.y1 - hover.y0 - 2);
    }, [hover, size]);

    const hit = (e: React.MouseEvent): RNode | null => {
        const r = canvasRef.current?.getBoundingClientRect();
        if (!r) return null;
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const nodes = nodesRef.current;
        // descendants() is breadth-first, so the last match is the deepest block
        for (let i = nodes.length - 1; i > 0; i--) {
            const n = nodes[i];
            if (x >= n.x0 && x < n.x1 && y >= n.y0 && y < n.y1) return n;
        }
        return null;
    };

    const onMove = (e: React.MouseEvent) => {
        const n = hit(e);
        setHover((prev) => (prev === n ? prev : n));
        setMouse({ x: e.clientX, y: e.clientY });
    };

    const onClick = (e: React.MouseEvent) => {
        const n = hit(e);
        if (n && n.data.is_dir && !isSynthetic(n.data)) setRootPath(n.data.path);
    };

    const atRoot = rootPath.toLowerCase() === node.path.toLowerCase();
    const goUp = () => {
        const i = rootPath.lastIndexOf("\\");
        const parent = i > 2 ? rootPath.slice(0, i) : rootPath.slice(0, i + 1);
        setRootPath(parent.length < node.path.length ? node.path : parent);
    };

    const rootTotal = layout[0]?.value ?? 0;

    return (
        <div className="flex-1 flex flex-col w-full overflow-hidden min-h-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20 shrink-0 min-w-0">
                {!atRoot && (
                    <button
                        onClick={goUp}
                        className="flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-md bg-secondary hover:bg-muted transition-colors shrink-0"
                    >
                        <ChevronLeft size={15} /> Zoom out
                    </button>
                )}
                <span className="text-xs text-muted-foreground truncate flex-1" title={rootPath}>
                    {rootPath}
                </span>
                {!atRoot && (
                    <button
                        onClick={() => navigateToAbsolutePath(rootPath)}
                        title="Open this folder in the other views"
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary hover:bg-muted transition-colors shrink-0"
                    >
                        <ExternalLink size={12} /> Open
                    </button>
                )}
                <button
                    onClick={() => setLegendOpen((v) => !v)}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary hover:bg-muted transition-colors shrink-0"
                >
                    File types {legendOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
            </div>

            {legendOpen && exts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b border-border/50 shrink-0 max-h-20 overflow-y-auto">
                    {exts.map((e) => (
                        <button
                            key={e.ext || "(none)"}
                            onClick={() => {
                                setSearchQuery(`ext:${e.ext}`);
                                setViewMode("list");
                            }}
                            title={`${e.count.toLocaleString()} files. Click to list them.`}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-secondary hover:bg-muted text-[11px] transition-colors"
                        >
                            <span className="w-2 h-2 rounded-full" style={{ background: getCategoryColor(e.category) }} />
                            <span className="font-mono">{e.ext ? `.${e.ext}` : "(none)"}</span>
                            <span className="text-muted-foreground">{fmt(sizeMode === "disk" ? e.alloc : e.size)}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="flex-1 relative min-h-0" ref={containerRef}>
                <canvas
                    ref={canvasRef}
                    onMouseMove={onMove}
                    onMouseLeave={() => setHover(null)}
                    onClick={onClick}
                    className="absolute top-0 left-0 cursor-pointer"
                />
                <canvas ref={overlayRef} className="absolute top-0 left-0 pointer-events-none" />

                {hover && (
                    <div
                        className="fixed pointer-events-none glass p-3 rounded-lg z-50 text-sm shadow-xl max-w-64"
                        style={{
                            left: Math.min(mouse.x + 14, window.innerWidth - 270),
                            top: Math.min(mouse.y + 14, window.innerHeight - 130),
                        }}
                    >
                        <p className="font-semibold truncate">{hover.data.name}</p>
                        <p className="text-muted-foreground">
                            {fmt(nodeSize(hover.data, sizeMode))}
                            {rootTotal > 0 && (
                                <span className="ml-1.5 text-xs">
                                    ({(((hover.value ?? nodeSize(hover.data, sizeMode)) / rootTotal) * 100).toFixed(1)}%)
                                </span>
                            )}
                        </p>
                        {hover.data.file_count > 0 && (
                            <p className="text-xs text-muted-foreground">{hover.data.file_count.toLocaleString()} items</p>
                        )}
                        {hover.data.is_dir && !isSynthetic(hover.data) && (
                            <p className="text-xs text-primary mt-1">Click to zoom in</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
