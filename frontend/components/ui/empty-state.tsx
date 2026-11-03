import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The centred, muted message where a list or page has nothing to show yet. With `href` the
 * message is a link to the place where the user can add something. Spacing comes from `className`.
 */
export function EmptyState({ href, className = "", children }: { href?: string; className?: string; children: ReactNode }) {
  return (
    <p className={`text-center text-[13px] text-muted-foreground sm:text-body ${className}`}>
      {href ? (
        <Link href={href} className="focus-ring rounded-sm underline hover:text-foreground">
          {children}
        </Link>
      ) : (
        children
      )}
    </p>
  );
}
