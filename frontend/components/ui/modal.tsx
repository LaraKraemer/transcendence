"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  /** While true (e.g. a request is running), Esc, the backdrop and ✕ don't close it. */
  busy?: boolean;
  /** Id of the text that explains the dialog, for `aria-describedby`. */
  describedBy?: string;
  children: ReactNode;
};

/**
 * Modal shell on the native <dialog>: `showModal()` traps focus, makes the page
 * inert, and returns focus to the opener on close. Focus starts on the element
 * marked `data-autofocus`. Styled after the modal in docs/design/desktop/categories.html.
 */
export function Modal({ open, title, onClose, busy, describedBy, children }: ModalProps) {
  const t = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Set on mousedown: a click counts as a backdrop click only if the press also
  // started there, not when a text selection inside the box ends outside it.
  const pressStartedOnBackdrop = useRef(false);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      // Browsers only return focus if it is still inside the dialog; a form that
      // disabled its fields while saving has already dropped it to <body>.
      if (document.activeElement === document.body && opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      // Esc fires "cancel"; route it through onClose so React state stays the source of truth.
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      // Only a backdrop click targets the <dialog> itself: all the padding and gaps
      // belong to the inner wrapper, so clicks inside the box never land here.
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const isBackdropClick = pressStartedOnBackdrop.current && event.target === event.currentTarget;
        pressStartedOnBackdrop.current = false;
        if (isBackdropClick && !busy) onClose();
      }}
      className="m-auto max-h-[calc(100%-2rem)] w-[460px] max-w-[calc(100%-2rem)] overflow-hidden rounded-[18px] border border-border bg-card p-0 text-foreground shadow-[0_24px_60px_rgba(8,14,25,.3)] open:flex open:flex-col backdrop:bg-[rgba(8,14,25,.55)] backdrop:backdrop-blur-[2px]"
    >
      <div className="flex min-h-0 flex-col py-3">
        <div className="min-h-0 overflow-y-auto px-7 py-4">
          <div className="mb-3 flex items-center gap-3">
            <h2 id={titleId} className="min-w-0 text-xl font-bold break-words">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label={t("close")}
              className="ms-auto flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      </div>
    </dialog>
  );
}
