"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Wrench,
  Ban,
  RotateCcw,
  ChevronDown,
  MessageSquare,
  Send,
} from "lucide-react";

type Report = {
  id: string;
  game_id: string | null;
  step_id: string | null;
  session_id: string | null;
  player_name: string | null;
  step_order: number | null;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
  games: { title: unknown; city: string } | null;
  game_steps: {
    step_order: number;
    title: unknown;
    riddle_text: unknown;
    answer_text: unknown;
  } | null;
};

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: typeof Clock }
> = {
  new: {
    label: "Nouveau",
    color: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    icon: AlertTriangle,
  },
  reviewed: {
    label: "En cours",
    color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    icon: Clock,
  },
  fixed: {
    label: "Corrige",
    color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    icon: CheckCircle2,
  },
  dismissed: {
    label: "Rejete",
    color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    icon: XCircle,
  },
};

const STATUS_ACTIONS: Record<
  string,
  { label: string; icon: typeof Clock; next: string }[]
> = {
  new: [
    { label: "En cours", icon: Eye, next: "reviewed" },
    { label: "Corrige", icon: Wrench, next: "fixed" },
    { label: "Rejeter", icon: Ban, next: "dismissed" },
  ],
  reviewed: [
    { label: "Corrige", icon: Wrench, next: "fixed" },
    { label: "Rejeter", icon: Ban, next: "dismissed" },
    { label: "Nouveau", icon: RotateCcw, next: "new" },
  ],
  fixed: [
    { label: "Rouvrir", icon: RotateCcw, next: "new" },
  ],
  dismissed: [
    { label: "Rouvrir", icon: RotateCcw, next: "new" },
  ],
};

function extractText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        return parsed.en || parsed.fr || Object.values(parsed)[0] || value;
      } catch { /* not JSON */ }
    }
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, string>;
    return obj.en || obj.fr || Object.values(obj)[0] || "";
  }
  return String(value);
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/reports/list");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch {
      console.error("Failed to fetch reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const updateReport = async (
    reportId: string,
    status?: string,
    adminNotes?: string
  ) => {
    setUpdating(reportId);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, status, adminNotes }),
      });
      if (res.ok) {
        setReports((prev) =>
          prev.map((r) =>
            r.id === reportId
              ? {
                  ...r,
                  ...(status && { status }),
                  ...(adminNotes !== undefined && { admin_notes: adminNotes }),
                }
              : r
          )
        );
      }
    } catch {
      console.error("Failed to update report");
    } finally {
      setUpdating(null);
    }
  };

  const filtered =
    filter === "all" ? reports : reports.filter((r) => r.status === filter);

  const counts = {
    all: reports.length,
    new: reports.filter((r) => r.status === "new").length,
    reviewed: reports.filter((r) => r.status === "reviewed").length,
    fixed: reports.filter((r) => r.status === "fixed").length,
    dismissed: reports.filter((r) => r.status === "dismissed").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">
          Signalements d&apos;erreurs
          {counts.new > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
              {counts.new} nouveau{counts.new > 1 ? "x" : ""}
            </span>
          )}
        </h1>
        <p className="text-sm text-zinc-500">
          Les joueurs signalent les erreurs dans les enigmes
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "new", "reviewed", "fixed", "dismissed"] as const).map(
          (s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === s
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300"
              }`}
            >
              {s === "all"
                ? "Tous"
                : STATUS_CONFIG[s]?.label || s}{" "}
              ({counts[s]})
            </button>
          )
        )}
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((report) => {
            const statusConf =
              STATUS_CONFIG[report.status] || STATUS_CONFIG.new;
            const StatusIcon = statusConf.icon;
            const isExpanded = expandedId === report.id;
            const actions = STATUS_ACTIONS[report.status] || [];

            return (
              <div
                key={report.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
              >
                {/* Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : report.id)
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={statusConf.color}>
                          <StatusIcon className="size-3 mr-1" />
                          {statusConf.label}
                        </Badge>
                        {report.games && (
                          <span className="text-xs text-zinc-500">
                            {extractText(report.games.title)} -{" "}
                            {report.games.city}
                          </span>
                        )}
                        {report.step_order && (
                          <span className="text-xs text-zinc-600">
                            Etape {report.step_order}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-zinc-200">
                        {report.message}
                      </p>
                    </div>

                    <div className="text-right shrink-0 flex items-start gap-2">
                      <div>
                        <p className="text-xs text-zinc-600">
                          {new Date(report.created_at).toLocaleDateString(
                            "fr-FR",
                            {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </p>
                        {report.player_name && (
                          <p className="text-xs text-zinc-500 mt-0.5">
                            {report.player_name}
                          </p>
                        )}
                      </div>
                      <ChevronDown
                        className={`size-4 text-zinc-600 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-zinc-800 p-4 space-y-4">
                    {/* Step details */}
                    {report.game_steps && (
                      <div className="px-3 py-2 bg-zinc-800/50 rounded-lg text-xs space-y-1">
                        <p className="text-zinc-500">
                          <span className="font-medium text-zinc-400">
                            Enigme:
                          </span>{" "}
                          {extractText(report.game_steps.riddle_text)?.slice(
                            0,
                            200
                          )}
                        </p>
                        {report.game_steps.answer_text && (
                          <p className="text-zinc-500">
                            <span className="font-medium text-emerald-500">
                              Reponse:
                            </span>{" "}
                            {extractText(report.game_steps.answer_text)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Admin notes */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-zinc-400 flex items-center gap-1">
                        <MessageSquare className="size-3" />
                        Notes admin
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={
                            noteInputs[report.id] ??
                            report.admin_notes ??
                            ""
                          }
                          onChange={(e) =>
                            setNoteInputs((prev) => ({
                              ...prev,
                              [report.id]: e.target.value,
                            }))
                          }
                          placeholder="Ajouter une note..."
                          className="flex-1 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-zinc-400 hover:text-white"
                          disabled={
                            updating === report.id ||
                            (noteInputs[report.id] ?? report.admin_notes ?? "") ===
                              (report.admin_notes ?? "")
                          }
                          onClick={() =>
                            updateReport(
                              report.id,
                              undefined,
                              noteInputs[report.id] ??
                                report.admin_notes ??
                                ""
                            )
                          }
                        >
                          <Send className="size-3" />
                        </Button>
                      </div>
                      {report.admin_notes &&
                        noteInputs[report.id] === undefined && (
                          <p className="text-xs text-zinc-500 italic">
                            {report.admin_notes}
                          </p>
                        )}
                    </div>

                    {/* Status actions */}
                    <div className="flex gap-2 flex-wrap">
                      {actions.map((action) => {
                        const ActionIcon = action.icon;
                        return (
                          <Button
                            key={action.next}
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            disabled={updating === report.id}
                            onClick={() =>
                              updateReport(report.id, action.next)
                            }
                          >
                            <ActionIcon className="size-3 mr-1" />
                            {action.label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 p-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">
            {filter === "all"
              ? "Aucun signalement. Tout est en ordre !"
              : `Aucun signalement "${STATUS_CONFIG[filter]?.label}"`}
          </p>
        </div>
      )}
    </div>
  );
}
