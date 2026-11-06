"use client";

import { ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useId, useState, useTransition } from "react";

import { codeInputProps, twoFactorErrorFor, useAuthErrorText, type FormErrorCode } from "@/components/auth/form-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import {
  disableTwoFactor,
  enableTwoFactor,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from "@/lib/actions/two-factor";
import type { User } from "@/lib/types";

/** Groups the secret in fours ("ABCD EFGH …") so it is easier to type by hand. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * The "Two-factor authentication" card on the profile. Enabling asks the backend for a secret first
 * (so a server without the encryption key shows its error here, not in an empty dialog), then the
 * dialog walks through scanning, confirming a code and saving the recovery codes. Disabling asks for
 * the password (accounts that have one) and a code.
 */
export function TwoFactorSection({ user }: { user: User }) {
  const t = useTranslations("profile.twoFactor");
  const errorText = useAuthErrorText();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [isDisabling, setIsDisabling] = useState(false);
  const [isDialogBusy, setIsDialogBusy] = useState(false);
  const [startError, setStartError] = useState<FormErrorCode | null>(null);
  const [isStarting, startStarting] = useTransition();

  function startSetup() {
    setStartError(null);
    startStarting(async () => {
      try {
        const result = await startTwoFactorSetup();
        if (result.success && result.setup) setSetup(result.setup);
        else setStartError(twoFactorErrorFor(result, "invalidCode"));
      } catch {
        setStartError("network");
      }
    });
  }

  return (
    <>
      <Card as="section" aria-labelledby="two-factor" className="mt-5 p-[18px] lg:max-w-[60%] lg:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck size={18} aria-hidden className="text-muted-foreground" />
          <h2 id="two-factor" className="text-base font-semibold">
            {t("title")}
          </h2>
          <Badge tone={user.twoFactorEnabled ? "success" : "neutral"} className="ms-auto">
            {user.twoFactorEnabled ? t("on") : t("off")}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {user.twoFactorEnabled ? t("descriptionOn") : t("descriptionOff")}
        </p>
        <div className="mt-4">
          <FormAlert message={startError && errorText(startError)} />
          {user.twoFactorEnabled ? (
            <Button className="w-auto px-5" variant="outline" onClick={() => setIsDisabling(true)}>
              {t("disable")}
            </Button>
          ) : (
            // aria-disabled, not disabled: a disabled button drops keyboard focus while the secret is created.
            <Button className="w-auto px-5" aria-disabled={isStarting} onClick={() => !isStarting && startSetup()}>
              {isStarting ? t("preparing") : t("enable")}
            </Button>
          )}
        </div>
      </Card>

      <Modal
        open={setup !== null}
        title={t("enableDialog.title")}
        onClose={() => setSetup(null)}
        busy={isDialogBusy}
      >
        {/* Mounted only while open, so a second try starts with a fresh secret and no old state. */}
        {setup && <EnableDialog setup={setup} onDone={() => setSetup(null)} onBusyChange={setIsDialogBusy} />}
      </Modal>

      <Modal
        open={isDisabling}
        title={t("disableDialog.title")}
        onClose={() => setIsDisabling(false)}
        busy={isDialogBusy}
      >
        {isDisabling && (
          <DisableDialog
            hasPassword={user.hasPassword}
            onDone={() => setIsDisabling(false)}
            onBusyChange={setIsDialogBusy}
          />
        )}
      </Modal>
    </>
  );
}

type DialogProps = { onDone: () => void; onBusyChange: (busy: boolean) => void };

