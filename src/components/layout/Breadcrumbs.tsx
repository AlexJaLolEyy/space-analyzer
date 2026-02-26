import { ChevronRight, Home } from "lucide-react";
import { useScanStore } from "../../stores/scanStore";

export function Breadcrumbs() {
    const { currentPath, setCurrentPath } = useScanStore();

    if (!currentPath || currentPath.length === 0) return null;

    const navigateTo = (index: number) => {
        setCurrentPath(currentPath.slice(0, index + 1));
    };

    const visiblePath = currentPath.length > 5
        ? [currentPath[0], "...", ...currentPath.slice(-3)]
        : currentPath;

    return (
        <div className="flex items-center gap-1 text-sm text-muted-foreground overflow-hidden whitespace-nowrap pl-2">
            <Home size={14} className="shrink-0" />
            {visiblePath.map((part, index) => {
                const isLast = index === visiblePath.length - 1;
                const realIndex = part === "..." ? -1 : currentPath.lastIndexOf(part);

                return (
                    <div key={`bc-${index}`} className="flex items-center gap-1">
                        <ChevronRight size={14} className="opacity-50 shrink-0" />
                        <button
                            onClick={() => {
                                if (realIndex !== -1 && !isLast) navigateTo(realIndex);
                            }}
                            disabled={isLast || part === "..."}
                            className={`hover:text-foreground transition-colors truncate max-w-30 ${isLast ? "font-semibold text-foreground pointer-events-none" : ""
                                }`}
                            title={part}
                        >
                            {part}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
