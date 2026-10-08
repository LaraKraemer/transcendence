import type { InputHTMLAttributes, ReactNode } from "react";

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> & {
  id: string;
  label: string;
  /** Inline validation message; marks the input invalid and links it via aria-describedby. */
  error?: string;
  /** Rendered inside the input box, after the input (e.g. a visibility icon). */
  trailing?: ReactNode;
  /** Rendered between the input and the error message (e.g. a strength meter). */
  children?: ReactNode;
};

export function TextField({ id, label, error, trailing, children, ...inputProps }: TextFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="mb-[18px]">
      <label htmlFor={id} className="mb-[7px] block text-[13px] font-semibold">
        {label}
      </label>
      <div
        className={`flex items-center rounded-[11px] border bg-field transition-colors focus-within:ring-2 focus-within:ring-ring ${
          error ? "border-destructive" : "border-border"
        }`}
      >
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`w-full min-w-0 bg-transparent px-[15px] py-[13px] text-sm outline-none placeholder:text-muted-foreground disabled:opacity-70 ${
            inputProps.dir === "ltr" ? "rtl:text-right" : ""
          }`}
          {...inputProps}
        />
        {trailing && <div className="flex shrink-0 items-center pe-[13px]">{trailing}</div>}
      </div>
      {children}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
