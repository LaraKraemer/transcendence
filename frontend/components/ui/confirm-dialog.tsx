"use client";

import { useTranslations } from "next-intl";
import { useId, type ReactNode } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type ConfirmDialogProps = {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  /** Disables only the confirm button, e.g. while the dialog's text is still loading. */
  confirmDisabled?: boolean;
  error?: string | null;
};

/** Confirmation for a destructive action. Focus starts on Cancel, so Enter right after opening doesn't confirm. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending,
  confirmDisabled,
  error,
}: ConfirmDialogProps) {
  const t = useTranslations("common");
  const descriptionId = useId();
  return (
    // Described by its text: focus starts on Cancel, so a screen reader could otherwise skip what the action does.
    <Modal open={open} title={title} onClose={onCancel} busy={pending} describedBy={descriptionId} closeOnBackdropClick>
      <div id={descriptionId} className="mb-6 text-sm text-muted-foreground">
        {children}
      </div>
      <FormAlert message={error ?? null} />
      <div className="flex gap-3">
        <Button variant="outline" onClick={onCancel} disabled={pending} data-autofocus>
          {t("cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending || confirmDisabled}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
