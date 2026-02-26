import { useMemo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCategoryColor } from "../../lib/colors";
import { formatBytes } from "../../lib/format";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface BarChartViewProps {
    node: ScanNode;
}

// Vibrant index-based palette for directory items
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
    "hsl(320, 70%, 58%)",
    "hsl(60, 85%, 50%)",
    "hsl(170, 65%, 50%)",
    "hsl(10, 80%, 60%)",
    "hsl(260, 70%, 62%)",
    "hsl(130, 65%, 46%)",
    "hsl(50, 90%, 55%)",
    "hsl(190, 70%, 50%)",
    "hsl(350, 75%, 58%)",
];

export function BarChartView({ node }: BarChartViewProps) {
    const { currentPath, setCurrentPath } = useScanStore();

    const data = useMemo(() => {
        const sorted = [...node.children].sort((a, b) => b.size - a.size);
        return sorted.slice(0, 20);
    }, [node.children]);

    const getColor = (entry: ScanNode, index: number) => {
        if (entry.is_dir) return DIR_COLORS[index % DIR_COLORS.length];
        return getCategoryColor(entry.category);
    };

    const handleClick = (entry: any) => {
        if (entry.activePayload && entry.activePayload.length > 0) {
            const target = entry.activePayload[0].payload;
            if (target.is_dir) {
                setCurrentPath([...currentPath, target.name]);
            }
        }
    };

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload;
            return (
                <div className="glass p-3 rounded-xl border-border/50 text-sm max-w-50 shadow-lg">
                    <p className="font-semibold truncate" title={d.name}>{d.name}</p>
                    <p className="text-muted-foreground">{formatBytes(d.size)}</p>
                    {d.file_count > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">{d.file_count.toLocaleString()} items</p>
                    )}
                </div>
            );
        }
        return null;
    };

    const formatYAxis = (tickItem: string) =>
        tickItem.length > 16 ? `${tickItem.substring(0, 16)}…` : tickItem;

    return (
        <div className="flex-1 w-full h-full p-6 pt-8 pr-12">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart
                    layout="vertical"
                    data={data}
                    margin={{ top: 0, right: 60, bottom: 0, left: 20 }}
                    onClick={handleClick}
                >
                    <XAxis type="number" hide />
                    <YAxis
                        dataKey="name"
                        type="category"
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={formatYAxis}
                        width={130}
                        tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.3 }} />
                    <Bar dataKey="size" radius={[0, 6, 6, 0]} className="cursor-pointer">
                        {data.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={getColor(entry, index)}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
