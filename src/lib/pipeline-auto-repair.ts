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
        // Pour chaque step en drift, regen avec injection forte de la
        // date correcte (la 1ère date extraite de riddle/anecdote).
        const drifts = (issue.details?.romanDrifts as Array<{
          step: number;
          roman: string;
          decoded: number;
          mentionedDates: number[];
        }>) ?? [];
        for (const drift of drifts) {
          const { data: step } = await supabase
            .from("game_steps")
            .select("*")
            .eq("game_id", gameId)
            .eq("step_order", drift.step)
            .single();
          if (!step) continue;
          // Choix de la date cible : la première date mentionnée dans
          // riddle/anecdote. C'est l'année historiquement ancrée que
          // Claude doit mettre comme ar_facade_text Roman.
          const targetYear = drift.mentionedDates[0];
          if (typeof targetYear !== "number") continue;
          const targetRoman = encodeRoman(Math.abs(targetYear));
          console.log(
            `[auto-repair] Roman drift step ${drift.step}: regen with target=${targetYear} (${targetRoman})`,
          );
          try {
            const regenerated = await regenerateStep({
              brokenStep: {
                title: step.title,
                latitude: step.latitude,
                longitude: step.longitude,
                validation_radius_meters: step.validation_radius_meters,
                riddle_text: step.riddle_text,
                answer_text: step.answer_text,
                hints: Array.isArray(step.hints) ? step.hints : [],
                anecdote: step.anecdote ?? "",
                bonus_time_seconds: step.bonus_time_seconds ?? 0,
                answer_source: step.answer_source === "virtual_ar" ? "virtual_ar" : "physical",
                ar_character_type: step.ar_character_type ?? "default",
                ar_character_dialogue: step.ar_character_dialogue ?? "",
                ar_facade_text: step.ar_facade_text ?? "",
                ar_treasure_reward: step.ar_treasure_reward ?? "",
                route_attractions: Array.isArray(step.route_attractions)
                  ? step.route_attractions
                  : [],
              },
              issue: {
                step_index: drift.step - 1,
                problem: `The ar_facade_text "${drift.roman}" decodes to ${drift.decoded}, which is ${Math.abs(drift.decoded - targetYear)} years away from the date ${targetYear} mentioned in riddle/anecdote. ElevenLabs reads Roman numerals letter-by-letter, so this drift confuses the player. Fix: set ar_facade_text and answer_text to the Roman numeral encoding ${targetRoman} = ${targetYear}.`,
                severity: "blocking",
                suggestion: `Set ar_facade_text="${targetRoman}" and answer_text="${targetRoman}". Keep the riddle/anecdote narration using Arabic numerals (${targetYear}) only. Do NOT include Roman numerals in narration text.`,
              },
              location: {
                name: step.landmark_name ?? step.title,
                latitude: step.latitude,
                longitude: step.longitude,
                whatToObserve: "",
                answer: targetRoman,
                answerType: "year",
                source: "",
              },
              city: context.city,
              theme: context.theme,
              narrative: context.narrative,
              stepNumber: drift.step,
              totalSteps: 6,
              genre: context.genre,
            });
            // Update DB
            await supabase
              .from("game_steps")
              .update({
                title: regenerated.title,
                riddle_text: regenerated.riddle_text,
                ar_facade_text: regenerated.ar_facade_text,
                ar_character_dialogue: regenerated.ar_character_dialogue,
                ar_treasure_reward: regenerated.ar_treasure_reward,
                anecdote: regenerated.anecdote,
                answer_text: regenerated.answer_text,
                hints: regenerated.hints,
              })
              .eq("id", step.id);
            // Invalidate audio + translation cache pour ce step (les
            // anciens fichiers contiennent du texte EN du drift)
            await supabase
              .from("audio_cache")
              .delete()
              .eq("game_id", gameId)
              .eq("step_order", drift.step);
            await supabase
              .from("translations_cache")
              .delete()
              .eq("source_id", step.id);
            attempted.push(`roman_date_drift step ${drift.step}`);
            console.log(
              `[auto-repair] Step ${drift.step} regenerated successfully — cache invalidated`,
            );
          } catch (err) {
            console.warn(
              `[auto-repair] regenerateStep step ${drift.step} threw: ${err instanceof Error ? err.message : err}`,
            );
          }
        }
        // Après les regens, on re-run prepareGamePackage pour re-traduire
        // + re-audio les steps modifiés.
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
  // Phase 1 : shift `from` au temporaire
  await supabase
    .from("game_steps")
    .update({ step_order: OFFSET + from })
    .eq("game_id", gameId)
    .eq("step_order", from);
  await supabase
    .from("audio_cache")
    .update({ step_order: OFFSET + from })
    .eq("game_id", gameId)
    .eq("step_order", from);
  // Phase 2 : `to` → `from`
  await supabase
    .from("game_steps")
    .update({ step_order: from })
    .eq("game_id", gameId)
    .eq("step_order", to);
  await supabase
    .from("audio_cache")
    .update({ step_order: from })
    .eq("game_id", gameId)
    .eq("step_order", to);
  // Phase 3 : temporaire → `to`
  await supabase
    .from("game_steps")
    .update({ step_order: to })
    .eq("game_id", gameId)
    .eq("step_order", OFFSET + from);
  await supabase
    .from("audio_cache")
    .update({ step_order: to })
    .eq("game_id", gameId)
    .eq("step_order", OFFSET + from);
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
