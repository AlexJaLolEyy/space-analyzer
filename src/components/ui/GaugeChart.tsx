import { motion } from "framer-motion";

interface GaugeChartProps {
    used: number;
    total: number;
}

export function GaugeChart({ used, total }: GaugeChartProps) {
    const radius = 60;
    const stroke = 12;
    const normalizedRadius = radius - stroke * 2;
    const circumference = normalizedRadius * 2 * Math.PI;

    const percentage = total > 0 ? (used / total) * 100 : 0;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    let color = "#3b82f6"; // primary blue
    if (percentage > 80) color = "#f59e0b"; // amber
    if (percentage > 95) color = "#ef4444"; // red

    return (
        <div className="relative flex items-center justify-center">
            <svg height={radius * 2} width={radius * 2} className="transform -rotate-90">
                <circle
                    stroke="currentColor"
                    className="text-muted/30"
                    fill="transparent"
                    strokeWidth={stroke}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                />
                <motion.circle
                    stroke={color}
                    fill="transparent"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    r={normalizedRadius}
                    cx={radius}
                    cy={radius}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center font-bold text-xl">
                {Math.round(percentage)}%
            </div>
        </div>
    );
}
