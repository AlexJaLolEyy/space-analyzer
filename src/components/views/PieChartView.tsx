import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { getCategoryColor } from "../../lib/colors";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface PieChartViewProps {
    node: ScanNode;
}

// Vibrant palette for directories (index-based when category is "Other"/dir)
const DIR_COLORS = [
    "hsl(220, 80%, 60%)",
    "hsl(280, 75%, 62%)",
    "hsl(150, 65%, 48%)",
    "hsl(30, 90%, 58%)",
    "hsl(340, 75%, 58%)",
    "hsl(180, 70%, 48%)",
    "hsl(45, 90%, 52%)",
    "hsl(0, 70%, 58%)",
    "hsl(250, 65%, 65%)",
    "hsl(100, 65%, 48%)",
    "hsl(200, 70%, 52%)",
];

export function PieChartView({ node }: PieChartViewProps) {
    const { currentPath, setCurrentPath } = useScanStore();

    const data = useMemo(() => {
        const sorted = [...node.children].sort((a, b) => b.size - a.size);
        const top = sorted.slice(0, 10);
        const others = sorted.slice(10);

        if (others.length > 0) {
            const othersSize = others.reduce((acc, c) => acc + c.size, 0);
            top.push({
                name: "Other",
                size: othersSize,
                category: "Other",
                is_dir: false,
                children: [],
                path: "",
                file_count: 0,
                last_modified: null,
            } as ScanNode);
        }
        return top;
    }, [node.children]);

    const getColor = (entry: ScanNode, index: number) => {
        if (entry.is_dir) return DIR_COLORS[index % DIR_COLORS.length];
        return getCategoryColor(entry.category);
    };

    const handleClick = (entry: any) => {
        if (entry.is_dir && entry.name !== "Other") {
            setCurrentPath([...currentPath, entry.name]);
        }
    };

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            const pct = node.size > 0 ? ((d.size / node.size) * 100).toFixed(1) : "0";
            return (
                <div className="glass p-3 rounded-xl border-border/50 text-sm max-w-50 shadow-lg">
                    <p className="font-semibold truncate" title={d.name}>{d.name}</p>
                    <p className="text-muted-foreground">{formatBytes(d.size)}</p>
                    <p className="text-primary font-medium">{pct}%</p>
                    {d.is_dir && d.name !== "Other" && (
                        <p className="text-xs text-muted-foreground mt-1 italic">Click to drill down</p>
                    )}
                </div>
            );
        }
        return null;
    };

    // Custom label rendered outside the donut
    const renderCustomLabel = ({ cx, cy, midAngle, outerRadius, name, percent }: any) => {
        if (percent < 0.04) return null; // skip tiny slices
        const RADIAN = Math.PI / 180;
        const radius = outerRadius + 28;
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);
        const short = name.length > 14 ? name.substring(0, 13) + "…" : name;
        return (
            <text
                x={x}
                y={y}
                fill="currentColor"
                textAnchor={x > cx ? "start" : "end"}
                dominantBaseline="central"
                fontSize={11}
                fontWeight={500}
                className="fill-foreground"
            >
                {short} ({(percent * 100).toFixed(0)}%)
            </text>
        );
    };

    return (
        <div className="flex-1 w-full h-full flex gap-0 overflow-hidden">
            {/* Chart */}
            <div className="flex-1 h-full p-4">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="size"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius="42%"
                            outerRadius="68%"
                            paddingAngle={2}
                            onClick={(_: any, index: number) => handleClick(data[index])}
                            label={renderCustomLabel}
                            labelLine={false}
                            className="cursor-pointer focus:outline-none"
                        >
                            {data.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={getColor(entry, index)}
                                    stroke="transparent"
                                    className="hover:opacity-80 transition-opacity"
                                />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                </ResponsiveContainer>
            </div>

            {/* Side Legend */}
            <div className="w-56 shrink-0 flex flex-col gap-1 py-6 pr-4 overflow-y-auto no-scrollbar">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Breakdown</p>
                {data.map((entry, index) => {
                    const pct = node.size > 0 ? ((entry.size / node.size) * 100).toFixed(1) : "0";
                    const color = getColor(entry, index);
                    return (
                        <button
                            key={`legend-${index}`}
                            onClick={() => handleClick(entry)}
                            className={`flex items-center gap-2 text-left px-2 py-1.5 rounded-md transition-colors ${entry.is_dir && entry.name !== "Other" ? "hover:bg-muted cursor-pointer" : "cursor-default"}`}
                        >
                            <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                            />
                            <span className="text-xs truncate flex-1 text-foreground" title={entry.name}>
                                {entry.name}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                                {pct}%
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
