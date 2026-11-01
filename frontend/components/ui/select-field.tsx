import { ChevronDown } from "lucide-react";
import type { ReactNode, SelectHTMLAttributes } from "react";

/** A native <select> styled like TextField, with its label, an optional hint and inline error. Required unless `required={false}`. */
export function SelectField({
  id,
  label,
  error,
  hint,
  children,
  ...selectProps
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="mb-[18px]">
      <label htmlFor={id} className="mb-[7px] block text-label">
        {label}
      </label>
      {/* The native arrow can't be spaced from the edge, so it's hidden and drawn
          as an icon at the input's own inline padding (mirrors in RTL). */}
      <div className="relative">
        <select
          id={id}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full cursor-pointer appearance-none rounded-[11px] border bg-field py-[13px] ps-[15px] pe-10 text-sm outline-none focus:ring-2 focus:ring-ring ${
            error ? "border-destructive" : "border-input"
          }`}
          {...selectProps}
        >
          {children}
        </select>
        <ChevronDown
          size={16}
          aria-hidden
          className="pointer-events-none absolute end-[15px] top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-caption font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
