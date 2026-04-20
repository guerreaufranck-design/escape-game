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
  durationSeconds?: number;
  buyerEmail?: string;
  orderId?: string;
}): Promise<void> {
  const client = getResendClient();
  if (!client) return;

  const { city, country, theme, slug, error, durationSeconds, buyerEmail, orderId } = params;

  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `⚠️ Pipeline échec — ${city} "${theme}"`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">🚨 Échec de génération de jeu</h2>

          <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Ville</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${city}, ${country}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Thème</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${theme}</td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Slug</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><code>${slug}</code></td></tr>
            <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Erreur</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626;">${error}</td></tr>
            ${durationSeconds ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Durée</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${durationSeconds}s</td></tr>` : ""}
            ${buyerEmail ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Email client</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${buyerEmail}">${buyerEmail}</a></td></tr>` : ""}
            ${orderId ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Commande</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${orderId}</td></tr>` : ""}
          </table>

          <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 12px; margin: 16px 0;">
            <strong>⚡ Action requise :</strong> Relancer la génération manuellement depuis l'admin OddballTrip${buyerEmail ? `, puis envoyer le code d'activation à <strong>${buyerEmail}</strong>` : ""}.
          </div>

          <p style="color: #6b7280; font-size: 12px;">
            Timestamp: ${new Date().toISOString()}<br>
            Escape Game Pipeline — alerte automatique
          </p>
        </div>
      `,
    });
    console.log(`[Email] Pipeline failure alert sent to ${ADMIN_EMAIL}`);
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
