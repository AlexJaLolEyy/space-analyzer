import { create } from "zustand";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
    id: string;
    type: ToastType;
    message: string;
    action?: { label: string; onClick: () => void };
    durationMs?: number;
}

interface ToastState {
    toasts: Toast[];
    addToast: (type: ToastType, message: string, options?: { action?: Toast["action"]; durationMs?: number }) => void;
    removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],
    addToast: (type, message, options) => {
        const id = Math.random().toString(36).substring(2, 9);
        const durationMs = options?.durationMs ?? 4000;
        set((state) => ({
            toasts: [...state.toasts, { id, type, message, action: options?.action, durationMs }],
        }));
        setTimeout(() => {
            set((state) => ({
                toasts: state.toasts.filter((t) => t.id !== id),
            }));
        }, durationMs);
    },
    removeToast: (id) =>
        set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        })),
}));
