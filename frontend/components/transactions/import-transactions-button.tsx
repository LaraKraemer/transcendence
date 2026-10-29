"use client";

import { LoaderCircle, Upload } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";

import type { AccountOption } from "@/components/transactions/transaction-form-dialog";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { importTransactions } from "@/lib/actions/transaction-import";
import { formatAmount } from "@/lib/format";
import { parseImportPreview, TRANSACTION_IMPORT_MAX_BYTES, type ImportDocument } from "@/lib/transaction-import";

/** One-account JSON import: selecting and previewing never write to the ledger. */
export function ImportTransactionsButton({
  accounts,
  selectedAccountId,
}: {
  accounts: AccountOption[];
  selectedAccountId?: string;
}) {
  const t = useTranslations("transactionImport");
  const common = useTranslations("common");
  const transactions = useTranslations("transactions");
  const types = useTranslations("transactions.form.types");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(selectedAccountId ?? accounts[0]?.id ?? "");
  const [selection, setSelection] = useState<{ file: File; document: ImportDocument } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();
  const readingRef = useRef(false);
  const submittingRef = useRef(false);
  const busy = pending || reading;
  const account = accounts.find((entry) => entry.id === accountId);
  const currencyMismatch = !!selection && selection.document.currency !== account?.currencyCode;

  async function selectFile(file: File) {
    if (readingRef.current || submittingRef.current) return;
    setSelection(null);
    setError(null);
    if (file.size > TRANSACTION_IMPORT_MAX_BYTES) return setError(t("tooLarge"));
    readingRef.current = true;
    setReading(true);
    try {
      const document = parseImportPreview(await file.text());
      if ("error" in document) {
        setError(document.row ? t("invalidRow", { row: document.row }) : t("invalid"));
      } else {
        setSelection({ file, document });
      }
    } catch {
      setError(t("readError"));
    } finally {
      readingRef.current = false;
      setReading(false);
    }
  }

  function confirmImport() {
    if (!selection || !account || currencyMismatch || readingRef.current || submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    const formData = new FormData();
    formData.set("accountId", account.id);
    formData.set("file", selection.file);
    startTransition(async () => {
      try {
        const result = await importTransactions(formData);
        if (!result.success) {
          setError(result.status === 413 ? t("tooLarge") : result.status ? result.message : t("network"));
          return;
        }
        setSuccessCount(result.imported ?? selection.document.transactions.length);
        setSelection(null);
        setOpen(false);
      } catch {
        setError(t("network"));
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <div>
      <Button
        variant="primary"
        className="size-10 w-10! p-0!"
        aria-label={t("title")}
        title={t("title")}
        disabled={accounts.length === 0}
        onClick={() => {
          setError(null);
          setSelection(null);
          setSuccessCount(null);
          setOpen(true);
        }}
      >
        <Upload size={16} aria-hidden className="shrink-0" />
      </Button>
      <div role="status">
        {successCount !== null && (
          <p className="mt-2 w-fit rounded-[8px] border border-success/40 bg-success-bg px-3 py-2 text-xs font-medium text-success">
            {t("success", { count: successCount })}
          </p>
        )}
      </div>
      <Modal
        className="w-[45rem]!"
        open={open}
        title={t("title")}
        busy={busy}
        onClose={() => {
          setOpen(false);
          setSelection(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirmImport();
          }}
        >
          <div role="status">
            {busy && (
              <div className="mb-4 rounded-[11px] border-2 border-primary bg-accent p-4">
                <div className="mb-3 flex items-center gap-3 text-accent-foreground">
                  <LoaderCircle size={28} aria-hidden className="shrink-0 text-primary motion-safe:animate-spin" />
                  <p className="text-base font-semibold">{reading ? t("reading") : t("importing")}</p>
                </div>
                <progress
                  aria-label={reading ? t("reading") : t("importing")}
                  className="block h-5 w-full overflow-hidden rounded-full bg-border accent-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                />
              </div>
            )}
          </div>
          <fieldset disabled={busy} aria-busy={busy} className="space-y-4">
            <label className="block text-sm font-medium">
              {t("account")}
              <select
                data-autofocus
                className="mt-1 block w-full rounded border border-border bg-card p-2"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                required
              >
                {accounts.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} ({entry.currencyCode})
                  </option>
                ))}
              </select>
            </label>
            <label className="block rounded-[11px] border border-border bg-muted p-4 text-sm font-semibold">
              {t("file")}
              <input
                key={String(open)}
                className="mt-3 block w-full min-w-0 rounded-[8px] text-sm text-muted-foreground file:me-3 file:cursor-pointer file:rounded-[8px] file:border-0 file:bg-primary file:px-4 file:py-2.5 file:font-semibold file:text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-60"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectFile(file);
                }}
              />
            </label>
            <p className="text-sm text-muted-foreground">{t("help")}</p>
            {selection && account && (
              <>
                <h3 className="font-semibold">{t("preview", { count: selection.document.transactions.length })}</h3>
                <p className="rounded-[8px] bg-muted px-3 py-2 text-sm break-words text-muted-foreground">
                  <bdi>{selection.file.name}</bdi>
                </p>
                <div className="max-h-64 overflow-auto rounded-[11px] bg-muted p-4">
                  <table className="w-full text-sm [&_th]:pb-3 [&_th:not(:last-child)]:pe-6 [&_td:not(:last-child)]:pe-6">
                    <caption className="sr-only">
                      {t("preview", { count: selection.document.transactions.length })}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="text-start">
                          {t("date")}
                        </th>
                        <th scope="col" className="text-start">
                          {t("description")}
                        </th>
                        <th scope="col" className="text-start">
                          {transactions("form.category")}
                        </th>
                        <th scope="col" className="text-end">
                          {t("amount")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selection.document.transactions.map((entry, index) => (
                        <tr key={index}>
                          <td className="py-1 whitespace-nowrap">
                            <bdi>{entry.bookedOn}</bdi>
                          </td>
                          <td className="max-w-40 break-words">
                            <bdi>{entry.description || types(entry.type)}</bdi>
                          </td>
                          <td className="max-w-40 break-words">
                            <bdi>{entry.category?.trim() || transactions("uncategorised")}</bdi>
                          </td>
                          <td className="text-end whitespace-nowrap">
                            <bdi>
                              {formatAmount(entry.amountMinor, selection.document.currency, account.minorUnit, locale)}
                            </bdi>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm">{t("warning")}</p>
              </>
            )}
            {currencyMismatch && (
              <p role="alert" className="rounded-[11px] border border-destructive/40 bg-danger-bg p-4 text-sm font-semibold text-destructive">
                {t("currencyMismatch")}
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-[11px] border border-destructive/40 bg-danger-bg p-4 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  setSelection(null);
                }}
              >
                {common("cancel")}
              </Button>
              <Button type="submit" disabled={!selection || !account || currencyMismatch}>
                {t("confirm")}
              </Button>
            </div>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}
