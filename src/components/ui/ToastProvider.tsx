import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle, Info, X, AlertTriangle } from "lucide-react";
import { useToastStore } from "../../stores/toastStore";

export function ToastProvider() {
    const { toasts, removeToast } = useToastStore();

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
            <AnimatePresence>
                {toasts.map((toast) => (
                    <motion.div
                        key={toast.id}
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 bg-popover/90 backdrop-blur-md border border-border shadow-lg rounded-xl min-w-75 max-w-sm"
                    >
                        <div className="flex items-center gap-3 w-full">
                            {toast.type === "success" && <CheckCircle size={18} className="text-emerald-500 shrink-0" />}
                            {toast.type === "error" && <AlertCircle size={18} className="text-destructive shrink-0" />}
                            {toast.type === "info" && <Info size={18} className="text-blue-500 shrink-0" />}
                            {toast.type === "warning" && <AlertTriangle size={18} className="text-amber-500 shrink-0" />}
                            <p className="text-sm text-popover-foreground">{toast.message}</p>
                        </div>
                        {toast.action && (
                            <button
                                type="button"
                                onClick={() => {
                                    toast.action?.onClick();
                                    removeToast(toast.id);
                                }}
                                className="shrink-0 text-xs font-semibold text-primary hover:underline px-2"
                            >
                                {toast.action.label}
                            </button>
                        )}
                        <button
                            onClick={() => removeToast(toast.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors p-1"
                        >
                            <X size={14} />
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
