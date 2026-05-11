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

      case "twin_stops":
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
