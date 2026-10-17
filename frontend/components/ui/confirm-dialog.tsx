"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, type ReactNode } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
};

/**
 * Confirmation for a destructive action, built on the native <dialog>:
 * `showModal()` traps focus, makes the page inert, closes on Esc and returns
 * focus to the opener. Styled after the modal in docs/design/desktop/categories.html.
 */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel, pending, error }: ConfirmDialogProps) {
  const t = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start on the safe choice, so Enter right after opening doesn't confirm.
      cancelRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // Esc fires "cancel"; route it through onCancel so React state stays the source of truth.
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // A click on the backdrop lands on the <dialog> itself (the panel covers everything else).
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="m-auto w-[460px] max-w-[calc(100%-2rem)] rounded-[18px] border border-border bg-card p-7 text-foreground shadow-[0_24px_60px_rgba(8,14,25,.3)] backdrop:bg-[rgba(8,14,25,.55)] backdrop:backdrop-blur-[2px]"
    >
      <div className="mb-3 flex items-center gap-3">
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          aria-label={t("close")}
          className="ms-auto flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="mb-6 text-sm text-muted-foreground">{children}</div>
      <FormAlert message={error ?? null} />
      <div className="flex gap-3">
        <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={pending}>
          {t("cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
