import { Window } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ThemeToggle } from "../theme/ThemeToggle";
import { Breadcrumbs } from "./Breadcrumbs";

const appWindow = new Window("main");

export function TitleBar() {
    const [isMaximized, setIsMaximized] = useState(false);

    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    useEffect(() => {
        if (!isTauri) return;

        const updateMaximized = async () => {
            setIsMaximized(await appWindow.isMaximized());
        };

        const unlisten = appWindow.onResized(() => {
            updateMaximized();
        });

        updateMaximized();

        return () => {
            unlisten.then((f) => f());
        };
    }, [isTauri]);

    const handleMinimize = () => isTauri && appWindow.minimize();
    const handleMaximize = async () => {
        if (!isTauri) return;
        await appWindow.toggleMaximize();
        setIsMaximized(await appWindow.isMaximized());
    };
    const handleClose = () => isTauri && appWindow.close();

    return (
        <div
            data-tauri-drag-region
            className="flex items-center justify-between h-10 bg-background/50 backdrop-blur-md border-b border-border/50 select-none"
        >
            <div className="flex items-center px-4 gap-4 pointer-events-auto">
                <span className="text-xs font-bold tracking-widest text-foreground/80 uppercase">
                    SpaceAnalyzer
                </span>
                <Breadcrumbs />
            </div>

            <div className="flex h-full items-center">
                <ThemeToggle />
                <button
                    onClick={handleMinimize}
                    className="flex items-center justify-center w-12 h-full hover:bg-muted transition-colors ml-1"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <button
                    onClick={handleMaximize}
                    className="flex items-center justify-center w-12 h-full hover:bg-muted transition-colors"
                >
                    {isMaximized ? (
                        <Copy className="w-3 h-3 rotate-180" />
                    ) : (
                        <Square className="w-3 h-3" />
                    )}
                </button>
                <button
                    onClick={handleClose}
                    className="flex items-center justify-center w-12 h-full hover:bg-destructive hover:text-destructive-foreground transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
