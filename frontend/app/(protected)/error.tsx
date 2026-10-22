"use client";

import { ErrorStatus, type ErrorStatusProps } from "@/components/status-page";

/** An error in a protected page: the error page inside the app shell. */
export default function ProtectedError(props: ErrorStatusProps) {
  return <ErrorStatus {...props} standalone={false} />;
}