/** Scan the QR code (or type the secret), confirm a code, then show the recovery codes once. */
function EnableDialog({ setup, onDone, onBusyChange }: DialogProps & { setup: TwoFactorSetup }) {
  const t = useTranslations("profile.twoFactor");
  const errorText = useAuthErrorText();
  const announce = useAnnounce();
  const codeId = useId();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [hasSaved, setHasSaved] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    // Loaded here, not at the top, so the QR library stays out of the pages that never open this dialog.
    import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192 }).then(setQrUrl),
    );
  }, [setup.otpauthUri]);

  const [error, submitAction, isPending] = useActionState(
    async (_previous: FormErrorCode | null, submitted: string): Promise<FormErrorCode | null> => {
      try {
        const result = await enableTwoFactor(submitted);
        if (result.success && result.recoveryCodes) {
          setRecoveryCodes(result.recoveryCodes);
          announce(t("announcements.enabled"));
          return null;
        }
        return twoFactorErrorFor(result, "invalidCode");
      } catch {
        return "network";
      }
    },
    null,
  );

  // The recovery codes are shown once: the dialog can't be dismissed until the user confirms they saved them.
  const isBusy = isPending || recoveryCodes !== null;
  useEffect(() => {
    onBusyChange(isBusy);
    return () => onBusyChange(false);
  }, [isBusy, onBusyChange]);

  // After a rejected code, put keyboard focus back on the field.
  useEffect(() => {
    if (error) document.getElementById(codeId)?.focus();
  }, [error, codeId]);

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText((recoveryCodes ?? []).join("\n"));
      setIsCopied(true);
      announce(t("announcements.copied"));
    } catch {
      announce(t("announcements.copyFailed"));
    }
  }

  function downloadCodes() {
    const text = `${t("recovery.fileHeader")}\n\n${(recoveryCodes ?? []).join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (recoveryCodes) {
    return (
      <div>
        <p className="mb-3 text-sm">{t("recovery.intro")}</p>
        <ul
          dir="ltr"
          aria-label={t("recovery.listLabel")}
          className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-[11px] bg-muted p-4 font-mono text-sm rtl:text-right"
        >
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}>{recoveryCode}</li>
          ))}
        </ul>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button className="w-auto px-4" variant="outline" onClick={copyCodes}>
            {isCopied ? t("recovery.copied") : t("recovery.copy")}
          </Button>
          <Button className="w-auto px-4" variant="outline" onClick={downloadCodes}>
            {t("recovery.download")}
          </Button>
        </div>
        <label className="mb-4 flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={hasSaved}
            onChange={(event) => setHasSaved(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
            data-autofocus
          />
          {t("recovery.saved")}
        </label>
        <Button disabled={!hasSaved} onClick={onDone}>
          {t("recovery.done")}
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => submitAction(code));
      }}
    >
      <fieldset disabled={isPending}>
        <p className="mb-3 text-sm">{t("enableDialog.scan")}</p>
        {/* Always a white tile: scanners need a dark code on a light background, also in dark mode. */}
        <div className="mx-auto mb-3 flex size-[200px] items-center justify-center rounded-[11px] bg-white">
          {qrUrl && (
            // A data URL made in the browser; next/image has nothing to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrUrl} alt={t("enableDialog.qrAlt")} width={192} height={192} />
          )}
        </div>
        <p className="mb-1 text-xs text-muted-foreground">{t("enableDialog.secretLabel")}</p>
        <p dir="ltr" className="mb-4 font-mono text-sm break-all select-all rtl:text-right">
          {groupSecret(setup.secret)}
        </p>
        <FormAlert message={error && error !== "invalidCode" ? errorText(error) : null} />
        <TextField
          id={codeId}
          name="code"
          label={t("enableDialog.codeLabel")}
          hint={t("enableDialog.codeHint")}
          {...codeInputProps("code")}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={error === "invalidCode" ? errorText(error) : undefined}
        />
        <div className="flex gap-3">
          <Button variant="outline" onClick={onDone}>
            {t("cancel")}
          </Button>
          <Button type="submit">{isPending ? t("enableDialog.confirming") : t("enableDialog.confirm")}</Button>
        </div>
      </fieldset>
    </form>
  );
}

type DisableInput = { password: string; code: string; kind: "code" | "recovery" };

/** Turns 2FA off: the password (when the account has one) plus an authenticator code or a recovery code. */
function DisableDialog({ hasPassword, onDone, onBusyChange }: DialogProps & { hasPassword: boolean }) {
  const t = useTranslations("profile.twoFactor");
  const errorText = useAuthErrorText();
  const announce = useAnnounce();
  const passwordId = useId();
  const codeId = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"code" | "recovery">("code");

  const [error, submitAction, isPending] = useActionState(
    async (_previous: FormErrorCode | null, input: DisableInput): Promise<FormErrorCode | null> => {
      try {
        const result = await disableTwoFactor({
          ...(hasPassword ? { password: input.password } : {}),
          ...(input.kind === "code" ? { code: input.code } : { recoveryCode: input.code }),
        });
        if (result.success) {
          announce(t("announcements.disabled"));
          onDone();
          return null;
        }
        return twoFactorErrorFor(result, "invalidPasswordOrCode");
      } catch {
        return "network";
      }
    },
    null,
  );

  useEffect(() => {
    onBusyChange(isPending);
    return () => onBusyChange(false);
  }, [isPending, onBusyChange]);

  // After a rejected attempt, put keyboard focus back on the first field.
  useEffect(() => {
    if (error) document.getElementById(hasPassword ? passwordId : codeId)?.focus();
  }, [error, hasPassword, passwordId, codeId]);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => submitAction({ password, code, kind }));
      }}
    >
      <fieldset disabled={isPending}>
        <p className="mb-4 text-sm">{t("disableDialog.intro")}</p>
        <FormAlert message={error && errorText(error)} />
        {hasPassword && (
          <TextField
            id={passwordId}
            name="password"
            label={t("disableDialog.password")}
            type="password"
            dir="ltr"
            autoComplete="current-password"
            data-autofocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
        <TextField
          key={kind}
          id={codeId}
          name={kind === "code" ? "code" : "recoveryCode"}
          label={kind === "code" ? t("disableDialog.code") : t("disableDialog.recoveryCode")}
          {...codeInputProps(kind)}
          {...(hasPassword ? {} : { "data-autofocus": true })}
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setKind(kind === "code" ? "recovery" : "code");
            setCode("");
          }}
          className="mb-5 cursor-pointer rounded-[6px] text-[13px] font-semibold text-primary hover:opacity-80 focus-ring dark:text-accent-foreground"
        >
          {kind === "code" ? t("disableDialog.useRecovery") : t("disableDialog.useAuthenticator")}
        </button>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onDone}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="danger">
            {isPending ? t("disableDialog.disabling") : t("disable")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
