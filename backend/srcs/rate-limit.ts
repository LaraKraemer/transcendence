import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { RequestHandler } from "express";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MESSAGE = { error: "Too many requests, please try again later." };

/** Reads a positive request limit from the environment or uses its default. */
function configuredLimit(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return limit;
}

/** Limits register and login requests together by client IP. */
export function createAuthRateLimiter(limit = configuredLimit("AUTH_RATE_LIMIT_MAX", 100)): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: MESSAGE,
  });
}

/** Limits login attempts by client IP and normalized email. */
export function createLoginRateLimiter(limit = configuredLimit("LOGIN_RATE_LIMIT_MAX", 10)): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: MESSAGE,
    keyGenerator: (req) => {
      if (!req.ip) throw new Error("Request IP is unavailable for login rate limiting");
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      return JSON.stringify([ipKeyGenerator(req.ip), email]);
    },
  });
}
