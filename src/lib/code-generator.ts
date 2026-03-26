import { createHmac } from "crypto";

// Charset without ambiguous characters (no 0/O, 1/I/l)
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Secret key for HMAC - must match between escape-game and fun-zone
const CODE_SECRET = process.env.CODE_HMAC_SECRET || "EG-TF-2026-X9kPm3vR";

/**
 * Game prefix mapping (2 chars) - identifies which game a code is for.
 * This is part of the "hidden logic" - the first 2 chars encode the game.
 */
const GAME_PREFIXES: Record<string, string> = {
  "11111111-1111-1111-1111-111111111111": "KC", // Kode + Cristianos
  "22222222-2222-2222-2222-222222222222": "TL", // Tres + Laguna
  "33333333-3333-3333-3333-333333333333": "BP", // Butin + Puerto
  "44444444-4444-4444-4444-444444444444": "CG", // Cendres + Garachico
};

const PREFIX_TO_GAME: Record<string, string> = Object.fromEntries(
  Object.entries(GAME_PREFIXES).map(([k, v]) => [v, k])
);

function randomChar(): string {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)];
}

/**
 * Generate HMAC checksum (last 4 chars) from the first 8 chars of code.
 * This is the "secret logic" - impossible to guess without the key.
 */
function computeChecksum(payload: string): string {
  const hmac = createHmac("sha256", CODE_SECRET)
    .update(payload)
    .digest("hex");
  // Convert hex to our charset (4 chars)
  let checksum = "";
  for (let i = 0; i < 4; i++) {
    const idx = parseInt(hmac.substring(i * 2, i * 2 + 2), 16) % CHARSET.length;
    checksum += CHARSET[idx];
  }
  return checksum;
}

/**
 * Generate a cryptographically signed activation code.
 * Format: PPRR-RRRR-CCCC
 *   PP = game prefix (2 chars, identifies the game)
 *   RRRRRR = random payload (6 chars)
 *   CCCC = HMAC checksum of the first 8 chars
 */
export function generateSignedCode(gameId: string): string {
  const prefix = GAME_PREFIXES[gameId];
  if (!prefix) throw new Error(`Unknown game ID: ${gameId}`);

  // Generate 6 random chars
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += randomChar();
  }

  const payload = prefix + random; // 8 chars
  const checksum = computeChecksum(payload); // 4 chars

  // Format: PPRR-RRRR-CCCC
  const raw = payload + checksum; // 12 chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/**
 * Verify that a code has a valid HMAC signature.
 * Returns the gameId if valid, null if the code is forged.
 */
export function verifyCodeSignature(code: string): string | null {
  const clean = code.replace(/-/g, "").toUpperCase();
  if (clean.length !== 12) return null;

  const payload = clean.slice(0, 8);
  const checksum = clean.slice(8, 12);
  const expectedChecksum = computeChecksum(payload);

  if (checksum !== expectedChecksum) return null;

  // Extract game prefix
  const prefix = clean.slice(0, 2);
  return PREFIX_TO_GAME[prefix] || null;
}

/**
 * Generate multiple unique signed codes for a game.
 */
export function generateSignedCodes(gameId: string, count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateSignedCode(gameId));
  }
  return Array.from(codes);
}

// --- Legacy functions (kept for backward compatibility) ---

/**
 * Generate a single activation code in format XXXX-XXXX-XXXX.
 * @deprecated Use generateSignedCode(gameId) instead
 */
export function generateCode(): string {
  const parts: string[] = [];
  for (let p = 0; p < 3; p++) {
    let segment = "";
    for (let i = 0; i < 4; i++) {
      segment += randomChar();
    }
    parts.push(segment);
  }
  return parts.join("-");
}

/**
 * Generate multiple unique activation codes.
 * @deprecated Use generateSignedCodes(gameId, count) instead
 */
export function generateCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateCode());
  }
  return Array.from(codes);
}

/**
 * Validate activation code format.
 */
export function isValidCodeFormat(code: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(code.trim());
}
