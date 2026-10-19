import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** The heading's id, so the error pages can move focus to it. */
export const STATUS_HEADING_ID = "status-heading";

/**
 * Shared layout of the 404 and error pages: an icon, the page's only <h1>, a short
 * explanation, an optional reference code and the actions, centred in a card.
 *
 * `standalone` is for pages outside the app shell, which has the <main> landmark:
 * there the card brings its own <main>, so screen readers can still jump to it.
 */
export function StatusPage({
  icon: Icon,
  title,
  description,
  reference,
  standalone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  reference?: string | undefined;
  standalone: boolean;
  children: ReactNode;
}) {
  const Wrapper = standalone ? "main" : "div";
  return (
    <Wrapper className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-(--radius) border border-border bg-card p-7 text-center sm:p-9">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon size={26} aria-hidden />
        </span>
        {/* tabIndex -1: the error pages move focus here, because they replace the content without a navigation. */}
        <h1 id={STATUS_HEADING_ID} tabIndex={-1} className="text-[22px] font-bold tracking-[-0.02em] outline-none">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {reference && <p className="mt-3 text-xs text-muted-foreground">{reference}</p>}
        <div className="mt-7 flex flex-col gap-3">{children}</div>
      </div>
    </Wrapper>
  );
}
