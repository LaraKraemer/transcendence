import type { ComponentProps } from "react";

const variantClasses = {
  // Filled, for the main action of a page or a destructive one.
  primary:
    "bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  success:
    "bg-success-bg text-success hover:bg-success hover:text-white dark:hover:text-background focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  danger: "bg-danger-bg text-destructive hover:bg-destructive hover:text-white focus-visible:ring-offset-2 focus-visible:ring-offset-card",
  // Quiet row actions on a card. The hover colour tells what the action does.
  muted: "bg-muted text-muted-foreground hover:text-foreground",
  "muted-danger": "bg-muted text-muted-foreground hover:text-destructive",
  "muted-warning":
    "bg-muted text-muted-foreground hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-950 dark:hover:text-amber-200",
  // The same on a muted surface, e.g. a category tile.
  card: "bg-card text-muted-foreground hover:text-foreground",
  "card-danger": "bg-card text-muted-foreground hover:text-destructive",
  // No background until hovered, e.g. closing a notice.
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  // Only the icon, e.g. inside a text field.
  plain: "text-muted-foreground hover:text-foreground",
  // Bordered, in headers next to other controls.
  outline: "border border-border bg-card text-foreground hover:opacity-80",
  "outline-danger": "border border-border bg-card text-destructive hover:bg-danger-bg",
};

const sizeClasses = {
  inline: "",
  sm: "size-8 rounded-[9px]",
  md: "size-9 rounded-[8px]",
  lg: "size-10 rounded-[10px]",
  xl: "size-[42px] rounded-[11px]",
  fab: "size-14 rounded-full shadow-[0_8px_24px_rgba(8,14,25,.35)]",
};

export type IconButtonVariant = keyof typeof variantClasses;
export type IconButtonSize = keyof typeof sizeClasses;

// ComponentProps includes `ref` (a plain prop in React 19), so callers can focus the button.
export type IconButtonProps = Omit<ComponentProps<"button">, "aria-label" | "title"> & {
  /** The accessible name and the tooltip: the button shows only an icon. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
};

/** A button that shows only an icon (`children`, marked `aria-hidden`), named by `label`. */
export function IconButton({ label, variant = "muted", size = "sm", type = "button", className = "", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`flex shrink-0 cursor-pointer items-center justify-center transition focus-ring disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
