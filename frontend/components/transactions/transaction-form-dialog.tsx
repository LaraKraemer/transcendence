"use client";

import { Check, Pencil, Plus, Wallet, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import { iconButtonClasses } from "@/components/accounts/account-row-actions";
import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { DeleteTransactionButton } from "@/components/transactions/delete-transaction-button";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { createTransaction, createTransfer, updateTransaction } from "@/lib/actions/transactions";
import { formatAmount } from "@/lib/format";
import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";
import type { Category, Transaction } from "@/lib/types";
import {
  MAX_NOTES_LENGTH,
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  MAX_TRANSACTION_MERCHANT_LENGTH,
  TRANSACTION_TYPES,
  changedFields,
  isTransactionErrorCode,
  type EditableTransactionFields,
  type TransactionErrorCode,
  type TransactionType,
} from "@/lib/validation";

type TransactionFields =
  | "accountId"
  | "type"
  | "toAccountId"
  | "amount"
  | "toAmount"
  | "description"
  | "merchant"
  | "bookedOn"
  | "categoryId"
  | "notes";

const FIELD_ORDER: TransactionFields[] = [
  "type",
  "toAccountId",
  "amount",
  "toAmount",
  "description",
  "merchant",
  "bookedOn",
  "categoryId",
];

type FormState = {
  fieldErrors: Partial<Record<TransactionFields, TransactionErrorCode>>;
  error: "network" | "generic" | "accountArchived" | "notFound" | null;
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
  const searchParams = useSearchParams();
  const pageUrl = `${pathname}?${searchParams}`;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState({ key: 0, today: "", accountId: "" });
  const [added, setAdded] = useState<{ pageUrl: string; accountId: string; description: string } | null>(null);

  const pageAccount =
    pathname === "/transactions" ? accounts.find((account) => account.id === searchParams.get("accountId")) : undefined;
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
          mode="create"
          summaryId={fixedAccountId}
          accounts={accountOptions}
          allAccounts={allAccounts}
          categories={categories}
          defaultAccountId={opening.accountId}
          today={opening.today}
          onCreated={(accountId, description) => {
            if (!pageAccount) setAdded({ pageUrl, accountId, description });
          }}
          onDone={() => setOpen(false)}
          onPendingChange={setSaving}
        />
      </Modal>
      {added?.pageUrl === pageUrl && (
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
              href={`/transactions?accountId=${added.accountId}`}
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

export function EditTransactionButton({
  transaction,
  account,
  categories,
  focusAfterDeleteId,
}: {
  transaction: Transaction;
  account: AccountOption;
  categories: CategoryOption[];
  focusAfterDeleteId: string;
}) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set when saving finds the transaction deleted elsewhere: closing then reloads the list without it.
  const [gone, setGone] = useState(false);
  const summaryId = useId();

  const close = () => {
    if (!gone) return setOpen(false);
    flushSync(() => setOpen(false));
    document.getElementById(focusAfterDeleteId)?.focus();
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("edit", { description: transaction.description })}
        title={t("edit", { description: transaction.description })}
        className={`${iconButtonClasses} hover:text-foreground`}
      >
        <Pencil size={15} aria-hidden />
      </button>
      <Modal open={open} title={t("form.editTitle")} onClose={close} busy={saving} describedBy={summaryId}>
        {open && (
          <TransactionForm
            mode="edit"
            transaction={transaction}
            summaryId={summaryId}
            accounts={[account]}
            // The type can't change on edit, and transfers can't be edited, so no transfer target is needed.
            allAccounts={[account]}
            categories={categories}
            focusAfterDeleteId={focusAfterDeleteId}
            onDeleted={() => flushSync(() => setOpen(false))}
            onGone={() => setGone(true)}
            onDone={close}
            onPendingChange={setSaving}
          />
        )}
      </Modal>
    </>
  );
}

const editableFields = (transaction: Transaction): EditableTransactionFields => ({
  description: transaction.description,
  merchant: transaction.merchant,
  bookedOn: transaction.bookedOn,
  categoryId: transaction.categoryId,
  notes: transaction.notes,
});

type TransactionFormProps = FormProps & {
  summaryId: string;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
} & (
    | {
        mode: "create";
        defaultAccountId: string;
        today: string;
        onCreated: (accountId: string, description: string) => void;
      }
    | {
        mode: "edit";
        transaction: Transaction;
        focusAfterDeleteId: string;
        onDeleted: () => void;
        onGone: () => void;
      }
  );

function TransactionForm(props: TransactionFormProps) {
  const { summaryId, accounts, allAccounts, categories, onDone, onPendingChange } = props;
  const t = useTranslations("transactions");
  const locale = useLocale();
  const announce = useAnnounce();
  const idPrefix = useId();
  const fieldId = (name: TransactionFields) => `${idPrefix}-${name}`;

  const [values, setValues] = useState<Record<TransactionFields, string>>(() =>
    props.mode === "create"
      ? {
          accountId: props.defaultAccountId,
          type: "expense",
          toAccountId: "",
          amount: "",
          toAmount: "",
          description: "",
          merchant: "",
          bookedOn: props.today,
          categoryId: "",
          notes: "",
        }
      : {
          accountId: props.transaction.accountId,
          type: props.transaction.type,
          toAccountId: "",
          amount: "",
          toAmount: "",
          description: props.transaction.description,
          merchant: props.transaction.merchant ?? "",
          bookedOn: props.transaction.bookedOn,
          categoryId: props.transaction.categoryId ?? "",
          notes: props.transaction.notes ?? "",
        },
  );
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
      categoryId: categories
        .find((category) => category.id === prev.categoryId)
        ?.types.some((allowed) => allowed === type)
        ? prev.categoryId
        : "",
    }));

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, { accountId, ...submitted }: Record<TransactionFields, string>): Promise<FormState> => {
      try {
        const result =
          props.mode === "edit"
            ? await updateTransaction(props.transaction.id, editableFields(props.transaction), submitted)
            : submitted.type === "transfer"
              ? await createTransfer(accountId, submitted)
              : await createTransaction(accountId, submitted);
        if (result.success) {
          const description = submitted.description.trim();
          if (props.mode === "create") {
            announce(t("announcements.created", { description }));
            props.onCreated(accountId, description);
          } else {
            announce(t("announcements.saved", { description }));
          }
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
        // 404 on edit: the transaction was deleted elsewhere (e.g. another tab).
        if (props.mode === "edit" && result.status === 404) {
          props.onGone();
          return { fieldErrors: {}, error: "notFound" };
        }
        return { fieldErrors: {}, error: formErrorFor(result) === "network" ? "network" : "generic" };
      } catch {
        return { fieldErrors: {}, error: "network" };
      }
    },
    initialState,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      props.mode === "edit" &&
      Object.keys(
        changedFields(editableFields(props.transaction), {
          description: values.description.trim(),
          merchant: values.merchant.trim(),
          bookedOn: values.bookedOn,
          categoryId: values.categoryId,
          notes: values.notes.trim(),
        }),
      ).length === 0
    ) {
      onDone();
      return;
    }
    startTransition(() => submitAction(values));
  }

  useEffect(() => {
    onPendingChange(isPending);
    return () => onPendingChange(false);
  }, [isPending, onPendingChange]);

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
      max: code === "merchantTooLong" ? MAX_TRANSACTION_MERCHANT_LENGTH : MAX_TRANSACTION_DESCRIPTION_LENGTH,
    });

  const byName = new Intl.Collator(locale).compare;
  const typeCategories = categories
    .filter((category) => category.types.some((allowed) => allowed === values.type))
    .sort((a, b) => byName(a.name, b.name));

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
          <dl id={summaryId} className={props.mode === "edit" ? "grid gap-x-4 sm:grid-cols-2" : undefined}>
            <div className="mb-[18px]">
              <dt className="mb-[7px] text-[13px] font-semibold">
                {isTransfer ? t("form.fromAccount") : t("form.account")}
              </dt>{" "}
              <dd className="flex items-center gap-2 text-sm font-semibold">
                <Wallet size={16} aria-hidden className="shrink-0 text-muted-foreground" />
                <bdi className="min-w-0 break-words">{account?.name}</bdi>
              </dd>
            </div>
            {/* The amount can't be edited: changing it can flip the sign, which the category must match. */}
            {props.mode === "edit" && account && (
              <div className="mb-[18px]">
                <dt className="mb-[7px] text-[13px] font-semibold">{t("columns.amount")}</dt>{" "}
                <dd className="text-sm font-semibold">
                  <span
                    className={`tabular-nums ${props.transaction.amountMinor > 0 ? "text-success" : "text-destructive"}`}
                  >
                    {formatAmount(props.transaction.amountMinor, account.currencyCode, minorUnit, locale, "exceptZero")}
                  </span>
                  <span aria-hidden> · </span>
                  <span className="font-normal text-muted-foreground">
                    {t(props.transaction.amountMinor > 0 ? "form.types.income" : "form.types.expense")}
                  </span>
                </dd>
              </div>
            )}
          </dl>
        )}

        {props.mode === "create" && (
          <>
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
          </>
        )}

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
          data-autofocus={props.mode === "edit" || undefined}
          label={t("form.description")}
          type="text"
          required
          maxLength={MAX_TRANSACTION_DESCRIPTION_LENGTH}
          placeholder={t("form.descriptionPlaceholder")}
          error={errorText(fieldErrors.description)}
        />

        {!isTransfer && (
          <TextField
            id={fieldId("merchant")}
            {...field("merchant")}
            label={t("form.merchant")}
            type="text"
            maxLength={MAX_TRANSACTION_MERCHANT_LENGTH}
            error={errorText(fieldErrors.merchant)}
          />
        )}

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
            maxLength={MAX_NOTES_LENGTH}
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
            {props.mode === "create"
              ? isPending
                ? t("form.submitting")
                : t("form.submit")
              : isPending
                ? t("form.saving")
                : t("form.save")}
          </Button>
        </div>

        {props.mode === "edit" && (
          <div className="mt-4 border-t border-border pt-4">
            <DeleteTransactionButton
              variant="text"
              transactionId={props.transaction.id}
              description={props.transaction.description}
              isTransfer={props.transaction.type === "transfer"}
              focusAfterDeleteId={props.focusAfterDeleteId}
              onDeleted={props.onDeleted}
            />
          </div>
        )}
      </fieldset>
    </form>
  );
}
