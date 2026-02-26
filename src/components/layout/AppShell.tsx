import { ReactNode } from "react";
import { TitleBar } from "./TitleBar";

interface AppShellProps {
    children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
    return (
        <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground transition-colors duration-300">
            <TitleBar />
            <main className="flex-1 relative overflow-hidden flex flex-col">
                {children}
            </main>
        </div>
    );
}
