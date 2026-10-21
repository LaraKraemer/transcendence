import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "success" | "outline" | "danger";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-primary py-3.5 text-[15px] text-primary-foreground",
  // White on the dark-mode green is only 2.28:1, so dark text there (8.48:1).
  success: "border-transparent bg-success py-3.5 text-[15px] text-white dark:text-background",
  outline: "border-border bg-card py-[13px] text-sm text-foreground",
  danger: "border-transparent bg-destructive py-3.5 text-[15px] text-white dark:bg-danger-bg dark:text-destructive",
};

// ComponentProps includes `ref` (a plain prop in React 19), so callers can focus the button.
type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
};

/** The button's classes, so a link that navigates can look like a button. */
export function buttonClassName(variant: ButtonVariant = "primary", className = ""): string {
  return `flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-[11px] border font-semibold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className}`;
}

/** Full-width action button in the design's four styles. */
export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, className)} {...props} />;
}
