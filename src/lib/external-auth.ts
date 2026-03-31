import { createHmac, randomBytes } from "crypto";
import { NextRequest } from "next/server";

function getApiSecret() {
  return process.env.EXTERNAL_API_SECRET;
}

// Charset without ambiguous characters (no 0/O, 1/I/l)
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * CORS headers for cross-origin requests from oddballtrip.com
 */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "https://oddballtrip.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * Validate the Bearer token from the Authorization header
 * against the EXTERNAL_API_SECRET environment variable.
 */
export function validateApiKey(request: NextRequest): boolean {
  const secret = getApiSecret();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  return token === secret;
}

/**
 * Generate an HMAC-based activation code.
 *
 * Format: CCCC-RRRR-HHHH (all uppercase)
 *   CCCC = first 4 chars of the city name (uppercased, padded with X if shorter)
 *   RRRR = 4 random alphanumeric characters
 *   HHHH = last 4 chars of HMAC-SHA256 checksum (mapped to charset)
 */
export function generateActivationCode(cityPrefix: string): string {
  // Take first 4 chars of city, uppercase, pad with X if needed
  const prefix = cityPrefix
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .padEnd(4, "X")
    .slice(0, 4);

  // Generate 4 random alphanumeric characters
  const bytes = randomBytes(4);
  let random = "";
  for (let i = 0; i < 4; i++) {
    random += CHARSET[bytes[i] % CHARSET.length];
  }

  // Compute HMAC-SHA256 of prefix + random
  const payload = prefix + random;
  const hmac = createHmac("sha256", getApiSecret() || "fallback")
    .update(payload)
    .digest("hex");

  // Map last 4 hex pairs to charset characters
  const hmacLen = hmac.length;
  let checksum = "";
  for (let i = 0; i < 4; i++) {
    const idx =
      parseInt(hmac.substring(hmacLen - (i + 1) * 2, hmacLen - i * 2), 16) %
      CHARSET.length;
    checksum += CHARSET[idx];
  }

  return `${prefix}-${random}-${checksum}`;
}
