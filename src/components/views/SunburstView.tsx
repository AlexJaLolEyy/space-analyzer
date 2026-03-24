import { useMemo, useState } from "react";
import { hierarchy, partition } from "d3-hierarchy";
import type { ScanNode } from "../../types/scan";
import { formatBytes } from "../../lib/format";

interface SunburstViewProps {
    node: ScanNode;
}

export function SunburstView({ node }: SunburstViewProps) {
    const [hoveredNode, setHoveredNode] = useState<any | null>(null);

    const data = useMemo(() => {
        if (!node) return null;

        // Build a hierarchical object that d3 can consume
        // Only take top levels to avoid overwhelming SVG
        const build = (node: ScanNode, depth: number): any => {
            if (depth > 4 || !node.is_dir) {
                return { name: node.name, value: node.size, path: node.path };
            }
            return {
                name: node.name,
                value: node.size,
                path: node.path,
                children: node.children.map(c => build(c, depth + 1))
            };
        };

        const rootObj = build(node, 0);

        const root = hierarchy(rootObj)
            .sum(d => d.value)
            .sort((a, b) => (b.value || 0) - (a.value || 0));

        const radius = Math.min(600, 600) / 2;
        const layout = partition<any>()
            .size([2 * Math.PI, radius * radius]);

        layout(root);
        return root;
    }, [node]);

    if (!data) return null;

    const radius = 300;

    // Calculate arc commands
    const arc = (d: any) => {
        const startAngle = d.x0 - Math.PI / 2;
        const endAngle = d.x1 - Math.PI / 2;
        const innerRadius = Math.sqrt(d.y0);
        const outerRadius = Math.sqrt(d.y1);

        const largeArcFlag = endAngle - startAngle <= Math.PI ? "0" : "1";

        const x1 = Math.cos(startAngle) * innerRadius;
        const y1 = Math.sin(startAngle) * innerRadius;
        const x2 = Math.cos(endAngle) * innerRadius;
        const y2 = Math.sin(endAngle) * innerRadius;

        const x3 = Math.cos(endAngle) * outerRadius;
        const y3 = Math.sin(endAngle) * outerRadius;
        const x4 = Math.cos(startAngle) * outerRadius;
        const y4 = Math.sin(startAngle) * outerRadius;

        return `
            M ${x1} ${y1}
            A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}
            L ${x3} ${y3}
            A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4}
            Z
        `;
    };

    return (
        <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-background relative">
            <svg width={radius * 2} height={radius * 2} viewBox={`${-radius} ${-radius} ${radius * 2} ${radius * 2}`}>
                {data.descendants().map((d, i) => {
                    const depth = d.depth;
                    if (depth === 0) return null;

                    const isHovered = hoveredNode && hoveredNode.data.path === d.data.path;

                    return (
                        <path
                            key={i}
                            d={arc(d)}
                            fill={`var(--color-primary)`}
                            fillOpacity={isHovered ? 0.8 : 0.6 - (depth * 0.1)}
                            stroke="var(--color-bg)"
                            strokeWidth={1}
                            onMouseEnter={() => setHoveredNode(d)}
                            onMouseLeave={() => setHoveredNode(null)}
                            className="cursor-pointer transition-colors"
                        />
                    );
                })}
            </svg>

            {hoveredNode && (
                <div className="absolute top-8 left-8 bg-popover/90 backdrop-blur border border-border p-4 rounded-xl shadow-lg pointer-events-none fade-in animate-in">
                    <p className="font-bold text-sm truncate max-w-sm">{hoveredNode.data.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate max-w-sm">{hoveredNode.data.path}</p>
                    <p className="font-mono mt-1 font-semibold text-primary">{formatBytes(hoveredNode.value)}</p>
                </div>
            )}

            {!hoveredNode && (
                <div className="absolute top-8 left-8 bg-primary/10 border border-primary/20 text-primary p-4 rounded-xl shadow-sm text-sm font-medium">
                    Hover over rings to examine directories
                </div>
            )}
        </div>
    );
}
