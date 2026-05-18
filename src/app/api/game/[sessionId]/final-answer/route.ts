/**
 * POST /api/game/[sessionId]/final-answer
 *
 * Endpoint de soumission de l'énigme finale (vision client 2026-05-16).
 *
 * Logique :
 *   - 2 essais max (cf. migration 027 : final_attempts_used CHECK 0..2)
 *   - Comparaison fuzzy : trim + lowercase + accent-strip + ponctuation
 *   - Succès au 1er ou 2e essai → final_succeeded = true, retourne
 *     explanation + epilogue → page de félicitations
 *   - Échec au 2e essai → final_succeeded = false, retourne aussi
 *     explanation + epilogue (mode "voilà pourquoi") + bonne réponse
 *   - Le client UI affiche les confettis ou le mode "révélation"
 *     en fonction de `succeeded`.
 *
 * La session doit être en status="completed" (joueur a fini tous les
 * stops). Si elle est encore active, on rejette — l'énigme finale est
 * la dernière étape, pas un raccourci pour skipper la partie.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { t, detectLocale } from "@/lib/i18n";

const MAX_ATTEMPTS = 2;

/**
 * Normalise une string pour la comparaison fuzzy :
 *   - lowercase
 *   - trim
 *   - Unicode NFD pour décomposer les accents, puis suppression des
 *     codes combinants (accents) → "café" devient "cafe"
 *   - suppression de la ponctuation finale (".", "!", "?", ",")
 *   - collapse des whitespaces internes en un seul espace
 */
