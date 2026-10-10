import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "success" | "outline" | "destructive";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-primary py-3.5 text-[15px] text-primary-foreground",
  success: "border-transparent bg-success py-3.5 text-[15px] text-white",
  outline: "border-border bg-card py-[13px] text-sm text-foreground",
  destructive: "border-transparent bg-destructive py-[13px] text-sm text-white dark:text-background",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/** Full-width action button using the design's theme tokens. */
export function Button({ variant = "primary", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-[11px] border font-semibold transition-opacity ${variant === "destructive" ? "hover:brightness-95" : "hover:opacity-90"} focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
