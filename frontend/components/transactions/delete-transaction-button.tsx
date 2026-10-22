"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";

import { iconButtonClasses } from "@/components/accounts/account-row-actions";
import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { deleteTransaction } from "@/lib/actions/transactions";

export function DeleteTransactionButton({
  transactionId,
  description,
  isTransfer,
  focusAfterDeleteId,
  variant = "icon",
  onDeleted,
}: {
  transactionId: string;
  description: string;
  /** Deleting one leg of a transfer deletes the other leg too, which the dialog says. */
  isTransfer: boolean;
  focusAfterDeleteId: string;
  variant?: "icon" | "text";
  onDeleted?: () => void;
}) {
  const t = useTranslations("transactions");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [error, setError] = useState<"network" | "generic" | null>(null);
  const [isPending, startTransition] = useTransition();

  function openDialog() {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  function confirmDelete() {
    if (isPending) return;
    startTransition(async () => {
      const result = await deleteTransaction(transactionId).catch(() => null);
      if (result?.success) {
        dialogRef.current?.close();
        onDeleted?.();
        document.getElementById(focusAfterDeleteId)?.focus();
        return;
      }
      setError(result && formErrorFor(result) === "network" ? "network" : "generic");
    });
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={openDialog}
          aria-label={t("delete", { description })}
          title={t("delete", { description })}
          className={`${iconButtonClasses} hover:text-destructive`}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-danger-bg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 size={16} aria-hidden />
          {t("form.delete")}
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onCancel={(event) => {
          if (isPending) event.preventDefault();
        }}
        onClose={() => setError(null)}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-border bg-card p-6 text-start text-foreground backdrop:bg-black/50"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {t("confirmTitle")}
        </h2>
        <p id={bodyId} className="mt-2 mb-5 text-sm break-words text-muted-foreground">
          {t.rich(isTransfer ? "confirmBodyTransfer" : "confirmBody", {
            description,
            name: (chunks) => <bdi>{chunks}</bdi>,
          })}
        </p>
        <FormAlert message={error && t(`errors.${error}`)} />
        <div className="flex gap-3">
          <Button ref={cancelRef} variant="outline" disabled={isPending} onClick={() => dialogRef.current?.close()}>
            {t("cancel")}
          </Button>
          <Button
            variant="danger"
            aria-disabled={isPending || undefined}
            onClick={confirmDelete}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          >
            {isPending ? t("deleting") : t("confirm")}
          </Button>
        </div>
      </dialog>
    </>
  );
}
