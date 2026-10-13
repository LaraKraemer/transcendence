"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { createAccount } from "@/lib/actions/accounts";
import type { Currency } from "@/lib/types";
import {
  ACCOUNT_TYPES,
  MAX_ACCOUNT_NAME_LENGTH,
  isAccountErrorCode,
  type AccountErrorCode,
} from "@/lib/validation";

type AccountFields = "name" | "type" | "currencyCode" | "openingBalance";

// The field order on screen, used to focus the first invalid one.
const FIELD_IDS: Record<AccountFields, string> = {
  name: "account-name",
  type: "account-type",
  currencyCode: "account-currency",
  openingBalance: "account-opening-balance",
};

// Errors are stored as codes, so they re-translate if the language changes.
type CreateAccountState = {
  fieldErrors: Partial<Record<AccountFields, AccountErrorCode>>;
  error: "network" | "generic" | null;
};

const initialState: CreateAccountState = { fieldErrors: {}, error: null };

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
      currencies={currencies}
      onClose={() => {
        returnFocus.current = true;
        setIsOpen(false);
      }}
    />
  );
}

function AccountForm({ currencies, onClose }: { currencies: Currency[]; onClose: () => void }) {
  const t = useTranslations("accounts");
  const locale = useLocale();
  const [values, setValues] = useState<Record<AccountFields, string>>(() => ({
    name: "",
    type: "checking",
    currencyCode: currencies.some((c) => c.code === DEFAULT_CURRENCY) ? DEFAULT_CURRENCY : (currencies[0]?.code ?? ""),
    openingBalance: "",
  }));
  const field = (name: AccountFields) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((prev) => ({ ...prev, [name]: e.target.value })),
  });

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: CreateAccountState, submitted: Record<AccountFields, string>): Promise<CreateAccountState> => {
      try {
        const result = await createAccount(submitted);
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
    const firstInvalid = (Object.keys(FIELD_IDS) as AccountFields[]).find((name) => fieldErrors[name]);
    if (firstInvalid) document.getElementById(FIELD_IDS[firstInvalid])?.focus();
  }, [fieldErrors]);

  // Currency names in the user's language; the catalogue's names are English.
  const currencyNames = new Intl.DisplayNames(locale, { type: "currency" });
  const minorUnit = currencies.find((c) => c.code === values.currencyCode)?.minorUnit ?? 2;
  const errorText = (code: AccountErrorCode) =>
    t(`errors.${code}`, { digits: minorUnit, example: (12.5).toFixed(minorUnit) });

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="create-account-heading"
      // bg-card, not bg-muted: red error text only reaches 4.5:1 contrast on the card colour.
      className="mt-2 basis-full rounded-[11px] border border-border bg-card p-5"
    >
      <fieldset disabled={isPending}>
        <h3 id="create-account-heading" className="mb-4 text-sm font-semibold">
          {t("form.title")}
        </h3>
        <FormAlert message={error && t(`errors.${error}`)} />

        <TextField
          id={FIELD_IDS.name}
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
            id={FIELD_IDS.type}
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

          <SelectField
            id={FIELD_IDS.currencyCode}
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
        </div>

        <TextField
          id={FIELD_IDS.openingBalance}
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

        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" variant="primary">
            {isPending ? t("form.submitting") : t("form.submit")}
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
