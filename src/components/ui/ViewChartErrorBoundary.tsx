import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";

function ChartFallback({ label, reset }: { label: string; reset: () => void }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground min-h-[200px]">
            <AlertTriangle className="text-amber-500 shrink-0" size={32} />
            <div>
                <p className="text-sm font-semibold text-foreground">{label} crashed</p>
                <p className="text-xs mt-1 max-w-sm">Something went wrong rendering this view. Try another view or reload the scan.</p>
            </div>
            <button
                type="button"
                onClick={reset}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary hover:bg-muted text-foreground transition-colors"
            >
                Retry
            </button>
        </div>
    );
}

export function ViewChartErrorBoundary({ label, children }: { label: string; children: ReactNode }) {
    return (
        <ErrorBoundary
            fallbackRender={({ resetErrorBoundary }) => <ChartFallback label={label} reset={resetErrorBoundary} />}
        >
            {children}
        </ErrorBoundary>
    );
}
