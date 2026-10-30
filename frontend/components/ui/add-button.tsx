import { Plus } from "lucide-react";
import type { ComponentProps } from "react";

type AddButtonProps = Omit<ComponentProps<"button">, "children" | "aria-label" | "title" | "type"> & {
  label: string;
  variant?: "primary" | "success";
};

const variantClasses = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  success: "bg-success-bg text-success hover:bg-success hover:text-white dark:hover:text-background",
};

/** Compact add action with one translated label for its tooltip and accessible name. */
export function AddButton({ label, variant = "primary", className = "", ...props }: AddButtonProps) {
  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      title={label}
      className={`flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className}`}
    >
      <Plus size={18} aria-hidden />
    </button>
  );
}
