"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import {
  PasswordVisibilityButton,
  formErrorFor,
  serverFieldErrors,
  useAuthErrorText,
  type FormErrorCode,
} from "@/components/auth/form-parts";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import { changePassword, deleteProfile } from "@/lib/actions/profile";
import type { ActionResponse } from "@/lib/types";
import {
  MIN_PASSWORD_LENGTH,
  validateChangePassword,
  type ChangePasswordFields,
  type ValidationErrorCode,
} from "@/lib/validation";

const PASSWORD_FIELDS = ["currentPassword", "newPassword", "confirmPassword"] as const;
const PASSWORD_AUTOCOMPLETE = {
  currentPassword: "current-password",
  newPassword: "new-password",
  confirmPassword: "new-password",
} as const;

const rowActionClassName = "cursor-pointer rounded-[6px] text-[13px] font-semibold hover:opacity-80 focus-ring";

type PasswordFieldErrors = Partial<Record<keyof ChangePasswordFields, ValidationErrorCode | "currentPasswordInvalid">>;

type ChangePasswordState = {
  fieldErrors: PasswordFieldErrors;
  error: FormErrorCode | { message: string } | null;
  done?: boolean;
};

const initialPasswordState: ChangePasswordState = { fieldErrors: {}, error: null };

/** "Change" on the password row: opens the change-password dialog. */
export function ChangePasswordButton() {
  const t = useTranslations("profile.password");
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label={t("title")}
        onClick={() => setIsOpen(true)}
        className={`${rowActionClassName} text-primary dark:text-accent-foreground`}
      >
        {t("change")}
      </button>
      <Modal open={isOpen} title={t("title")} onClose={() => setIsOpen(false)} busy={isBusy}>
        {/* Mounted only while open, so reopening starts empty without old errors. */}
        {isOpen && <ChangePasswordForm onCancel={() => setIsOpen(false)} onBusyChange={setIsBusy} />}
      </Modal>
    </>
  );
}

/** The change-password form. The backend signs out every device, so success opens /login. */
function ChangePasswordForm({
  onCancel,
  onBusyChange,
}: {
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const t = useTranslations();
  const errorText = useAuthErrorText();
  const router = useRouter();
  const [values, setValues] = useState<ChangePasswordFields>({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [visibleFields, setVisibleFields] = useState<Partial<Record<keyof ChangePasswordFields, boolean>>>({});

  const [{ fieldErrors, error, done }, submitAction, isPending] = useActionState(
    async (_prev: ChangePasswordState, submitted: ChangePasswordFields): Promise<ChangePasswordState> => {
      const errors = validateChangePassword(submitted);
      if (Object.keys(errors).length > 0) return { fieldErrors: errors, error: null };

      let result: ActionResponse;
      try {
        result = await changePassword(submitted);
      } catch {
        // The action call itself failed (offline, Next server down).
        return { fieldErrors: {}, error: "network" };
      }
      if (result.success) {
        router.replace("/login?notice=passwordChanged");
        return { ...initialPasswordState, done: true };
      }
      if (result.status === 401) return { fieldErrors: { currentPassword: "currentPasswordInvalid" }, error: null };
      const serverErrors = serverFieldErrors(result.errors);
      if (Object.keys(serverErrors).length > 0) return { fieldErrors: serverErrors, error: null };
      if (result.status === 400) return { fieldErrors: {}, error: { message: result.message } };
      return { fieldErrors: {}, error: formErrorFor(result) };
    },
    initialPasswordState,
  );
  const isBusy = isPending || Boolean(done);

  // Like NameForm: the cleanup clears the dialog's busy flag when the form unmounts.
  useEffect(() => {
    onBusyChange(isBusy);
    return () => onBusyChange(false);
  }, [isBusy, onBusyChange]);

  // After a rejected submit, put keyboard focus on the first field with an error.
  useEffect(() => {
    const firstInvalidField = PASSWORD_FIELDS.find((field) => fieldErrors[field]);
    if (firstInvalidField) document.getElementById(firstInvalidField)?.focus();
  }, [fieldErrors]);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => submitAction(values));
      }}
    >
      <fieldset disabled={isBusy}>
        <p className="mb-4 text-sm text-muted-foreground">{t("profile.password.description")}</p>
        <FormAlert message={error && (typeof error === "string" ? errorText(error) : error.message)} />
        {PASSWORD_FIELDS.map((field) => (
          <TextField
            key={field}
            id={field}
            name={field}
            data-autofocus={field === "currentPassword" ? true : undefined}
            label={t(`profile.password.${field}`)}
            type={visibleFields[field] ? "text" : "password"}
            dir="ltr"
            autoComplete={PASSWORD_AUTOCOMPLETE[field]}
            hint={field === "newPassword" ? t("auth.passwordHint", { min: MIN_PASSWORD_LENGTH }) : undefined}
            value={values[field]}
            onChange={(event) => setValues((previous) => ({ ...previous, [field]: event.target.value }))}
            error={fieldErrors[field] && errorText(fieldErrors[field])}
            trailing={
              <PasswordVisibilityButton
                visible={Boolean(visibleFields[field])}
                onToggle={() => setVisibleFields((previous) => ({ ...previous, [field]: !previous[field] }))}
              />
            }
          >
            {field === "newPassword" && <PasswordStrength password={values.newPassword} />}
          </TextField>
        ))}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{isBusy ? t("profile.password.submitting") : t("profile.password.submit")}</Button>
        </div>
      </fieldset>
    </form>
  );
}

