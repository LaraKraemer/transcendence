import type { ReactNode } from "react";

/** A labelled group of choices (radios or checkboxes) with an inline error, like TextField's. */
export function ChoiceGroup({
  legend,
  error,
  idPrefix,
  children,
}: {
  legend: string;
  error?: string;
  idPrefix: string;
  children: ReactNode;
}) {
  const errorId = `${idPrefix}-error`;
  return (
    <fieldset className="mb-[18px]" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-[7px] text-[13px] font-semibold">{legend}</legend>
      {children}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
