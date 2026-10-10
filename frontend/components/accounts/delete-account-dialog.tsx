"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ApiError, fetchApi } from "@/lib/api";

type DeleteAccountDialogProps = {
  account: { id: string; name: string };
  onDeleted: (accountId: string) => void;
};

/** Permanent deletion control for an account row; onDeleted removes it from the parent list. */
export function DeleteAccountDialog({ account, onDeleted }: DeleteAccountDialogProps) {
  const t = useTranslations("accounts.delete");
  const router = useRouter();
  const dialogId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const countRequest = useRef<AbortController | null>(null);
  const deletePending = useRef(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [transactionCount, setTransactionCount] = useState<number | null>(null);
  const [error, setError] = useState<"countError" | "deleteError" | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => () => countRequest.current?.abort(), []);

  function finishDeletion() {
    dialog.current?.close();
    onDeleted(account.id);
    router.replace("/accounts");
    router.refresh();
  }

  function handleUnavailableAccount(error: unknown) {
    if (!(error instanceof ApiError)) return false;
    if (error.status === 404) {
      finishDeletion();
      return true;
    }
    if (error.status === 401) {
      dialog.current?.close();
      router.replace("/login");
      return true;
    }
    return false;
  }

  async function loadTransactionCount() {
    countRequest.current?.abort();
    const controller = new AbortController();
    countRequest.current = controller;
    setTransactionCount(null);
    setError(null);

    try {
      const { total } = await fetchApi<{ total: number }>(
        `/transactions?accountId=${encodeURIComponent(account.id)}&limit=1`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setTransactionCount(total);
    } catch (error) {
      if (controller.signal.aborted || handleUnavailableAccount(error)) return;
      setError("countError");
    }
  }

  function openDialog() {
    setConfirmationName("");
    dialog.current?.showModal();
    void loadTransactionCount();
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmationName !== account.name || transactionCount === null || deletePending.current) return;
    deletePending.current = true;
    setIsDeleting(true);
    setError(null);

    try {
      await fetchApi<void>(`/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
    } catch (error) {
      if (!handleUnavailableAccount(error)) setError("deleteError");
      return;
    } finally {
      deletePending.current = false;
      setIsDeleting(false);
    }

    finishDeletion();
  }

  return (
    <>
      <Button variant="destructive" onClick={openDialog}>
        {t("trigger")}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={`${dialogId}-title`}
        aria-describedby={`${dialogId}-warning`}
        onClose={() => {
          // Native close events are queued and may arrive after reopening.
          if (!dialog.current?.open) countRequest.current?.abort();
        }}
        onCancel={(event) => {
          if (deletePending.current) event.preventDefault();
        }}
        className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-[14px] border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <h2 id={`${dialogId}-title`} className="text-xl font-semibold">
          {t("title")}
        </h2>
        <p className="mt-2 font-semibold">
          <bdi>{account.name}</bdi>
        </p>
        <p id={`${dialogId}-warning`} className="mt-2 text-sm text-destructive">
          {t("warning")}
        </p>
        <p aria-live="polite" className="my-4 text-sm">
          {transactionCount === null ? t("loading") : t("transactionCount", { count: transactionCount })}
        </p>
        {error && (
          <div className="mb-4">
            <p role="alert" className="mb-2 text-sm text-destructive">
              {t(error)}
            </p>
            {error === "countError" && (
              <Button variant="outline" onClick={() => void loadTransactionCount()}>
                {t("retry")}
              </Button>
            )}
          </div>
        )}
        <form onSubmit={deleteAccount}>
          <TextField
            id={`${dialogId}-confirmation`}
            label={t("confirmationLabel")}
            value={confirmationName}
            onChange={(event) => setConfirmationName(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={isDeleting}
          />
          <div className="flex gap-3">
            <Button variant="outline" disabled={isDeleting} onClick={() => dialog.current?.close()}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmationName !== account.name || transactionCount === null || isDeleting}
            >
              {isDeleting ? t("deleting") : t("confirm")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