/** "Delete" on the delete-profile row: a two-step confirmation, then the backend deletes everything and /login opens. */
export function DeleteProfileButton() {
  const t = useTranslations("profile.deleteProfile");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // The dialog unmounts on cancel, so focus goes back to the button once it is gone.
  useEffect(() => {
    if (open || !returnFocus.current) return;
    buttonRef.current?.focus();
    returnFocus.current = false;
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t("title")}
        onClick={() => setOpen(true)}
        className={`${rowActionClassName} text-destructive`}
      >
        {t("button")}
      </button>
      {/* Mounted only while open, so it starts at the first step without an old error. */}
      {open && (
        <DeleteProfileDialog
          onCancel={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function DeleteProfileDialog({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("profile.deleteDialog");
  const errorText = useAuthErrorText();
  const router = useRouter();
  const [isFinalConfirmation, setIsFinalConfirmation] = useState(false);
  // "deleted" keeps the dialog busy while /login opens, since the session is already gone.
  const [deleteState, runDelete, isDeleting] = useActionState(
    async (): Promise<"deleted" | "network" | "generic" | null> => {
      try {
        const result = await deleteProfile();
        if (result.success) {
          router.replace("/login?notice=profileDeleted");
          return "deleted";
        }
        return formErrorFor(result) === "network" ? "network" : "generic";
      } catch {
        return "network";
      }
    },
    null,
  );
  const isBusy = isDeleting || deleteState === "deleted";

  return (
    // The final step is a new dialog (key), so focus starts on Cancel again and a second Enter can't confirm.
    <ConfirmDialog
      key={isFinalConfirmation ? "final" : "initial"}
      open
      title={t(isFinalConfirmation ? "finalTitle" : "title")}
      confirmLabel={isBusy ? t("confirming") : t(isFinalConfirmation ? "confirm" : "continue")}
      onConfirm={() => {
        if (isFinalConfirmation) startTransition(() => runDelete());
        else setIsFinalConfirmation(true);
      }}
      onCancel={onCancel}
      pending={isBusy}
      error={deleteState === "network" || deleteState === "generic" ? errorText(deleteState) : null}
    >
      {t(isFinalConfirmation ? "finalDescription" : "description")}
    </ConfirmDialog>
  );
}
