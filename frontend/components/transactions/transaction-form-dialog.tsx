"use client";

import { Check, Pencil, Plus, Wallet, X } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
import { createTransaction, updateTransaction } from "@/lib/actions/transactions";
import { LAST_ACCOUNT_COOKIE } from "@/lib/last-account";
import type { Category, Transaction } from "@/lib/types";
import {
  MAX_TRANSACTION_DESCRIPTION_LENGTH,
  TRANSACTION_TYPES,
  changedFields,
  isTransactionErrorCode,
  type EditableTransactionFields,
  type TransactionErrorCode,
} from "@/lib/validation";

type TransactionFields = "accountId" | "type" | "amount" | "description" | "bookedOn" | "categoryId" | "notes";

const FIELD_ORDER: TransactionFields[] = ["type", "amount", "description", "bookedOn", "categoryId"];

type FormState = {
  fieldErrors: Partial<Record<TransactionFields, TransactionErrorCode>>;
  error: "network" | "generic" | "accountArchived" | "notFound" | null;
};
const initialState: FormState = { fieldErrors: {}, error: null };

type CategoryOption = Pick<Category, "id" | "name" | "kind">;

export type AccountOption = {
  id: string;
  name: string;
  currencyCode: string;
  minorUnit: number;
};

type FormProps = {
  accounts: AccountOption[];
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
          mode="create"
          summaryId={fixedAccountId}
          accounts={accountOptions}
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
  const { summaryId, accounts, categories, onDone, onPendingChange } = props;
  const t = useTranslations("transactions");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const format = useFormatter();
  const announce = useAnnounce();
  const idPrefix = useId();
  const fieldId = (name: TransactionFields | "merchant") => `${idPrefix}-${name}`;

  const [values, setValues] = useState<Record<TransactionFields, string>>(() =>
    props.mode === "create"
      ? {
          accountId: props.defaultAccountId,
          type: "expense",
          amount: "",
          description: "",
          bookedOn: props.today,
          categoryId: "",
          notes: "",
        }
      : {
          accountId: props.transaction.accountId,
          type: props.transaction.amountMinor < 0 ? "expense" : "income",
          amount: "",
          description: props.transaction.description,
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

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, { accountId, ...submitted }: Record<TransactionFields, string>): Promise<FormState> => {
      try {
        const result =
          props.mode === "create"
            ? await createTransaction(accountId, submitted)
            : await updateTransaction(props.transaction.id, editableFields(props.transaction), submitted);
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
  const errorText = (code?: TransactionErrorCode) =>
    code &&
    t(`errors.${code}`, {
      digits: minorUnit,
      example: (12.5).toFixed(minorUnit),
      max: MAX_TRANSACTION_DESCRIPTION_LENGTH,
    });

  const byName = new Intl.Collator(locale).compare;
  const typeCategories = categories
    .filter((category) => category.kind === values.type || category.kind === "transfer")
    .sort((a, b) => byName(a.name, b.name));
  const merchantHintId = `${fieldId("merchant")}-hint`;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset disabled={isPending}>
        <FormAlert message={error && t(`errors.${error}`)} />

        {accounts.length > 1 ? (
          <SelectField id={fieldId("accountId")} {...field("accountId")} label={t("form.account")}>
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </SelectField>
        ) : (
          <dl id={summaryId} className={props.mode === "edit" ? "grid gap-x-4 sm:grid-cols-2" : undefined}>
            <div className="mb-[18px]">
              <dt className="mb-[7px] text-[13px] font-semibold">{t("form.account")}</dt>{" "}
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
                    {format.number(props.transaction.amountMinor / 10 ** minorUnit, {
                      style: "currency",
                      currency: account.currencyCode,
                      signDisplay: "exceptZero",
                    })}
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
                      onChange={() =>
                        setValues((prev) => ({
                          ...prev,
                          type,
                          categoryId:
                            categories.find((category) => category.id === prev.categoryId)?.kind === "transfer"
                              ? prev.categoryId
                              : "",
                        }))
                      }
                      id={index === 0 ? fieldId("type") : undefined}
                      className="peer sr-only"
                    />
                    <span className="block cursor-pointer rounded-[8px] px-2 py-1.5 text-center text-[13px] font-medium text-muted-foreground peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                      {t(`form.types.${type}`)}
                    </span>
                  </label>
                ))}
              </div>
            </ChoiceGroup>

            <TextField
              id={fieldId("amount")}
              {...field("amount")}
              data-autofocus
              label={t("form.amount", { currency: account?.currencyCode ?? "" })}
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

        {props.mode === "create" && (
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
        )}

        <div className="grid gap-x-4 sm:grid-cols-2">
          <TextField
            id={fieldId("bookedOn")}
            {...field("bookedOn")}
            label={t("form.date")}
            type="date"
            required
            error={errorText(fieldErrors.bookedOn)}
          />
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
              focusAfterDeleteId={props.focusAfterDeleteId}
              onDeleted={props.onDeleted}
            />
          </div>
        )}
      </fieldset>
    </form>
  );
}
