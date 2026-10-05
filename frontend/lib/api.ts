/**
 * Typed client for the Express backend.
 *
 * Every backend call goes through `fetchApi`, which centralises the base URL,
 * cookie credentials, JSON headers, error parsing, and empty-body handling.
 */

/** Error thrown for non-2xx responses, carrying the HTTP status code. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Calls the backend and returns the parsed JSON body typed as `T`.
 *
 * - Prepends the backend base URL: `API_URL` (server-side/internal) falls back
 *   to `NEXT_PUBLIC_API_URL` (browser-facing). See frontend/.env.example.
 * - Sends cookies on every request (`credentials: "include"`). This only has an
 *   effect in the browser; on the server there is no cookie jar, so server code
 *   must forward the session cookie itself (see `fetchApiServer` in lib/dal.ts).
 * - Sets `Content-Type: application/json` only for string (JSON) bodies, so
 *   `FormData`/`Blob` bodies keep the content type `fetch` derives for them and
 *   body-less requests don't trigger a CORS preflight.
 * - On a non-2xx response, reads `{ error }` from the JSON body and throws an
 *   `ApiError` with that message and the HTTP status.
 * - Returns `undefined` for `204 No Content`.
 *
 * @throws {ApiError} when the response status is not 2xx.
 */
export async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

  const headers = new Headers(init?.headers);
  if (typeof init?.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${base}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }

  // 204 No Content has no body to parse.
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}
