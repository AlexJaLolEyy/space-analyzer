import { motion } from "framer-motion";
import { AlertTriangle, Info, Trash2 } from "lucide-react";

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "danger" | "warning" | "info";
    onConfirm: () => void;
    onCancel: () => void;
    isLoading?: boolean;
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    variant = "danger",
    onConfirm,
    onCancel,
    isLoading = false,
}: ConfirmModalProps) {
    if (!isOpen) return null;

    const Icon = variant === "danger" ? Trash2 : variant === "warning" ? AlertTriangle : Info;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onCancel}
            />

            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="relative bg-popover text-popover-foreground border border-border shadow-2xl rounded-2xl w-full max-w-md p-6 overflow-hidden"
            >
                <div className="flex gap-4">
                    <div className={`mt-1 shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${variant === "danger" ? "bg-destructive/10 text-destructive" :
                        variant === "warning" ? "bg-amber-500/10 text-amber-500" :
                            "bg-primary/10 text-primary"
                        }`}>
                        <Icon size={20} />
                    </div>

                    <div className="flex-1">
                        <h2 className="text-lg font-bold">{title}</h2>
                        <p className="text-sm text-muted-foreground mt-2">{message}</p>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-3 mt-8">
                    <button
                        onClick={onCancel}
                        disabled={isLoading}
                        className="px-4 py-2 text-sm font-medium rounded-xl hover:bg-muted transition-colors disabled:opacity-50"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isLoading}
                        className={`px-4 py-2 text-sm font-medium rounded-xl flex items-center gap-2 transition-colors disabled:opacity-50 ${variant === "danger"
                            ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            : "bg-primary text-primary-foreground hover:bg-primary/90"
                            }`}
                    >
                        {isLoading ? "Processing..." : confirmLabel}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
