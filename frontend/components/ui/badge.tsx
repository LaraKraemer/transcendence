import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

/** Background and text colour of each tone, also for icon tiles that match a badge. */
export const badgeToneClassName: Record<BadgeTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-accent text-primary dark:text-accent-foreground",
  success: "bg-success-bg text-success",
  // E.g. "Archived": set aside, not an error.
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger: "bg-danger-bg text-destructive",
};

const variantClasses = {
  // A short uppercase status next to a name, e.g. an account's type or "Archived".
  label: "rounded-full px-2 py-0.5 text-overline uppercase",
  // A sentence-case value with an optional icon, e.g. the change against last month.
  pill: "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
};

/** A small coloured status. The text must make sense on its own: the colour only repeats it. */
export function Badge({
  tone = "neutral",
  variant = "label",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  variant?: keyof typeof variantClasses;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`${variantClasses[variant]} ${badgeToneClassName[tone]} ${className}`}>{children}</span>;
}
