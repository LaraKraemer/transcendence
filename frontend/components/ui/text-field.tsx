import type { InputHTMLAttributes, ReactNode } from "react";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> & {
  id: string;
  label: string;
  /** Inline validation message; marks the input invalid and links it via aria-describedby. */
  error?: string;
  /** Instructions shown below the input before any error, e.g. a minimum length. */
  hint?: string;
  /** Rendered inside the input box, after the input (e.g. a visibility icon). */
  trailing?: ReactNode;
  /** Rendered between the input and the error message (e.g. a strength meter). */
  children?: ReactNode;
};

export function TextField({ id, label, error, hint, trailing, children, ...inputProps }: TextFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="mb-[18px]">
      <label htmlFor={id} className="mb-[7px] block text-[13px] font-semibold">
        {label}
      </label>
      <div
        className={`flex items-center rounded-[11px] border bg-field transition-colors focus-within:ring-2 focus-within:ring-ring ${
          error ? "border-destructive" : "border-input"
        }`}
      >
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full min-w-0 bg-transparent px-[15px] py-[13px] text-sm outline-none placeholder:text-muted-foreground disabled:opacity-70 ${
            inputProps.dir === "ltr" ? "rtl:text-right" : ""
          }`}
          {...inputProps}
        />
        {trailing && <div className="flex shrink-0 items-center pe-[13px]">{trailing}</div>}
      </div>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
