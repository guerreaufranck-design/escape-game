// Charset without ambiguous characters (no 0/O, 1/I/l)
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomChar(): string {
  return CHARSET[Math.floor(Math.random() * CHARSET.length)];
}

/**
 * Generate a single activation code in format XXXX-XXXX-XXXX.
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