function normalizeAnswer(input: string): string {
  // Tolérant 2026-05-18 : on enlève AUSSI dashes, underscores, espaces,
  // ponctuation. Comme ça "1990-3-1934-428" ≡ "199031934428" ≡ "1990 3 1934 428".
  // Le joueur tape comme il veut, l'API comprend.
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-_/\\.,!?;:\s]+/g, ""); // strip ALL separators + ponctuation
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const locale = detectLocale(request);
    const body = await request.json();
    const userAnswer = typeof body?.answer === "string" ? body.answer : "";

    if (!userAnswer || userAnswer.trim().length === 0) {
      return NextResponse.json(
        { error: "Réponse vide" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    // ── 1. Fetch session ──
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session introuvable" },
        { status: 404 },
      );
    }

    // Le joueur doit avoir TERMINÉ tous les stops avant de tenter
    // l'énigme finale. Si la session est encore active, il a sauté
    // une étape — on refuse.
    if (session.status !== "completed") {
      return NextResponse.json(
        { error: "Vous devez d'abord terminer tous les stops avant l'énigme finale" },
        { status: 400 },
      );
    }

    // Si la résolution est déjà actée (succès ou 2 échecs), on renvoie
    // l'état existant sans re-décrémenter ni re-écrire — idempotence.
    if (session.final_succeeded === true || session.final_succeeded === false) {
      return await respondWithResolution(supabase, session, locale);
    }

    if (session.final_attempts_used >= MAX_ATTEMPTS) {
      // Cas de sécurité — la résolution aurait dû être actée avant.
      // On la force ici (échec) et on renvoie l'épilogue d'échec.
      await supabase
        .from("game_sessions")
        .update({
          final_succeeded: false,
          final_resolved_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return await respondWithResolution(
        supabase,
        { ...session, final_succeeded: false },
        locale,
      );
    }

    // ── 2. Fetch game (énigme + bonne réponse) ──
    const { data: game, error: gameError } = await supabase
      .from("games")
      .select("id, title, final_riddle_text, final_answer, final_answer_explanation, epilogue_title, epilogue_text")
      .eq("id", session.game_id)
      .single();

    if (gameError || !game) {
      return NextResponse.json(
        { error: "Jeu introuvable" },
        { status: 404 },
      );
    }

    // ── 3. Compare. Deux mécaniques possibles, dans cet ordre :
    //
    //   A. games.final_answer (curé par Claude) — un mot, une date, une
    //      phrase courte que le joueur DOIT DÉDUIRE des indices. Plus
    //      gratifiant intellectuellement mais plus difficile.
    //
    //   B. Concaténation littérale des answer_text de chaque stop avec
    //      séparateur "-". Mécanique simple : le joueur recopie son
    //      carnet. Fallback quand games.final_answer est null (jeux
    //      générés avant migration 027 ou avec generateFinalRiddle KO).
    //
    // Le UI peut indiquer au joueur quelle mécanique est attendue via
    // games.final_riddle_text (le brief du guide).
    const submittedNorm = normalizeAnswer(userAnswer);

    let isCorrect = false;
    let canonicalAnswer = "";

    if (game.final_answer && typeof game.final_answer === "string") {
      // Mode A : réponse curée
      canonicalAnswer = game.final_answer;
      isCorrect = normalizeAnswer(game.final_answer) === submittedNorm;
    } else {
      // Mode B : concaténation des indices (legacy logic)
      const { data: steps } = await supabase
        .from("game_steps")
        .select("step_order, answer_text")
        .eq("game_id", session.game_id)
        .order("step_order", { ascending: true });

      if (!steps || steps.length === 0) {
        return NextResponse.json(
          { error: "Étapes introuvables" },
          { status: 404 },
        );
      }
      const expectedParts = steps.map((s) =>
        typeof s.answer_text === "string"
          ? s.answer_text
          : t(s.answer_text, locale) ?? "",
      );
      canonicalAnswer = expectedParts.join("-");
      const expectedWithSep = normalizeAnswer(expectedParts.join("-"));
      const expectedNoSep = normalizeAnswer(expectedParts.join(""));
      isCorrect = submittedNorm === expectedWithSep || submittedNorm === expectedNoSep;
      // Aussi accept "part1-part2-part3" même mal séparé (espaces, /, etc.)
      if (!isCorrect) {
        const userParts = userAnswer
          .split(/[-_\s.,;/|]+/)
          .map((p: string) => normalizeAnswer(p))
          .filter((p: string) => p.length > 0);
        if (userParts.length === expectedParts.length) {
          isCorrect = userParts.every(
            (p: string, i: number) => p === normalizeAnswer(expectedParts[i]),
          );
        }
      }
    }

    const newAttemptsUsed = (session.final_attempts_used ?? 0) + 1;
    const isFinalAttempt = newAttemptsUsed >= MAX_ATTEMPTS;

    if (isCorrect) {
      await supabase
        .from("game_sessions")
        .update({
          final_attempts_used: newAttemptsUsed,
          final_succeeded: true,
          final_resolved_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      return NextResponse.json({
        result: "success",
        attemptsUsed: newAttemptsUsed,
        attemptsRemaining: 0,
        explanation: t(game.final_answer_explanation, locale),
        epilogueTitle: t(game.epilogue_title, locale),
        epilogueText: t(game.epilogue_text, locale),
        // On expose la bonne réponse aussi en cas de succès (l'UI peut
        // l'afficher comme "vous avez trouvé : XXX").
        correctAnswer: canonicalAnswer,
      });
    }

    // Mauvaise réponse
    if (!isFinalAttempt) {
      // Encore une chance — pas de résolution, juste increment du compteur
      await supabase
        .from("game_sessions")
        .update({ final_attempts_used: newAttemptsUsed })
        .eq("id", sessionId);

      return NextResponse.json({
        result: "wrong",
        attemptsUsed: newAttemptsUsed,
        attemptsRemaining: MAX_ATTEMPTS - newAttemptsUsed,
        message: "Pas tout à fait — il vous reste un essai",
      });
    }

    // 2e essai raté → résolution définitive (échec)
    await supabase
      .from("game_sessions")
      .update({
        final_attempts_used: newAttemptsUsed,
        final_succeeded: false,
        final_resolved_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    return NextResponse.json({
      result: "failed",
      attemptsUsed: newAttemptsUsed,
      attemptsRemaining: 0,
      correctAnswer: game.final_answer,
      explanation: t(game.final_answer_explanation, locale),
      epilogueTitle: t(game.epilogue_title, locale),
      epilogueText: t(game.epilogue_text, locale),
    });
  } catch (err) {
    console.error("[final-answer] threw:", err);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 },
    );
  }
}

/**
 * Idempotent re-fetch : renvoie l'état de résolution existant sans
 * re-décrémenter les essais. Utilisé quand la session a déjà été
 * résolue et que le client repolle.
 */
async function respondWithResolution(
  supabase: ReturnType<typeof createAdminClient>,
  session: {
    game_id: string;
    final_succeeded: boolean | null;
    final_attempts_used: number;
  },
  locale: string,
) {
  const { data: game } = await supabase
    .from("games")
    .select("final_answer, final_answer_explanation, epilogue_title, epilogue_text")
    .eq("id", session.game_id)
    .single();

  return NextResponse.json({
    result: session.final_succeeded ? "success" : "failed",
    attemptsUsed: session.final_attempts_used,
    attemptsRemaining: 0,
    correctAnswer: game?.final_answer ?? null,
    explanation: t(game?.final_answer_explanation ?? null, locale),
    epilogueTitle: t(game?.epilogue_title ?? null, locale),
    epilogueText: t(game?.epilogue_text ?? null, locale),
    alreadyResolved: true,
  });
}
