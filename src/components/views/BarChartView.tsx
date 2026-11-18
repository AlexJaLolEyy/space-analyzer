import { useMemo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getCategoryColor, getDirColor } from "../../lib/colors";
import { useFormatBytes } from "../../lib/format";
import { nodeSize, useSizeMode } from "../../lib/nodeSize";
import { useScanStore } from "../../stores/scanStore";
import type { ScanNode } from "../../types/scan";

interface BarChartViewProps {
    node: ScanNode;
}

export function BarChartView({ node }: BarChartViewProps) {
    const fmt = useFormatBytes();
    const mode = useSizeMode();
    const currentPath = useScanStore((s) => s.currentPath);
    const setCurrentPath = useScanStore((s) => s.setCurrentPath);

    const data = useMemo(() => {
        const sorted = node.children.map((c) => ({ ...c, value: nodeSize(c, mode) })).sort((a, b) => b.value - a.value);
        return sorted.slice(0, 20);
    }, [node.children, mode]);

    const getColor = (entry: ScanNode, index: number) => {
        if (entry.is_dir) return getDirColor(index);
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
                    <p className="text-muted-foreground">{fmt(d.value)}</p>
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
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} className="cursor-pointer">
                        {data.map((entry, index) => (
                            <Cell
                                key={`cell-${index}`}
                                fill={getColor(entry, index)}
                                className={entry.is_dir ? "cursor-pointer hover:brightness-110 drop-shadow-sm transition-all duration-200" : "hover:brightness-110 drop-shadow-sm transition-all duration-200"}
                            />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
