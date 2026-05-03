"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Send, Check, X } from "lucide-react";
import { tt } from "@/lib/translations";

interface ReportErrorProps {
  gameId?: string;
  stepId?: string;
  sessionId?: string;
  playerName?: string;
  stepOrder?: number;
  locale?: string;
}

export function ReportError({
  gameId,
  stepId,
  sessionId,
  playerName,
  stepOrder,
  locale = "fr",
}: ReportErrorProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || message.trim().length < 3) return;

    setSending(true);
    setError(false);
    try {
      const res = await fetch("/api/report-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          stepId,
          sessionId,
          playerName,
          stepOrder,
          message: message.trim(),
        }),
      });

      if (res.ok) {
        setSent(true);
        setTimeout(() => {
          setOpen(false);
          setSent(false);
          setMessage("");
        }, 2000);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-orange-400/70 hover:text-orange-400 transition-colors py-2 px-3 rounded-lg border border-orange-500/20 hover:border-orange-500/40 bg-orange-500/5"
      >
        <AlertTriangle className="h-4 w-4" />
        <span>{tt('reportError.trigger', locale)}</span>
      </button>
    );
  }

  if (sent) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
        <Check className="h-6 w-6 text-emerald-400 mx-auto mb-1" />
        <p className="text-sm text-emerald-300">{tt('reportError.success', locale)}</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/95 border border-orange-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-orange-400 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            {tt('reportError.title', locale)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{tt('reportError.subtitle', locale)}</p>
        </div>
        <button
          onClick={() => { setOpen(false); setMessage(""); setError(false); }}
          className="text-slate-600 hover:text-slate-400"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={tt('reportError.placeholder', locale)}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 resize-none focus:border-orange-500 focus:outline-none min-h-[80px]"
        maxLength={1000}
        autoFocus
      />

      {error && (
        <p className="text-xs text-red-400">{tt('reportError.error', locale)}</p>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-500"
          onClick={() => { setOpen(false); setMessage(""); setError(false); }}
        >
          {tt('reportError.cancel', locale)}
        </Button>
        <Button
          size="sm"
          className="bg-orange-600 hover:bg-orange-700 text-white"
          disabled={!message.trim() || message.trim().length < 3 || sending}
          onClick={handleSend}
        >
          {sending ? (
            <span className="animate-spin">...</span>
          ) : (
            <>
              <Send className="h-3 w-3 mr-1" />
              {tt('reportError.send', locale)}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
