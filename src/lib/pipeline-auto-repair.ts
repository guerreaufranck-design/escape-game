/**
 * Pipeline auto-repair — Pipeline C.
 *
 * Tourne ENTRE le validator (qui détecte) et le flip is_published=true
 * (qui rend le jeu visible). Tente automatiquement de fixer chaque
 * classe d'issue détectée, puis le validator re-run pour confirmer.
 *
 * Objectif : marché global 24/7, achats à 3h du matin → la pipeline
 * DOIT se débrouiller seule, sans intervention humaine. L'email
 * `needs_review` reste pour t'informer après-coup, mais il n'est
 * envoyé QUE pour les cas vraiment irréparables (twin stops, below
 * floor — structurels, nécessitant editorial reframing).
 *
 * Stratégies par issue :
 *
 *   translation_incomplete  → 2e passe prepareGamePackage. La première
 *                              passe a déjà 4 retries Gemini built-in
 *                              (cf. translate-service.ts). La 2e passe
 *                              donne 4 retries supplémentaires sur les
 *                              fields encore en EN. Total 8 tentatives.
 *
 *   audio_coverage_mismatch → cascade du fix translation. Quand toutes
 *                              les traductions sont OK, prepareGamePackage
 *                              génère les audios manquants (idempotent).
 *
 *   roman_date_drift        → regenerateStep avec injection de la date
 *                              extraite de la narration comme contrainte
 *                              forte. Puis invalidate cache audio +
 *                              translation pour CE step, et 3e passe
 *                              prepareGamePackage pour re-traduire +
 *                              re-générer audio du step corrigé.
 *
 *   twin_stops              → NON-AUTO-REPAIRABLE (structurel — drop
 *                              le doublon descend sous floor 6).
 *                              Reste flag needs_review.
 *
 *   below_floor             → NON-AUTO-REPAIRABLE (zone trop sparse,
 *                              fiche éditorialement à refaire). Reste
 *                              flag needs_review.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { prepareGamePackage } from "@/lib/game-package";
import { regenerateStep } from "@/lib/anthropic";
import type { ValidationResult } from "@/lib/pipeline-validators";
import type { GameGenre } from "@/lib/game-genres";

export interface AutoRepairResult {
  /** Est-ce qu'on a tenté au moins un repair ? Si false, pas la peine de
   *  re-valider (rien n'a changé). */
  anyAttempted: boolean;
  /** Issues qu'on a tenté de fixer cette itération. */
  attemptedIssues: string[];
  /** Issues qu'on N'A PAS pu attempter (structurelles). */
  unrepairableIssues: string[];
}

/**
 * Tente de réparer les issues détectées par le validator. Idempotent
 * et safe à appeler plusieurs fois.
 */
