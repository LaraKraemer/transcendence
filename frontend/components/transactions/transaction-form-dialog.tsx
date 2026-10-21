"use client";

import { Check, Plus, Wallet, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";

import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { createTransaction, createTransfer } from "@/lib/actions/transactions";
import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";
import type { Category } from "@/lib/types";
import {
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  TRANSACTION_TYPES,
  isTransactionErrorCode,
  type TransactionErrorCode,
  type TransactionType,
} from "@/lib/validation";

type TransactionFields =
  "accountId" | "type" | "toAccountId" | "amount" | "toAmount" | "description" | "bookedOn" | "categoryId" | "notes";

const FIELD_ORDER: TransactionFields[] = [
  "type",
  "toAccountId",
  "amount",
  "toAmount",
  "description",
  "bookedOn",
  "categoryId",
];

type FormState = {
  fieldErrors: Partial<Record<TransactionFields, TransactionErrorCode>>;
  error: "network" | "generic" | "accountArchived" | null;
};
const initialState: FormState = { fieldErrors: {}, error: null };

type CategoryOption = Pick<Category, "id" | "name" | "types">;

export type AccountOption = {
  id: string;
  name: string;
  currencyCode: string;
  minorUnit: number;
};

type FormProps = {
  /** The accounts the transaction can be added to (just the page's account on an account page). */
  accounts: AccountOption[];
  /** Every active account: a transfer can go to any of them, whichever account the form is fixed to. */
  allAccounts: AccountOption[];
  categories: CategoryOption[];
};

function localToday(): string {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

function lastAccountId(): string | undefined {
  const prefix = `${LAST_ACCOUNT_COOKIE}=`;
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

const variantClasses = {
  header: "flex shrink-0 items-center gap-[7px] rounded-[10px] px-[18px] py-[11px] text-sm font-semibold max-sm:hidden",
  fab: "flex size-14 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(8,14,25,.35)] sm:hidden",
};

export function NewTransactionButton({
  variant,
  accounts,
  allAccounts,
  categories,
}: FormProps & { variant: keyof typeof variantClasses }) {
  const t = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState({ key: 0, today: "", accountId: "" });
  const [added, setAdded] = useState<{ pathname: string; accountId: string; description: string } | null>(null);

  const pageAccount = accounts.find((account) => pathname.startsWith(`/accounts/${account.id}/`));
  const accountOptions = pageAccount ? [pageAccount] : accounts;
  const fixedAccountId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const lastId = lastAccountId();
          const preselected = accountOptions.find((account) => account.id === lastId) ?? accountOptions[0];
          setOpening((prev) => ({ key: prev.key + 1, today: localToday(), accountId: preselected?.id ?? "" }));
          setAdded(null);
          setOpen(true);
        }}
        className={`cursor-pointer bg-primary text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none ${variantClasses[variant]}`}
      >
        <Plus size={variant === "fab" ? 24 : 16} aria-hidden />
        <span className={variant === "fab" ? "sr-only" : undefined}>{t("newTransaction")}</span>
      </button>
      <Modal
        open={open}
        title={t("form.title")}
        onClose={() => setOpen(false)}
        busy={saving}
        describedBy={accountOptions.length === 1 ? fixedAccountId : undefined}
      >
        <TransactionForm
          key={opening.key}
          fixedAccountId={fixedAccountId}
          accounts={accountOptions}
          allAccounts={allAccounts}
          categories={categories}
          defaultAccountId={opening.accountId}
          today={opening.today}
          onCreated={(accountId, description) => {
            if (!pageAccount) setAdded({ pathname, accountId, description });
          }}
          onDone={() => setOpen(false)}
          onPendingChange={setSaving}
        />
      </Modal>
      {added?.pathname === pathname && (
        <div className="absolute end-0 bottom-full mb-3 flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-[14px] border border-border bg-card p-3.5 text-sm text-foreground shadow-[0_12px_32px_rgba(8,14,25,.25)]">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
            <Check size={14} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words">
              {t.rich("added.message", {
                description: added.description,
                account: accounts.find((account) => account.id === added.accountId)?.name ?? "",
                desc: (chunks) => <bdi>{chunks}</bdi>,
                name: (chunks) => <bdi>{chunks}</bdi>,
              })}
            </p>
            <Link
              href={`/accounts/${added.accountId}/transactions`}
              className="mt-1 inline-block rounded-sm font-semibold underline hover:no-underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("added.view")}
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setAdded(null)}
            aria-label={tCommon("close")}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}

function TransactionForm({
  fixedAccountId,
  accounts,
  allAccounts,
  categories,
  defaultAccountId,
  today,
  onCreated,
  onDone,
  onPendingChange,
}: FormProps & {
  fixedAccountId: string;
  defaultAccountId: string;
  today: string;
  onCreated: (accountId: string, description: string) => void;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const announce = useAnnounce();
  const idPrefix = useId();
  const fieldId = (name: TransactionFields | "merchant") => `${idPrefix}-${name}`;

  const [values, setValues] = useState<Record<TransactionFields, string>>({
    accountId: defaultAccountId,
    type: "expense",
    toAccountId: "",
    amount: "",
    toAmount: "",
    description: "",
    bookedOn: today,
    categoryId: "",
    notes: "",
  });
  const field = (name: TransactionFields) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((prev) => ({ ...prev, [name]: e.target.value })),
  });
  // The destination can't be the source account, so a source change may invalidate it.
  const changeSourceAccount = (accountId: string) =>
    setValues((prev) => ({ ...prev, accountId, toAccountId: prev.toAccountId === accountId ? "" : prev.toAccountId }));
  // Keeps the chosen category only if it is also available for the new type. Transfers have none.
  const changeType = (type: TransactionType) =>
    setValues((prev) => ({
      ...prev,
      type,
      categoryId: categories.find((category) => category.id === prev.categoryId)?.types.includes(type)
        ? prev.categoryId
        : "",
    }));

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, { accountId, ...submitted }: Record<TransactionFields, string>): Promise<FormState> => {
      try {
        const result =
          submitted.type === "transfer"
            ? await createTransfer(accountId, submitted)
            : await createTransaction(accountId, submitted);
        if (result.success) {
          announce(t("announcements.created", { description: submitted.description.trim() }));
          onCreated(accountId, submitted.description.trim());
          onDone();
          return initialState;
        }
        const fieldErrors = Object.fromEntries(
          Object.entries(result.errors ?? {})
            .map(([field, codes]) => [field, codes.find(isTransactionErrorCode)] as const)
            .filter(([, code]) => code),
        );
        if (Object.keys(fieldErrors).length > 0) return { fieldErrors, error: null };
        // 409: the account was archived since the page loaded.
        if (result.status === 409) return { fieldErrors: {}, error: "accountArchived" };
        return { fieldErrors: {}, error: formErrorFor(result) === "network" ? "network" : "generic" };
      } catch {
        return { fieldErrors: {}, error: "network" };
      }
    },
    initialState,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => submitAction(values));
  }

  useEffect(() => onPendingChange(isPending), [isPending, onPendingChange]);

  useEffect(() => {
    const firstInvalid = FIELD_ORDER.find((name) => fieldErrors[name]);
    if (firstInvalid) document.getElementById(`${idPrefix}-${firstInvalid}`)?.focus();
  }, [fieldErrors, idPrefix]);

  const account = accounts.find((option) => option.id === values.accountId);
  const minorUnit = account?.minorUnit ?? 2;
  const isTransfer = values.type === "transfer";
  // A transfer needs a second account to go to.
  const canTransfer = allAccounts.length >= 2;
  const toAccount = allAccounts.find((option) => option.id === values.toAccountId);
  // Across currencies the amount received is entered separately; within one it is the amount sent.
  const needsReceivedAmount = isTransfer && toAccount !== undefined && toAccount.currencyCode !== account?.currencyCode;
  const errorText = (code?: TransactionErrorCode, forMinorUnit = minorUnit) =>
    code &&
    t(`errors.${code}`, {
      digits: forMinorUnit,
      example: (12.5).toFixed(forMinorUnit),
      max: MAX_TRANSACTION_DESCRIPTION_LENGTH,
    });

  const byName = new Intl.Collator(locale).compare;
  const typeCategories = categories
    .filter((category) => category.types.includes(values.type as TransactionType))
    .sort((a, b) => byName(a.name, b.name));
  const merchantHintId = `${fieldId("merchant")}-hint`;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset disabled={isPending}>
        <FormAlert message={error && t(`errors.${error}`)} />

        {accounts.length > 1 ? (
          <SelectField
            id={fieldId("accountId")}
            {...field("accountId")}
            onChange={(e) => changeSourceAccount(e.target.value)}
            label={isTransfer ? t("form.fromAccount") : t("form.account")}
          >
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <div id={fixedAccountId} className="mb-[18px]">
            <div className="mb-[7px] text-[13px] font-semibold">
              {isTransfer ? t("form.fromAccount") : t("form.account")}
            </div>{" "}
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Wallet size={16} aria-hidden className="shrink-0 text-muted-foreground" />
              <bdi className="min-w-0 break-words">{account?.name}</bdi>
            </div>
          </div>
        )}

        <ChoiceGroup legend={t("form.type")} error={errorText(fieldErrors.type)} idPrefix={fieldId("type")}>
          <div className="flex gap-1 rounded-[11px] border border-border bg-muted p-1">
            {TRANSACTION_TYPES.map((type, index) => (
              <label key={type} className="flex-1">
                <input
                  type="radio"
                  name="type"
                  value={type}
                  checked={values.type === type}
                  onChange={() => changeType(type)}
                  disabled={type === "transfer" && !canTransfer}
                  id={index === 0 ? fieldId("type") : undefined}
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-[8px] px-2 py-1.5 text-center text-[13px] font-medium text-muted-foreground peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
                  {t(`form.types.${type}`)}
                </span>
              </label>
            ))}
          </div>
        </ChoiceGroup>
        {!canTransfer && (
          <p className="-mt-3 mb-[18px] text-xs text-muted-foreground">{t("form.transferNeedsTwoAccounts")}</p>
        )}

        {isTransfer && (
          <SelectField
            id={fieldId("toAccountId")}
            {...field("toAccountId")}
            label={t("form.toAccount")}
            error={errorText(fieldErrors.toAccountId)}
          >
            <option value="">{t("form.chooseAccount")}</option>
            {allAccounts
              .filter((option) => option.id !== values.accountId)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </SelectField>
        )}

        <TextField
          id={fieldId("amount")}
          {...field("amount")}
          data-autofocus
          label={t(isTransfer ? "form.amountSent" : "form.amount", { currency: account?.currencyCode ?? "" })}
          type="text"
          dir="ltr"
          inputMode={minorUnit === 0 ? "numeric" : "decimal"}
          autoComplete="off"
          required
          placeholder={(0).toFixed(minorUnit)}
          error={errorText(fieldErrors.amount)}
        />

        {needsReceivedAmount && (
          <TextField
            id={fieldId("toAmount")}
            {...field("toAmount")}
            label={t("form.amountReceived", { currency: toAccount.currencyCode })}
            type="text"
            dir="ltr"
            inputMode={toAccount.minorUnit === 0 ? "numeric" : "decimal"}
            autoComplete="off"
            required
            placeholder={(0).toFixed(toAccount.minorUnit)}
            error={errorText(fieldErrors.toAmount, toAccount.minorUnit)}
          />
        )}

        <TextField
          id={fieldId("description")}
          {...field("description")}
          label={t("form.description")}
          type="text"
          required
          maxLength={MAX_TRANSACTION_DESCRIPTION_LENGTH}
          placeholder={t("form.descriptionPlaceholder")}
          error={errorText(fieldErrors.description)}
        />

        <TextField
          id={fieldId("merchant")}
          label={t("form.merchant")}
          type="text"
          disabled
          aria-describedby={merchantHintId}
        >
          <p id={merchantHintId} className="mt-1.5 text-xs text-muted-foreground">
            {tCommon("comingSoon")}
          </p>
        </TextField>

        <div className={`grid gap-x-4 ${isTransfer ? "" : "sm:grid-cols-2"}`}>
          <TextField
            id={fieldId("bookedOn")}
            {...field("bookedOn")}
            label={t("form.date")}
            type="date"
            required
            error={errorText(fieldErrors.bookedOn)}
          />
          {!isTransfer && (
            <SelectField
              id={fieldId("categoryId")}
              {...field("categoryId")}
              label={t("form.category")}
              required={false}
              hint={typeCategories.length === 0 ? t("form.noCategoriesHint", { type: values.type }) : undefined}
              error={errorText(fieldErrors.categoryId)}
            >
              <option value="">{t("form.noCategory")}</option>
              {typeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </SelectField>
          )}
        </div>

        <div className="mb-[18px]">
          <label htmlFor={fieldId("notes")} className="mb-[7px] block text-[13px] font-semibold">
            {t("form.notes")}
          </label>
          <textarea
            id={fieldId("notes")}
            {...field("notes")}
            rows={3}
            placeholder={t("form.notesPlaceholder")}
            className="block w-full resize-y rounded-[11px] border border-input bg-field px-[15px] py-[13px] text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="mt-2 flex gap-3">
          <Button variant="outline" onClick={onDone}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" variant="success">
            <Check size={16} aria-hidden />
            {isPending ? t("form.submitting") : t("form.submit")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
