"use client";

/**
 * Promise-based confirm dialog. Replaces the native `window.confirm()` —
 * which is unstyled, can't be themed, and shows the OK/Cancel buttons in
 * the browser's locale (not the player's chosen one). Using this hook,
 * every dialog renders with the in-game theme and uses the player's
 * locale for both body and buttons.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({ message: "Skip step?", locale: "ja" });
 *   if (ok) { ... }
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { tt } from "@/lib/translations";

interface ConfirmOptions {
  message: string;
  locale?: string;
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingState {
  opts: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ opts, resolve });
      }),
    [],
  );

  const close = (value: boolean) => {
    if (!pending) return;
    pending.resolve(value);
    setPending(null);
  };

  const opts = pending?.opts;
  const locale = opts?.locale ?? "fr";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) close(false);
        }}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-950 text-white">
          <AlertDialogHeader>
            {opts?.title && (
              <AlertDialogTitle className="text-emerald-50">
                {opts.title}
              </AlertDialogTitle>
            )}
            <AlertDialogDescription className="text-slate-300 whitespace-pre-line">
              {opts?.message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => close(false)}
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              {opts?.cancelLabel ?? tt("confirm.cancel", locale)}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={
                opts?.tone === "destructive"
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }
            >
              {opts?.okLabel ?? tt("confirm.ok", locale)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a <ConfirmProvider>");
  }
  return ctx;
}
