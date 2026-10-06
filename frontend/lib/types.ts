/**
 * Shared frontend types.
 *
 * Single source of truth for the authenticated user and the shape returned by
 * the auth server actions. Imported by the API client, the DAL, the server
 * actions, and the auth context.
 */

/** The authenticated user, as exposed to the UI (a safe subset of the backend row). */
export type User = {
  id: string;
  email: string;
  displayName: string;
};

/**
 * Standard result returned by the auth server actions.
 *
 * - `success` — whether the action completed.
 * - `message` — human-readable summary for the UI.
 * - `errors` — per-field validation messages, keyed by field name (from Zod).
 * - `user` — the authenticated user on a successful login/register.
 */
export type ActionResponse = {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
  user?: User;
};