export async function attemptAutoRepair(
  gameId: string,
  validation: ValidationResult,
  context: {
    language?: string;
    city: string;
    theme: string;
    narrative: string;
    genre?: GameGenre;
  },
): Promise<AutoRepairResult> {
  const supabase = createAdminClient();
  const attempted: string[] = [];
  const unrepairable: string[] = [];

  for (const issue of validation.issues) {
    switch (issue.code) {
      case "translation_incomplete":
      case "audio_coverage_mismatch": {
        // Une 2e passe prepareGamePackage retraduit les fields manquants
        // (cache hit = pas re-traduit ; cache miss = nouvelle tentative
        // avec 4 retries Gemini). Et regenere les audios pour les fields
        // qui ont maintenant une traduction valide.
        if (!context.language) {
          unrepairable.push(`${issue.code} (no language)`);
          continue;
        }
        console.log(
          `[auto-repair] Re-running prepareGamePackage for ${issue.code} (${context.language})`,
        );
        try {
          await prepareGamePackage(gameId, context.language);
          attempted.push(issue.code);
        } catch (err) {
          console.warn(
            `[auto-repair] prepareGamePackage 2nd-pass threw: ${err instanceof Error ? err.message : err}`,
          );
        }
        break;
      }

      case "roman_date_drift": {
        // (OBSOLÈTE 2026-05-13) Roman numerals sont TOTALEMENT bannis du
        // pipeline. Cf. anthropic.ts sanitizeRomanNumeralField +
        // replaceRomansEmbedded qui convertissent post-Claude. Plus
        // aucun drift possible.
        //
        // Si quand même on tombe ici (validator hyper-cas, ne devrait
        // plus arriver), on marque non-réparable et on flag needs_review.
        console.warn(
          `[auto-repair] roman_date_drift detected but Roman numerals are banned upstream — flagging as unrepairable (rare)`,
        );
        unrepairable.push("roman_date_drift (banned upstream, manual fix only)");
        // Conserver le re-run de prepareGamePackage comme avant : si on
        // est arrivé ici c'est qu'il y a peut-être eu d'autres modifs
        // (traduction, audio) qui nécessitent un refresh package.
        if (attempted.length > 0 && context.language) {
          console.log(
            `[auto-repair] Re-running prepareGamePackage post-Roman-fix`,
          );
          try {
            await prepareGamePackage(gameId, context.language);
          } catch (err) {
            console.warn(
              `[auto-repair] prepareGamePackage post-Roman-fix threw: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
        break;
      }

      case "twin_stops": {
        // Auto-repair par RÉORDONNANCEMENT (idée user 11/05) : si stops
        // 3 et 4 sont à 25m, on cherche un step k plus loin qui peut
        // s'insérer entre eux. New order: [1,2,3,k,4,...] → distances
        // 3↔k et k↔4 doivent être ≥ 100m. Le joueur fait un détour
        // mais visite tout — accepté car "pas si grave qu'ils reviennent
        // sur leurs pas".
        //
        // Avantage vs drop+replace : on garde tous les stops, on respecte
        // le floor 6, et pas de re-discovery coûteuse.
        const twins = (issue.details?.twins as Array<{
          a: number; b: number; distanceM: number;
        }>) ?? [];
        const { data: stepsData } = await supabase
          .from("game_steps")
          .select("id, step_order, latitude, longitude")
          .eq("game_id", gameId)
          .order("step_order");
        if (!stepsData || stepsData.length === 0) {
          unrepairable.push("twin_stops (no steps)");
          break;
        }
        let repaired = false;
        for (const twin of twins) {
          const swap = findReorderSwap(stepsData, twin.a, twin.b);
          if (swap) {
            console.log(
              `[auto-repair] twin_stops: reorder step ${swap.from} ↔ step ${swap.to}`,
            );
            await applyStepReorder(gameId, swap.from, swap.to);
            repaired = true;
            attempted.push(`twin_stops (reorder ${swap.from}↔${swap.to})`);
          } else {
            console.log(
              `[auto-repair] twin_stops: no valid reorder found for pair ${twin.a}↔${twin.b}`,
            );
          }
        }
        if (!repaired) {
          unrepairable.push("twin_stops (no valid reorder)");
        }
        break;
      }

      case "below_floor": {
        // Non-auto-repairable : nécessite re-discovery + re-curation
        // (refacto majeur). Laisser le flag needs_review → email.
        unrepairable.push(issue.code);
        console.log(
          `[auto-repair] ${issue.code} marked as structural — needs human review`,
        );
        break;
      }
    }
  }

  return {
    anyAttempted: attempted.length > 0,
    attemptedIssues: attempted,
    unrepairableIssues: unrepairable,
  };
}

/**
 * Distance haversine entre 2 points lat/lon, en mètres. Helper local.
 */
function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

/**
 * Cherche un swap step_order valide pour résoudre un twin (a ↔ b
 * consécutifs et trop proches). Brute-force toutes les positions de
 * swap possibles et retourne la première qui donne TOUTES les
 * distances inter-stops consécutives ≥ 100m.
 *
 * Algo : pour chaque step k différent de a et b :
 *   - swap b et k dans l'ordre
 *   - recalcule toutes les distances consécutives
 *   - si toutes ≥ 100m → retourne { from: b, to: k }
 *
 * Si aucun swap valide n'existe (cas rare : multiple twins entremêlés),
 * retourne null → on flag.
 */
function findReorderSwap(
  steps: Array<{
    step_order: number;
    latitude: number;
    longitude: number;
  }>,
  twinA: number,
  twinB: number,
): { from: number; to: number } | null {
  const ABSOLUTE_MIN = 100; // mètres
  // Sort par step_order croissant
  const sorted = [...steps].sort((x, y) => x.step_order - y.step_order);
  // On cherche à swap twinB avec un step k. twinB est le 2e du twin
  // (a < b dans le validator).
  for (const candidate of sorted) {
    if (candidate.step_order === twinA || candidate.step_order === twinB)
      continue;
    // Build the candidate order after swap
    const swapped = sorted.map((s) => {
      if (s.step_order === twinB) return { ...s, step_order: candidate.step_order };
      if (s.step_order === candidate.step_order) return { ...s, step_order: twinB };
      return s;
    });
    swapped.sort((x, y) => x.step_order - y.step_order);
    // Check all consecutive distances ≥ ABSOLUTE_MIN
    let ok = true;
    for (let i = 0; i < swapped.length - 1; i++) {
      const d = haversineMeters(
        { lat: swapped[i].latitude, lon: swapped[i].longitude },
        { lat: swapped[i + 1].latitude, lon: swapped[i + 1].longitude },
      );
      if (d < ABSOLUTE_MIN) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { from: twinB, to: candidate.step_order };
    }
  }
  return null;
}

/**
 * Applique un swap de step_order entre 2 steps. Utilise le pattern
 * 3-phase pour éviter les conflicts unique(game_id, step_order) :
 *   1. shift `from` à un offset temporaire (1000+)
 *   2. set `to` → `from`
 *   3. set offset → `to`
 *
 * Met à jour à la fois `game_steps` ET `audio_cache` (qui référence
 * step_order pour les MP3). Les `translations_cache` sont indexées
 * par step.id (UUID), pas par step_order — pas besoin de toucher.
 */
async function applyStepReorder(
  gameId: string,
  from: number,
  to: number,
): Promise<void> {
  const supabase = createAdminClient();
  const OFFSET = 1000;

  // Phase 1 : shift `from` au temporaire (game_steps uniquement,
  // pas audio_cache — on va le purger plus bas).
  await supabase
    .from("game_steps")
    .update({ step_order: OFFSET + from })
    .eq("game_id", gameId)
    .eq("step_order", from);

  // Phase 2 : `to` → `from`
  await supabase
    .from("game_steps")
    .update({ step_order: from })
    .eq("game_id", gameId)
    .eq("step_order", to);

  // Phase 3 : temporaire → `to`
  await supabase
    .from("game_steps")
    .update({ step_order: to })
    .eq("game_id", gameId)
    .eq("step_order", OFFSET + from);

  // ════════════════════════════════════════════════════════════
  // AUDIO_CACHE : PURGE complète des slots des 2 stops impactés
  // ════════════════════════════════════════════════════════════
  // Bug rapporté Montpellier 2026-05-19 (root cause) : l'ancien code
  // swappait juste step_order dans audio_cache mais gardait le
  // storage_path qui encode l'ancien step_order dans le nom de
  // fichier (`step1_landmark_history.mp3`). Conséquence :
  //   - Après swap : row(step_order=1) avait storage_path=stepN_*.mp3
  //   - prepareGamePackage 2e passe : cache check (step_order, slot)
  //     voyait que tout était cached → no-op
  //   - MAIS si un slot manquait au moment du swap et était généré
  //     plus tard, l'upsert écrasait le storage file via upsert:true
  //     → 2 rows DB pointant vers le même fichier → audio dupliqué
  //
  // Fix : DELETE les rows audio_cache pour les 2 step_orders impactés.
  // La prochaine passe prepareGamePackage régénère tous les slots avec
  // les bons step_orders et les bons paths déterministes. Coût : ~$0.05
  // en ElevenLabs Flash v2.5 pour ~8 slots × ~$0.006 = négligeable vs
  // un jeu cassé.
  //
  // Les fichiers en storage (mp3 ancien) sont volontairement laissés
  // orphelins — ils seront overwrités par le prochain upload au même
  // path (idempotent). Pas de fuite : storage Supabase coûte $0.021/GB.
  await supabase
    .from("audio_cache")
    .delete()
    .eq("game_id", gameId)
    .in("step_order", [from, to]);

  console.log(
    `[applyStepReorder] swapped step_order ${from} ↔ ${to} for game ${gameId}. ` +
      `Purged audio_cache rows for these 2 steps — next prepareGamePackage pass ` +
      `will regenerate all audio with correct step_order mapping.`,
  );
}

/**
 * Encode un entier décimal en Roman numeral. Helper pour auto-repair
 * Roman drift.
 */
function encodeRoman(num: number): string {
  if (num <= 0 || num >= 4000) return "";
  const pairs: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let result = "";
  let remaining = num;
  for (const [value, letter] of pairs) {
    while (remaining >= value) {
      result += letter;
      remaining -= value;
    }
  }
  return result;
}
