"use client";

import ErrorPage, { type ErrorPageProps } from "@/app/error";

/** An error in a protected page: the error page inside the app shell. */
export default function ProtectedError(props: ErrorPageProps) {
  return <ErrorPage {...props} inAppShell />;
}
