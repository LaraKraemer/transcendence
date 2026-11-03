const toneClasses = {
  danger: { bar: "bg-destructive", text: "text-destructive" },
  success: { bar: "bg-success", text: "text-success" },
};

/**
 * A segmented bar with a label under it, e.g. a password's strength: the first `score` of
 * `segments` are filled. The bar is decorative; the label is a polite live region, so screen
 * readers hear it change.
 */
export function StrengthMeter({
  score,
  segments = 3,
  label,
  tone,
}: {
  score: number;
  segments?: number;
  label: string;
  tone: keyof typeof toneClasses;
}) {
  const { bar, text } = toneClasses[tone];
  return (
    <div aria-live="polite">
      <div className="mt-2.5 mb-1.5 flex gap-1.5" aria-hidden>
        {Array.from({ length: segments }, (_, index) => (
          <span key={index} className={`h-1 flex-1 rounded-[3px] ${index < score ? bar : "bg-border"}`} />
        ))}
      </div>
      <div className={`text-xs font-semibold ${text}`}>{label}</div>
    </div>
  );
}
