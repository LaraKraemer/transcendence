"use server";

/**
 * Profile server actions: the display name (`PATCH /auth/me`) and the photo
 * (`PUT`/`DELETE /auth/me/avatar`). Each refreshes the route, so the profile
 * header and the app shell re-render with the new user.
 */
import { refresh } from "next/cache";
import { z } from "zod";

import { backendFailure } from "@/lib/action-errors";
import { fetchApiServer } from "@/lib/dal";
import type { ActionResponse, User } from "@/lib/types";
import { MAX_DISPLAY_NAME_LENGTH, type ValidationErrorCode } from "@/lib/validation";

const UpdateNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { error: "displayNameRequired" satisfies ValidationErrorCode })
    .max(MAX_DISPLAY_NAME_LENGTH, { error: "displayNameTooLong" satisfies ValidationErrorCode }),
});

/** Validates the name and saves it with `PATCH /auth/me`. */
export async function updateDisplayName(displayName: string): Promise<ActionResponse> {
  const parsed = UpdateNameSchema.safeParse({ displayName: String(displayName) });
  if (!parsed.success) {
    return {
      success: false,
      message: "Validation failed",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await fetchApiServer<{ user: User }>("/auth/me", { method: "PATCH", body: JSON.stringify(parsed.data) });
  } catch (error) {
    return backendFailure(error, "updateDisplayName");
  }

  refresh();
  return { success: true, message: "Name saved" };
}

/**
 * Sends `formData.photo` as the raw body of `PUT /auth/me/avatar`. The backend
 * checks the type and size itself and answers 415 or 413.
 */
export async function uploadAvatar(formData: FormData): Promise<ActionResponse> {
  const photo = formData.get("photo");
  if (!(photo instanceof File)) return { success: false, message: "photo must be a file", status: 400 };

  try {
    await fetchApiServer("/auth/me/avatar", {
      method: "PUT",
      body: photo,
      headers: { "Content-Type": photo.type },
    });
  } catch (error) {
    return backendFailure(error, "uploadAvatar");
  }

  refresh();
  return { success: true, message: "Photo updated" };
}

/** Removes the photo with `DELETE /auth/me/avatar`. */
export async function deleteAvatar(): Promise<ActionResponse> {
  try {
    await fetchApiServer("/auth/me/avatar", { method: "DELETE" });
  } catch (error) {
    return backendFailure(error, "deleteAvatar");
  }

  refresh();
  return { success: true, message: "Photo removed" };
}
