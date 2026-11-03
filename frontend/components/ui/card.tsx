import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  /** The element to render: a <section> or <article> when the card has its own heading. */
  as?: "div" | "section" | "article" | "details";
};

/** The bordered panel that groups a page's content. Padding and layout come from `className`. */
export function Card({ as: Element = "div", className = "", ...props }: CardProps) {
  return <Element className={`rounded-lg border border-border bg-card ${className}`} {...props} />;
}
