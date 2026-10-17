"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { createAccount, updateAccount } from "@/lib/actions/accounts";
import type { Account, Currency } from "@/lib/types";
import {
  ACCOUNT_TYPES,
  MAX_ACCOUNT_NAME_LENGTH,
  isAccountErrorCode,
  type AccountErrorCode,
} from "@/lib/validation";

type AccountFields = "name" | "type" | "currencyCode" | "openingBalance" | "institution" | "accountRef";

// The field order on screen, used to focus the first invalid one.
const FIELD_ORDER: AccountFields[] = ["name", "type", "currencyCode", "openingBalance", "institution", "accountRef"];

// Errors are stored as codes, so they re-translate if the language changes.
type FormState = {
  fieldErrors: Partial<Record<AccountFields, AccountErrorCode>>;
  error: "network" | "generic" | null;
};

const initialState: FormState = { fieldErrors: {}, error: null };

// The backend's default account currency.
const DEFAULT_CURRENCY = "EUR";

/**
 * "New account" button that expands into the create-account form. On success
 * the server action refreshes the page, so the new account appears in the list.
 */
export function CreateAccountForm({ currencies }: { currencies: Currency[] }) {
  const t = useTranslations("accounts");
  const [isOpen, setIsOpen] = useState(false);
  // Set when the form closes (Cancel or success), so keyboard focus returns to
  // the button instead of falling back to <body>.
  const returnFocus = useRef(false);

  if (!isOpen) {
    return (
      <button
        type="button"
        ref={(button) => {
          if (button && returnFocus.current) {
            returnFocus.current = false;
            button.focus();
          }
        }}
        onClick={() => setIsOpen(true)}
        className="ms-auto flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-success-bg px-3 py-1.75 text-[13px] font-semibold text-success hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Plus size={14} aria-hidden />
        {t("newAccount")}
      </button>
    );
  }

  // Unmounted on close, so reopening starts with empty values and no stale errors.
  return (
    <AccountForm
      mode="create"
      currencies={currencies}
      onClose={() => {
        returnFocus.current = true;
        setIsOpen(false);
      }}
    />
  );
}

type AccountFormProps = { onClose: () => void } & (
  | { mode: "create"; currencies: Currency[] }
  | { mode: "edit"; account: Account }
);

/**
 * The account form, shared by create (name, type, currency, opening balance)
 * and edit (name, type, institution, account reference; currency and opening
 * balance stay as they are). Validation, error display and focus handling are the same.
 */
