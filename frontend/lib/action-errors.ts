import { ApiError } from "@/lib/api";
import type { ActionResponse } from "@/lib/types";

/**
 * Turns a failed backend call in a server action into the action's error
 * response. No status means the request never reached the backend (see
 * formErrorFor in components/auth/form-parts.tsx). Kept outside the "use server"
 * files, which may only export async actions.
 */
export function backendFailure(error: unknown, action: string): ActionResponse {
  if (error instanceof ApiError) return { success: false, message: error.message, status: error.status };
  console.error(`${action}: request failed:`, error);
  return { success: false, message: "Could not reach the server. Please try again later." };
}
