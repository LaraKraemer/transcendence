import { afterEach, describe, expect, it, vi } from "vitest";

import {
  base32Decode,
  base32Encode,
  currentStep,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  isTwoFactorConfigured,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "../srcs/totp.ts";

// RFC 6238 Appendix B secret for HMAC-SHA1.
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

afterEach(() => vi.unstubAllEnvs());

describe("totpCode", () => {
  // RFC 6238 Appendix B, SHA-1 column: [time in seconds, 8-digit code].
  it.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])("matches the RFC 6238 vector at T=%i", (seconds, expected) => {
    expect(totpCode(rfcSecret, currentStep(seconds * 1000), 8)).toBe(expected);
  });

  it("is the last 6 digits of the 8-digit vector", () => {
    expect(totpCode(rfcSecret, currentStep(59_000))).toBe("287082");
  });
});

describe("verifyTotp", () => {
  const now = 1_111_111_109_000;
  const step = currentStep(now);

  it("accepts the current step and one step either side", () => {
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step + offset), null, now)).toBe(step + offset);
    }
  });

  it("rejects two steps away, wrong codes and malformed input", () => {
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step + 2), null, now)).toBeUndefined();
    expect(verifyTotp(rfcSecret, totpCode(rfcSecret, step - 2), null, now)).toBeUndefined();
    expect(verifyTotp(rfcSecret, "000000", null, now)).toBeUndefined();
    expect(verifyTotp(rfcSecret, "12345", null, now)).toBeUndefined();
    expect(verifyTotp(rfcSecret, "abcdef", null, now)).toBeUndefined();
  });

  it("rejects a step that was already used (replay) but accepts a newer one", () => {
    const code = totpCode(rfcSecret, step);
    expect(verifyTotp(rfcSecret, code, step, now)).toBeUndefined();
    expect(verifyTotp(rfcSecret, code, step + 1, now)).toBeUndefined();
    expect(verifyTotp(rfcSecret, code, step - 1, now)).toBe(step);
  });
});

describe("base32", () => {
  it("round trips and matches RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    const secret = generateSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
  });
});

describe("otpauthUri", () => {
  it("carries the secret, issuer and an escaped label", () => {
    expect(otpauthUri("ABC", "a+b@example.com")).toBe(
      "otpauth://totp/Expense%20Tracker%3Aa%2Bb%40example.com?secret=ABC&issuer=Expense%20Tracker",
    );
  });
});

describe("secret encryption", () => {
  const key = Buffer.alloc(32, 7).toString("base64");

  it("round trips and uses a fresh IV each time", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", key);
    const first = encryptSecret("SECRET");
    expect(first).not.toContain("SECRET");
    expect(decryptSecret(first)).toBe("SECRET");
    expect(encryptSecret("SECRET")).not.toBe(first);
  });

  it("rejects a tampered value or a different key", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", key);
    const [iv, tag, ciphertext] = encryptSecret("SECRET").split(".") as [string, string, string];
    expect(() => decryptSecret(`${iv}.${tag}.${Buffer.from("x").toString("base64url")}`)).toThrow();
    const stored = [iv, tag, ciphertext].join(".");
    vi.stubEnv("TOTP_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("is unavailable without a key and throws for a malformed one", () => {
    vi.stubEnv("TOTP_ENCRYPTION_KEY", "");
    expect(isTwoFactorConfigured()).toBe(false);
    expect(() => encryptSecret("SECRET")).toThrow(/TOTP_ENCRYPTION_KEY must be set/);
    vi.stubEnv("TOTP_ENCRYPTION_KEY", "too-short");
    expect(() => isTwoFactorConfigured()).toThrow(/32 bytes/);
  });
});

describe("recovery codes", () => {
  it("creates 10 distinct XXXXX-XXXXX codes whose hash ignores case, dash and spaces", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
    const [code = ""] = codes;
    expect(hashRecoveryCode(code.toLowerCase().replace("-", " "))).toBe(hashRecoveryCode(code));
  });
});
