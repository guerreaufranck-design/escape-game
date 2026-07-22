/**
 * Email notifications via Resend
 * Used for pipeline failure alerts and operational notifications
 */

import { Resend } from "resend";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[Email] RESEND_API_KEY not configured — emails disabled");
      return null;
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

const ADMIN_EMAIL = "guerreau.franck@gmail.com";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "noreply@oddballtrip.com";
// Optional CC: when set, the oddballtrip ops team also receives the
// pipeline-failure alert. Lets them fix landmark names on their side
// without waiting for the escape-game admin to forward the message.
const ODDBALLTRIP_ALERT_EMAIL = process.env.ODDBALLTRIP_ALERT_EMAIL;

/**
 * Send alert when game generation pipeline fails
 * Called automatically so admin can manually retry or contact client
 */
export async function sendPipelineFailureAlert(params: {
  city: string;
  country: string;
  theme: string;
  slug: string;
  error: string;
  errorCode?: string;
  failedLandmarks?: Array<{ stopName: string; tried: string[] }>;
  /** Stops auto-substitués par auto-discovery. Quand fourni, l'email
   *  inclut une section dédiée listant `original → remplacement` pour
   *  que l'opérateur sache que la fiche produit doit être ajustée. */
  replacedStops?: Array<{ original: string; replacement: string }>;
  /** Snippet de la nouvelle narration générée par Claude après
   *  remplacement. Permet à l'équipe oddballtrip de copier-coller
   *  la nouvelle accroche sur la page de vente sans aller chercher
   *  dans la DB. */
  adaptedNarrative?: { themeDescription: string; narrative: string };
  durationSeconds?: number;
  buyerEmail?: string;
  orderId?: string;
  /** StartPoint reçu d'oddballtrip dans le body. Affiché dans l'email
   *  + lien Google Maps cliquable pour vérifier les coords visuellement.
   *  Critique pour diagnostiquer les TOO_FEW_LANDMARKS / GEOCODING_FAILED. */
  startPoint?: { lat: number; lon: number };
  stopCount?: number;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const {
    city,
    country,
    theme,
    slug,
    error,
    errorCode,
    failedLandmarks,
    replacedStops,
    adaptedNarrative,
    durationSeconds,
    buyerEmail,
    orderId,
    startPoint,
    stopCount,
  } = params;

  // Build recipient list: escape-game admin always; oddballtrip team
  // when configured. Buyer is intentionally NOT included — they don't
  // need (or want) technical details, and oddballtrip handles the
  // customer-facing comms.
  const to = ODDBALLTRIP_ALERT_EMAIL
    ? [ADMIN_EMAIL, ODDBALLTRIP_ALERT_EMAIL]
    : [ADMIN_EMAIL];

  // Highlight the structured failure details in the email body so the
  // recipient can act without opening the dashboard.
  const failureDetailHtml = (() => {
    if (!failedLandmarks?.length) return "";
    const rows = failedLandmarks
      .map(
        (f) =>
          `<tr><td style="padding: 4px 8px; border-bottom: 1px solid #fde68a;">${f.stopName}</td><td style="padding: 4px 8px; border-bottom: 1px solid #fde68a; color: #92400e;">${f.tried.map((s) => `"${s}"`).join(", ")}</td></tr>`,
      )
      .join("");
    return `
      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 16px 0;">
        <strong>📍 Landmarks introuvables (à corriger côté oddballtrip) :</strong>
        <table style="width: 100%; margin-top: 8px; border-collapse: collapse;">
          <thead><tr><th style="text-align: left; padding: 4px 8px; border-bottom: 2px solid #f59e0b;">Stop name</th><th style="text-align: left; padding: 4px 8px; border-bottom: 2px solid #f59e0b;">Tried</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  })();

  try {
    // Subject + bandeau dépendent du code : STOPS_REPLACED n'est pas
    // un échec (le jeu est publié), c'est une notification opérationnelle.
    const isReplacement = errorCode === "STOPS_REPLACED";
    const isDropped = errorCode === "STOPS_DROPPED";
    const subjectPrefix = isReplacement
      ? "🔄 Pipeline OK avec substitution"
      : isDropped
        ? "⚠️ Pipeline OK avec stops droppés"
        : "⚠️ Pipeline échec";
    const headlineColor = isReplacement || isDropped ? "#1e3a8a" : "#dc2626";
    const headlineText = isReplacement
      ? "🔄 Jeu publié avec stops remplacés (fiche produit à mettre à jour)"
      : isDropped
        ? "⚠️ Jeu publié avec stops droppés"
        : "🚨 Échec de génération de jeu";

    await client.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${subjectPrefix} — ${city} "${theme}"${errorCode ? ` (${errorCode})` : ""}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${headlineColor};">${headlineText}</h2>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Ville</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${city}, ${country}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Thème</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${theme}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Slug</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code>${slug}</code></td></tr>
            ${errorCode ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Code</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code>${errorCode}</code></td></tr>` : ""}
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Erreur</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626;">${error}</td></tr>
            ${
              startPoint
                ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">StartPoint reçu</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-family: monospace;">${startPoint.lat.toFixed(6)}, ${startPoint.lon.toFixed(6)} <a href="https://www.google.com/maps/@${startPoint.lat},${startPoint.lon},18z" style="color: #2563eb; margin-left: 8px;">📍 Voir sur Google Maps</a></td></tr>`
                : `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">StartPoint reçu</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626;"><strong>MISSING</strong> — oddballtrip n'a pas transmis body.startPoint</td></tr>`
            }
            ${typeof stopCount === "number" ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">StopCount demandé</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${stopCount}</td></tr>` : ""}
            ${durationSeconds ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Durée</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${durationSeconds}s</td></tr>` : ""}
            ${buyerEmail ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Email client</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${buyerEmail}">${buyerEmail}</a></td></tr>` : ""}
            ${orderId ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Commande</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${orderId}</td></tr>` : ""}
          </table>

          ${failureDetailHtml}

          ${
            replacedStops?.length
              ? `
          <div style="background: #dbeafe; border: 1px solid #2563eb; border-radius: 8px; padding: 12px; margin: 16px 0;">
            <strong>🔄 Stops auto-substitués (action côté oddballtrip requise) :</strong>
            <p style="margin: 8px 0; color: #1e3a8a;">Les landmarks ci-dessous étaient introuvables et ont été remplacés par des POIs réels découverts via Google Places dans un rayon de 5–10 km du centre ville. <strong>La narration et le titre des étapes ont été régénérés par Claude</strong> pour matcher les nouveaux lieux — la fiche produit oddballtrip doit être mise à jour.</p>
            <table style="width: 100%; margin-top: 8px; border-collapse: collapse;">
              <thead><tr><th style="text-align: left; padding: 4px 8px; border-bottom: 2px solid #2563eb;">Original</th><th style="text-align: left; padding: 4px 8px; border-bottom: 2px solid #2563eb;">Remplacement (Google Places)</th></tr></thead>
              <tbody>${replacedStops
                .map(
                  (r) =>
                    `<tr><td style="padding: 4px 8px; border-bottom: 1px solid #bfdbfe; color: #7f1d1d;">${r.original}</td><td style="padding: 4px 8px; border-bottom: 1px solid #bfdbfe; color: #1e3a8a;">${r.replacement}</td></tr>`,
                )
                .join("")}</tbody>
            </table>
            ${
              adaptedNarrative
                ? `
            <details style="margin-top: 12px;">
              <summary style="cursor: pointer; color: #1e3a8a; font-weight: 600;">📝 Nouvelle narration générée (à copier-coller sur la fiche produit)</summary>
              <div style="background: #fff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px; margin-top: 8px;">
                <p style="margin: 0 0 8px; font-size: 13px; color: #475569;"><strong>themeDescription :</strong></p>
                <p style="margin: 0 0 12px; padding: 8px; background: #f1f5f9; border-radius: 4px;">${adaptedNarrative.themeDescription}</p>
                <p style="margin: 0 0 8px; font-size: 13px; color: #475569;"><strong>narrative :</strong></p>
                <p style="margin: 0; padding: 8px; background: #f1f5f9; border-radius: 4px; white-space: pre-wrap;">${adaptedNarrative.narrative}</p>
              </div>
            </details>
            `
                : ""
            }
          </div>
          `
              : ""
          }

          <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 16px 0;">
            <strong>⚡ Action requise :</strong> ${
              errorCode === "GEOCODING_FAILED"
                ? "Corriger les <code>landmarkName</code> ci-dessus côté oddballtrip puis relancer la génération."
                : errorCode === "STOPS_REPLACED"
                  ? "Mettre à jour la fiche produit oddballtrip avec la nouvelle <code>themeDescription</code> et le nouveau scénario (le contenu acheté ne correspond plus à 100% à ce qui sera joué)."
                  : `Relancer la génération manuellement depuis l'admin OddballTrip${buyerEmail ? `, puis envoyer le code d'activation à <strong>${buyerEmail}</strong>` : ""}.`
            }
          </div>

          <p style="color: #6b7280; font-size: 12px;">
            Timestamp: ${new Date().toISOString()}<br>
            Escape Game Pipeline — alerte automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Pipeline failure alert sent to ${to.join(", ")}`);
  } catch (err) {
    console.error(`[Email] Failed to send alert: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Send alert when a generated game has been flagged needs_review=true
 * by the pipeline sanity-check (cluster centroid drift > 5 km from
 * body.startPoint, etc.). Le jeu EST publié — c'est juste un avertissement
 * pour que l'opérateur inspecte AVANT que le code activation parte au
 * client. Sans cet email, le flag dort en DB et l'opérateur peut rater
 * un jeu à problème.
 */
export async function sendNeedsReviewAlert(params: {
  gameId: string;
  slug: string;
  city: string;
  theme: string;
  reviewReason: string;
  buyerEmail?: string;
  orderId?: string;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { gameId, slug, city, theme, reviewReason, buyerEmail, orderId } = params;

  // Recipient list : admin escape-game + ops oddballtrip si configurée.
  const to = ODDBALLTRIP_ALERT_EMAIL
    ? [ADMIN_EMAIL, ODDBALLTRIP_ALERT_EMAIL]
    : [ADMIN_EMAIL];

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `🟠 Jeu à reviewer — ${city} (${slug})`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 640px; margin: 0 auto;">
          <h2 style="color: #d97706;">🟠 Sanity-check : jeu publié mais à reviewer</h2>

          <p>
            Un jeu vient d'être généré et a été flaggé par la sanity-check post-discovery.
            Le jeu <strong>est en DB et publié</strong>, mais avant que le code activation
            soit envoyé au client, il faut inspecter le contenu et corriger si besoin.
          </p>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Slug</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code>${slug}</code></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Game ID</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code>${gameId}</code></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Ville</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${city}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Thème</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${theme}</td></tr>
            ${buyerEmail ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Client</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${buyerEmail}">${buyerEmail}</a></td></tr>` : ""}
            ${orderId ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Commande</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${orderId}</td></tr>` : ""}
          </table>

          <div style="background: #fef3c7; border-left: 4px solid #d97706; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <strong>Raison du flag :</strong><br>
            <span style="color: #92400e;">${reviewReason}</span>
          </div>

          <h3 style="margin-top: 24px; color: #1f2937;">⚡ Procédure de release</h3>
          <ol style="line-height: 1.8;">
            <li>Inspecter le contenu :<br><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">npx tsx scripts/dump-game.ts ${slug}</code></li>
            <li>Si correction nécessaire :<br><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">npx tsx scripts/edit-step.ts &lt;step-id&gt; &lt;field&gt; "&lt;value&gt;"</code></li>
            <li>Re-pré-générer audios après éditions :<br><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">npx tsx scripts/republish-game.ts ${slug} --language=fr</code></li>
            <li>Lever le flag pour libérer l'envoi du code :<br><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">npx tsx scripts/release-game.ts ${slug}</code></li>
          </ol>

          <p style="background: #fee2e2; border: 1px solid #ef4444; border-radius: 8px; padding: 12px; margin-top: 24px;">
            <strong>⚠️ Côté oddballtrip :</strong> tant que <code>needs_review=true</code> en DB
            escape-game, oddballtrip retient l'envoi du code activation au client.
            Le client ne reçoit RIEN tant que le flag n'est pas levé.
          </p>

          <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">
            Timestamp: ${new Date().toISOString()}<br>
            Escape Game Pipeline — sanity-check post-discovery
          </p>
        </div>
      `,
    });
    console.log(`[Email] needs_review alert sent to ${to.join(", ")} for slug=${slug}`);
  } catch (err) {
    console.error(`[Email] Failed to send needs_review alert: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Send alert when code generation fails after a purchase
 */
export async function sendCodeGenerationFailureAlert(params: {
  gameId: string;
  gameCity: string;
  buyerEmail: string;
  error: string;
  orderId?: string;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { gameId, gameCity, buyerEmail, error, orderId } = params;

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `⚠️ Code non généré — ${gameCity} pour ${buyerEmail}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">🎫 Échec de génération de code</h2>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Game ID</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code>${gameId}</code></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Ville</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${gameCity}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Email client</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${buyerEmail}">${buyerEmail}</a></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Erreur</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626;">${error}</td></tr>
            ${orderId ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Commande</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${orderId}</td></tr>` : ""}
          </table>

          <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 16px 0;">
            <strong>⚡ Action requise :</strong> Générer un code manuellement pour ce client et l'envoyer à <strong>${buyerEmail}</strong>.
          </div>

          <p style="color: #6b7280; font-size: 12px;">
            Timestamp: ${new Date().toISOString()}<br>
            Escape Game Pipeline — alerte automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Code failure alert sent to ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error(`[Email] Failed to send alert: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Suivi opérationnel (2026-07-07) — alerte à CHAQUE déclenchement de la
 * pipeline, pour tracer l'activité multi-revendeurs :
 *   - kind="game_build"      : un nouveau jeu part en génération
 *   - kind="code_generation" : un code d'activation est créé pour un jeu existant
 *
 * Envoi best-effort vers l'admin. N'échoue JAMAIS l'appelant (try/catch interne,
 * client null si RESEND_API_KEY absent). À placer sur les points d'entrée, pas
 * dans une boucle — un email par déclenchement.
 */
export async function sendPipelineTriggerAlert(params: {
  kind: "game_build" | "code_generation";
  gameCity: string;
  gameTitle?: string | null;
  slug?: string | null;
  language?: string | null;
  buyerEmail?: string | null;
  teamName?: string | null;
  orderId?: string | null;
  /** Point de vente / origine : host du callbackUrl, referer, ou "Backoffice". */
  source?: string | null;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { kind, gameCity, gameTitle, slug, language, buyerEmail, teamName, orderId, source } = params;
  const isBuild = kind === "game_build";
  const emoji = isBuild ? "🏗️" : "🎫";
  const label = isBuild ? "Nouveau jeu en génération" : "Code d'activation généré";
  const subject = isBuild
    ? `${emoji} Pipeline — nouveau jeu : ${gameCity}${source ? ` (${source})` : ""}`
    : `${emoji} Code généré — ${gameCity}${language ? ` [${language.toUpperCase()}]` : ""}${buyerEmail ? ` → ${buyerEmail}` : ""}`;

  const row = (k: string, v?: string | null) =>
    v
      ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${k}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${v}</td></tr>`
      : "";

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color:${isBuild ? "#2563eb" : "#059669"};">${emoji} ${label}</h2>
          <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            ${row("Ville", gameCity)}
            ${row("Jeu", gameTitle || undefined)}
            ${row("Slug", slug || undefined)}
            ${row("Langue", language ? language.toUpperCase() : undefined)}
            ${row("Point de vente", source || undefined)}
            ${row("Client", buyerEmail ? `<a href="mailto:${buyerEmail}">${buyerEmail}</a>` : undefined)}
            ${row("Équipe", teamName || undefined)}
            ${row("Commande", orderId || undefined)}
          </table>
          <p style="color:#6b7280; font-size:12px;">
            Timestamp: ${new Date().toISOString()}<br>
            Escape Game Pipeline — suivi automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Pipeline trigger alert (${kind}) sent to ${ADMIN_EMAIL} — ${gameCity}`);
  } catch (err) {
    console.error(`[Email] Failed to send trigger alert: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Suivi joueur (2026-07-09) — email dès qu'un joueur ACTIVE son code (création
 * de session côté /api/activate). Permet de suivre en direct qui commence à
 * jouer. Best-effort, ne fait jamais échouer l'activation.
 */
export async function sendPlayerStartAlert(params: {
  gameCity: string;
  gameTitle?: string | null;
  playerName?: string | null;
  teamName?: string | null;
  code?: string | null;
  sessionId?: string | null;
  totalSteps?: number | null;
  buyerEmail?: string | null;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { gameCity, gameTitle, playerName, teamName, code, sessionId, totalSteps, buyerEmail } = params;
  const who = playerName || teamName || "Joueur";
  const row = (k: string, v?: string | null) =>
    v
      ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${k}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${v}</td></tr>`
      : "";

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🎮 Partie démarrée — ${gameCity} — ${who}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color:#7c3aed;">🎮 Un joueur vient d'activer son code</h2>
          <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            ${row("Ville", gameCity)}
            ${row("Jeu", gameTitle || undefined)}
            ${row("Joueur", playerName || undefined)}
            ${row("Équipe", teamName || undefined)}
            ${row("Code", code || undefined)}
            ${row("Étapes", totalSteps != null ? String(totalSteps) : undefined)}
            ${row("Acheteur", buyerEmail ? `<a href="mailto:${buyerEmail}">${buyerEmail}</a>` : undefined)}
            ${row("Session", sessionId || undefined)}
          </table>
          <p style="color:#6b7280; font-size:12px;">
            Timestamp: ${new Date().toISOString()}<br>
            Escape Game — suivi joueur automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Player start alert sent to ${ADMIN_EMAIL} — ${gameCity} / ${who}`);
  } catch (err) {
    console.error(`[Email] Failed to send player start alert: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Escalade support (2026-07-19) — un joueur envoie une demande d'aide DEPUIS le
 * jeu (bouton « Besoin d'aide ? »). Le message est déjà en DB (support_messages),
 * cet email prévient l'admin en direct pour qu'il prenne le relais. Best-effort,
 * ne fait jamais échouer l'envoi côté joueur.
 */
export async function sendPlayerHelpRequest(params: {
  sessionId: string;
  gameCity: string;
  gameTitle?: string | null;
  playerName?: string | null;
  currentStep?: number | null;
  totalSteps?: number | null;
  question: string;
  /** Lien direct vers la session live du back-office pour répondre. */
  adminUrl: string;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { sessionId, gameCity, gameTitle, playerName, currentStep, totalSteps, question, adminUrl } = params;
  const who = playerName || "Joueur";
  const stepLabel =
    currentStep != null ? `${currentStep}${totalSteps != null ? `/${totalSteps}` : ""}` : undefined;
  const row = (k: string, v?: string | null) =>
    v
      ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${k}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${v}</td></tr>`
      : "";

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      // reply_to l'admin lui-même n'a pas de sens ; on met l'URL admin dans le corps.
      subject: `🆘 Demande d'aide en jeu — ${gameCity} — ${who}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color:#dc2626;">🆘 Un joueur demande de l'aide</h2>
          <div style="background:#fef2f2; border-left:4px solid #dc2626; padding:12px 16px; margin:16px 0; border-radius:4px;">
            <span style="color:#7f1d1d; white-space:pre-wrap;">${question.replace(/</g, "&lt;")}</span>
          </div>
          <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            ${row("Ville", gameCity)}
            ${row("Jeu", gameTitle || undefined)}
            ${row("Joueur", playerName || undefined)}
            ${row("Étape", stepLabel)}
            ${row("Session", sessionId)}
          </table>
          <p style="margin:20px 0;">
            <a href="${adminUrl}" style="display:inline-block; background:#dc2626; color:#fff; text-decoration:none; padding:10px 20px; border-radius:8px; font-weight:600;">
              ➡️ Répondre depuis la session live
            </a>
          </p>
          <p style="color:#6b7280; font-size:12px;">
            Le message est déjà dans le fil support de la session. Ta réponse depuis
            le back-office s'affiche en direct côté joueur.<br>
            Timestamp: ${new Date().toISOString()} — Escape Game, escalade support automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Player help request sent to ${ADMIN_EMAIL} — ${gameCity} / ${who}`);
  } catch (err) {
    console.error(`[Email] Failed to send player help request: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Avis bas (2026-07-20) — un joueur a laissé une note ≤3★ en fin de partie.
 * L'avis reste PRIVÉ (jamais publié). Cet email permet à l'admin de rappeler
 * le client pour rattraper l'expérience (service recovery). Best-effort.
 */
export async function sendLowReviewAlert(params: {
  gameCity: string;
  gameTitle?: string | null;
  playerName?: string | null;
  rating: number;
  text?: string | null;
  brandName?: string | null;
  adminUrl: string;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { gameCity, gameTitle, playerName, rating, text, brandName, adminUrl } = params;
  const who = playerName || "Joueur";
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  const row = (k: string, v?: string | null) =>
    v
      ? `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:600;">${k}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;">${v}</td></tr>`
      : "";

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `⭐ Avis ${rating}/5 à rattraper — ${gameCity} — ${who}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color:#d97706;">⭐ Avis bas reçu (${stars}) — privé, à rattraper</h2>
          ${text ? `<div style="background:#fffbeb; border-left:4px solid #d97706; padding:12px 16px; margin:16px 0; border-radius:4px;"><span style="color:#78350f; white-space:pre-wrap;">${text.replace(/</g, "&lt;")}</span></div>` : `<p style="color:#6b7280;">(Pas de commentaire texte.)</p>`}
          <table style="width:100%; border-collapse:collapse; margin:16px 0;">
            ${row("Note", `${rating}/5`)}
            ${row("Ville", gameCity)}
            ${row("Jeu", gameTitle || undefined)}
            ${row("Joueur", playerName || undefined)}
            ${row("Marque", brandName || undefined)}
          </table>
          <p style="margin:20px 0;">
            <a href="${adminUrl}" style="display:inline-block; background:#d97706; color:#fff; text-decoration:none; padding:10px 20px; border-radius:8px; font-weight:600;">
              ➡️ Gérer les avis
            </a>
          </p>
          <p style="color:#6b7280; font-size:12px;">
            Cet avis n'est PAS publié (seuls les 4-5★ apparaissent en public).<br>
            Timestamp: ${new Date().toISOString()} — Escape Game, alerte avis automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Low review alert sent to ${ADMIN_EMAIL} — ${gameCity} / ${who} (${rating}/5)`);
  } catch (err) {
    console.error(`[Email] Failed to send low review alert: ${err instanceof Error ? err.message : err}`);
  }
}
