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
