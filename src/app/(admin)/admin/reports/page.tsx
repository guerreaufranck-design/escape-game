import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { t } from "@/lib/i18n";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  new: { label: "Nouveau", color: "bg-orange-500/20 text-orange-400 border-orange-500/30", icon: AlertTriangle },
  reviewed: { label: "En cours", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: Clock },
  fixed: { label: "Corrige", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  dismissed: { label: "Rejete", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30", icon: XCircle },
};

export default async function AdminReportsPage() {
  const supabase = await createClient();

  const { data: reports } = await supabase
    .from("error_reports")
    .select(`
      *,
      games(title, city),
      game_steps(step_order, title, riddle_text, answer_text)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  const newCount = reports?.filter((r) => r.status === "new").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">
          Signalements d&apos;erreurs
          {newCount > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-500/20 text-orange-400 border border-orange-500/30">
              {newCount} nouveau{newCount > 1 ? "x" : ""}
            </span>
          )}
        </h1>
        <p className="text-sm text-zinc-500">
          Les joueurs signalent les erreurs dans les enigmes
        </p>
      </div>

      {reports && reports.length > 0 ? (
        <div className="space-y-3">
          {reports.map((report) => {
            const statusConf = STATUS_CONFIG[report.status] || STATUS_CONFIG.new;
            const StatusIcon = statusConf.icon;
            const game = report.games as { title: Record<string, string>; city: string } | null;
            const step = report.game_steps as { step_order: number; title: Record<string, string>; riddle_text: Record<string, string>; answer_text: Record<string, string> | null } | null;

            return (
              <div
                key={report.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={statusConf.color}>
                        <StatusIcon className="size-3 mr-1" />
                        {statusConf.label}
                      </Badge>
                      {game && (
                        <span className="text-xs text-zinc-500">
                          {t(game.title)} - {game.city}
                        </span>
                      )}
                      {step && (
                        <span className="text-xs text-zinc-600">
                          Etape {step.step_order}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 text-sm text-zinc-200">
                      {report.message}
                    </p>

                    {step && (
                      <div className="mt-2 px-3 py-2 bg-zinc-800/50 rounded-lg text-xs space-y-1">
                        <p className="text-zinc-500">
                          <span className="font-medium text-zinc-400">Enigme:</span>{" "}
                          {t(step.riddle_text)?.slice(0, 150)}...
                        </p>
                        {step.answer_text && (
                          <p className="text-zinc-500">
                            <span className="font-medium text-emerald-500">Reponse:</span>{" "}
                            {t(step.answer_text)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs text-zinc-600">
                      {new Date(report.created_at).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {report.player_name && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {report.player_name}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-zinc-700 p-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-zinc-500">
            Aucun signalement. Tout est en ordre !
          </p>
        </div>
      )}
    </div>
  );
}