export function AccountForm(props: AccountFormProps) {
  const { mode, onClose } = props;
  const currencies = mode === "create" ? props.currencies : [];
  const t = useTranslations("accounts");
  const locale = useLocale();
  // Unique per form: the create form and an edit form can be open at the same time.
  const idPrefix = useId();
  const fieldId = (name: AccountFields) => `${idPrefix}-${name}`;

  const [values, setValues] = useState<Record<AccountFields, string>>(() =>
    mode === "create"
      ? {
          name: "",
          type: "checking",
          currencyCode: currencies.some((c) => c.code === DEFAULT_CURRENCY)
            ? DEFAULT_CURRENCY
            : (currencies[0]?.code ?? ""),
          openingBalance: "",
          institution: "",
          accountRef: "",
        }
      : {
          name: props.account.name,
          type: props.account.type,
          currencyCode: props.account.currencyCode,
          openingBalance: "",
          institution: props.account.institution ?? "",
          accountRef: props.account.accountRef ?? "",
        },
  );
  const field = (name: AccountFields) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((prev) => ({ ...prev, [name]: e.target.value })),
  });

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, submitted: Record<AccountFields, string>): Promise<FormState> => {
      try {
        const result =
          mode === "create"
            ? await createAccount({
                name: submitted.name,
                type: submitted.type,
                currencyCode: submitted.currencyCode,
                openingBalance: submitted.openingBalance,
              })
            : await updateAccount(
                props.account.id,
                // What the form was opened with, so only fields the user changed are sent.
                {
                  name: props.account.name,
                  type: props.account.type,
                  institution: props.account.institution,
                  accountRef: props.account.accountRef,
                },
                {
                name: submitted.name,
                type: submitted.type,
                institution: submitted.institution,
                accountRef: submitted.accountRef,
                },
              );
        if (result.success) {
          onClose();
          return initialState;
        }
        // Keep the first translatable code per field, as the auth forms do.
        const fieldErrors = Object.fromEntries(
          Object.entries(result.errors ?? {})
            .map(([field, codes]) => [field, codes.find(isAccountErrorCode)] as const)
            .filter(([, code]) => code),
        );
        return Object.keys(fieldErrors).length > 0
          ? { fieldErrors, error: null }
          : { fieldErrors: {}, error: formErrorFor(result) === "network" ? "network" : "generic" };
      } catch {
        return { fieldErrors: {}, error: "generic" };
      }
    },
    initialState,
  );

  // Submitting through onSubmit rather than <form action>: React resets a form
  // after every action, and the <select>s then show their first option while
  // state still holds the user's choice, so a retry would send different values.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => submitAction(values));
  }

  // After a failed submit, move keyboard focus to the first invalid field.
  useEffect(() => {
    const firstInvalid = FIELD_ORDER.find((name) => fieldErrors[name]);
    if (firstInvalid) document.getElementById(`${idPrefix}-${firstInvalid}`)?.focus();
  }, [fieldErrors, idPrefix]);

  // Currency names in the user's language; the catalogue's names are English.
  const currencyNames = new Intl.DisplayNames(locale, { type: "currency" });
  const minorUnit = currencies.find((c) => c.code === values.currencyCode)?.minorUnit ?? 2;
  const errorText = (code: AccountErrorCode) =>
    t(`errors.${code}`, { digits: minorUnit, example: (12.5).toFixed(minorUnit) });
  const headingId = `${idPrefix}-heading`;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={headingId}
      // bg-card, not bg-muted: red error text only reaches 4.5:1 contrast on the card colour.
      className="mt-2 basis-full rounded-[11px] border border-border bg-card p-5"
    >
      <fieldset disabled={isPending}>
        <h3 id={headingId} className="mb-4 text-sm font-semibold">
          {mode === "create" ? t("form.title") : t("form.editTitle")}
        </h3>
        <FormAlert message={error && t(`errors.${error}`)} />

        <TextField
          id={fieldId("name")}
          {...field("name")}
          label={t("form.name")}
          type="text"
          required
          autoFocus
          maxLength={MAX_ACCOUNT_NAME_LENGTH}
          placeholder={t("form.namePlaceholder")}
          error={fieldErrors.name && errorText(fieldErrors.name)}
        />

        <div className="grid gap-x-4 sm:grid-cols-2">
          <SelectField
            id={fieldId("type")}
            {...field("type")}
            label={t("form.type")}
            error={fieldErrors.type && errorText(fieldErrors.type)}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </SelectField>

          {mode === "create" ? (
            <SelectField
              id={fieldId("currencyCode")}
              {...field("currencyCode")}
              label={t("form.currency")}
              error={fieldErrors.currencyCode && errorText(fieldErrors.currencyCode)}
            >
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} — {currencyNames.of(currency.code) ?? currency.name}
                </option>
              ))}
            </SelectField>
          ) : (
            <TextField
              id={fieldId("institution")}
              {...field("institution")}
              label={t("form.institution")}
              type="text"
              placeholder={t("form.institutionPlaceholder")}
            />
          )}
        </div>

        {mode === "create" ? (
          <TextField
            id={fieldId("openingBalance")}
            {...field("openingBalance")}
            label={t("form.openingBalance")}
            // Text, not number: a number input submits "" for input it can't parse
            // (e.g. "12."), which would silently save 0. The server parses the text
            // and the currency decides how many decimals are allowed (JPY 0, KWD 3).
            type="text"
            dir="ltr"
            inputMode={minorUnit === 0 ? "numeric" : "decimal"}
            autoComplete="off"
            placeholder={(0).toFixed(minorUnit)}
            error={fieldErrors.openingBalance && errorText(fieldErrors.openingBalance)}
          />
        ) : (
          <TextField
            id={fieldId("accountRef")}
            {...field("accountRef")}
            label={t("form.accountRef")}
            type="text"
            // Account numbers and IBANs read left to right in every language.
            dir="ltr"
            autoComplete="off"
            placeholder={t("form.accountRefPlaceholder")}
          />
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {mode === "create"
              ? isPending
                ? t("form.submitting")
                : t("form.submit")
              : isPending
                ? t("form.saving")
                : t("form.save")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/** A native <select> styled like TextField, with its label and inline error. */
function SelectField({
  id,
  label,
  error,
  children,
  ...selectProps
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "className"> & {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="mb-[18px]">
      <label htmlFor={id} className="mb-[7px] block text-[13px] font-semibold">
        {label}
      </label>
      {/* The native arrow can't be spaced from the edge, so it's hidden and drawn
          as an icon at the input's own inline padding (mirrors in RTL). */}
      <div className="relative">
        <select
          id={id}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`w-full cursor-pointer appearance-none rounded-[11px] border bg-field py-[13px] ps-[15px] pe-10 text-sm outline-none focus:ring-2 focus:ring-ring ${
            error ? "border-destructive" : "border-input"
          }`}
          {...selectProps}
        >
          {children}
        </select>
        <ChevronDown
          size={16}
          aria-hidden
          className="pointer-events-none absolute end-[15px] top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
