"use client";

import { ErrorStatus, type ErrorStatusProps } from "@/components/status-page";

/**
 * Errors in login, register and the protected layout itself (an error.tsx doesn't cover the
 * layout in its own folder), so there's no app shell. (protected)/error.tsx covers the pages.
 */
export default function RootError(props: ErrorStatusProps) {
  return <ErrorStatus {...props} standalone />;
}
