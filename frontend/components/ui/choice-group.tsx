import type { ReactNode } from "react";

// The segmented look of the choices: wrap the <label>s in a div with choiceSegmentsClassName,
// give each input `peer sr-only` and the text <span> after it choiceSegmentClassName.
export const choiceSegmentsClassName = "flex gap-1 rounded-[11px] border border-border bg-muted p-1";
export const choiceSegmentClassName =
  "block cursor-pointer rounded-[8px] px-2 py-1.5 text-center text-[13px] font-medium text-muted-foreground peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

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
      <legend className="mb-[7px] text-label">{legend}</legend>
      {children}
      {error && (
        <p id={errorId} className="mt-1.5 text-caption font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
