import { motion } from "framer-motion";
import { formatBytes } from "../../lib/format";
import type { ScanDiff } from "../../types/history";
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Plus, Trash2 } from "lucide-react";

interface ScanCompareViewProps {
    diff: ScanDiff;
    onClose: () => void;
}

export function ScanCompareView({ diff, onClose }: ScanCompareViewProps) {
    const totalGrown = diff.grown.reduce((acc, curr) => acc + (curr[2] - curr[1]), 0);
    const totalShrunk = diff.shrunk.reduce((acc, curr) => acc + (curr[1] - curr[2]), 0);
    const netChange = totalGrown - totalShrunk;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex-1 overflow-y-auto p-6 bg-background rounded-xl m-4 border border-border shadow-sm flex flex-col items-center"
        >
            <div className="w-full max-w-4xl flex flex-col gap-6">
                <div className="flex items-center gap-4 border-b border-border/50 pb-4">
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-bold">Comparison Results</h2>
                        <p className="text-sm text-muted-foreground flex gap-4 mt-1">
                            <span>Added: {diff.added.length}</span>
                            <span>Removed: {diff.removed.length}</span>
                            <span>Grown: {diff.grown.length}</span>
                            <span>Shrunk: {diff.shrunk.length}</span>
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-secondary/30 p-5 rounded-2xl border border-border/50 flex flex-col items-center justify-center text-center">
                        <p className="text-muted-foreground text-sm mb-1">Net Change</p>
                        <p className={`text-3xl font-bold ${netChange > 0 ? 'text-destructive' : 'text-emerald-500'}`}>
                            {netChange > 0 ? "+" : ""}{formatBytes(netChange)}
                        </p>
                    </div>
                    <div className="bg-secondary/30 p-5 rounded-2xl border border-border/50 flex flex-col items-center justify-center text-center">
                        <p className="text-muted-foreground text-sm mb-1">Total Grown</p>
                        <p className="text-2xl font-bold text-destructive flex items-center gap-1">
                            <ArrowUpRight size={20} /> {formatBytes(totalGrown)}
                        </p>
                    </div>
                    <div className="bg-secondary/30 p-5 rounded-2xl border border-border/50 flex flex-col items-center justify-center text-center">
                        <p className="text-muted-foreground text-sm mb-1">Total Shrunk</p>
                        <p className="text-2xl font-bold text-emerald-500 flex items-center gap-1">
                            <ArrowDownRight size={20} /> {formatBytes(totalShrunk)}
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">

                    {diff.grown.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <h3 className="font-semibold flex items-center gap-2 text-destructive"><ArrowUpRight size={16} /> Grown Items</h3>
                            <div className="bg-secondary/20 border border-border/50 rounded-xl overflow-hidden divide-y divide-border/30 max-h-80 overflow-y-auto">
                                {diff.grown.slice(0, 50).map((g, i) => (
                                    <div key={i} className="p-3 text-sm flex justify-between items-center bg-destructive/5 hover:bg-destructive/10">
                                        <span className="truncate mr-4 flex-1" title={g[0]}>{g[0]}</span>
                                        <span className="font-mono text-xs text-destructive shrink-0 whitespace-nowrap">
                                            +{formatBytes(g[2] - g[1])}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {diff.shrunk.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <h3 className="font-semibold flex items-center gap-2 text-emerald-500"><ArrowDownRight size={16} /> Shrunk Items</h3>
                            <div className="bg-secondary/20 border border-border/50 rounded-xl overflow-hidden divide-y divide-border/30 max-h-80 overflow-y-auto">
                                {diff.shrunk.slice(0, 50).map((s, i) => (
                                    <div key={i} className="p-3 text-sm flex justify-between items-center bg-emerald-500/5 hover:bg-emerald-500/10">
                                        <span className="truncate mr-4 flex-1" title={s[0]}>{s[0]}</span>
                                        <span className="font-mono text-xs text-emerald-500 shrink-0 whitespace-nowrap">
                                            -{formatBytes(s[1] - s[2])}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {diff.added.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <h3 className="font-semibold flex items-center gap-2 text-blue-500"><Plus size={16} /> Added Items</h3>
                            <div className="bg-secondary/20 border border-border/50 rounded-xl overflow-hidden divide-y divide-border/30 max-h-80 overflow-y-auto">
                                {diff.added.slice(0, 50).map((a, i) => (
                                    <div key={i} className="p-3 text-sm flex justify-between items-center bg-blue-500/5">
                                        <span className="truncate flex-1" title={a}>{a}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {diff.removed.length > 0 && (
                        <div className="flex flex-col gap-3">
                            <h3 className="font-semibold flex items-center gap-2 text-muted-foreground"><Trash2 size={16} /> Removed Items</h3>
                            <div className="bg-secondary/20 border border-border/50 rounded-xl overflow-hidden divide-y divide-border/30 max-h-80 overflow-y-auto">
                                {diff.removed.slice(0, 50).map((r, i) => (
                                    <div key={i} className="p-3 text-sm flex justify-between items-center hover:bg-secondary/40">
                                        <span className="truncate flex-1 text-muted-foreground line-through" title={r}>{r}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
