import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
// Codes from the previous and next step are accepted to absorb clock drift.
const TOTP_WINDOW_STEPS = 1;
const TOTP_SECRET_BYTES = 20;
const ISSUER = "Expense Tracker";
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 6;
const ENCRYPTION_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;

/** Encodes bytes as unpadded RFC 4648 base32, the format authenticator apps expect. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decodes unpadded base32; characters outside the alphabet are ignored. */
export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of text.toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Creates a random base32 TOTP secret (160 bits, the RFC 4226 recommendation). */
export function generateSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** The 30-second step number that contains the given time. */
export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** RFC 6238 code (HMAC-SHA1, RFC 4226 dynamic truncation) for one step. */
export function totpCode(secret: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Returns the step whose code matches, or undefined. Steps up to `lastUsedStep` are skipped
 * so a code can be used only once (replay protection).
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastUsedStep: number | null,
  now = Date.now(),
): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const step = currentStep(now);
  let matchedStep: number | undefined;
  // Check every step without stopping early so timing does not reveal which one matched.
  for (let candidate = step - TOTP_WINDOW_STEPS; candidate <= step + TOTP_WINDOW_STEPS; candidate++) {
    const isMatch = timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(code));
    if (isMatch && (lastUsedStep === null || candidate > lastUsedStep)) matchedStep = candidate;
  }
  return matchedStep;
}

/** The `otpauth://` URI that authenticator apps read from a QR code. */
export function otpauthUri(secret: string, email: string): string {
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}`;
}

/** Reads TOTP_ENCRYPTION_KEY (32 bytes, base64). Undefined when unset; throws when malformed. */
function encryptionKey(): Buffer | undefined {
  const encoded = process.env.TOTP_ENCRYPTION_KEY;
  if (!encoded) return undefined;
  const key = Buffer.from(encoded, "base64");
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error("TOTP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
  }
  return key;
}

/** True when 2FA can be set up. Throws for a malformed key so a typo fails loudly. */
export function isTwoFactorConfigured(): boolean {
  return encryptionKey() !== undefined;
}

function requireKey(): Buffer {
  const key = encryptionKey();
  if (!key) throw new Error("TOTP_ENCRYPTION_KEY must be set to use two-factor authentication");
  return key;
}

// ponytail: one fixed key with no key id, so rotating TOTP_ENCRYPTION_KEY invalidates every stored secret.
// Upgrade path: prefix the stored value with a key id and keep old keys for decryption.
/** Encrypts a TOTP secret with AES-256-GCM; the result is `iv.tag.ciphertext` in base64url. */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

/** Decrypts a value from `encryptSecret`; throws if it was tampered with or the key changed. */
export function decryptSecret(stored: string): string {
  const [iv, tag, ciphertext] = stored.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !ciphertext) throw new Error("Malformed encrypted TOTP secret");
  const decipher = createDecipheriv("aes-256-gcm", requireKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Creates the plaintext recovery codes, formatted `XXXXX-XXXXX`. */
export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const code = base32Encode(randomBytes(RECOVERY_CODE_BYTES)).slice(0, 10);
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/**
 * Hashes a recovery code for storage and lookup. The input is normalised so users may type it
 * in lowercase, with or without the dash. The codes are random, so SHA-256 is enough (no bcrypt).
 */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}
