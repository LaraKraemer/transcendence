"use client";

import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useRef, useState, type ReactNode } from "react";

import { AccountForm } from "@/components/accounts/account-form";
import { formErrorFor } from "@/components/auth/form-parts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAnnounce } from "@/components/ui/live-status";
import { deleteAccount, setAccountArchived } from "@/lib/actions/accounts";
import type { Account } from "@/lib/types";

/** Small row action button; the transactions list uses it too, so both lists look alike. */
export const iconButtonClasses =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * Edit expands the shared account form, containing Archive and Delete actions.
 * Both destructive actions ask for confirmation before changing the account.
 * Rendered inside the row's flex container, so the form can take a full line.
 * `headingId` is where focus goes after archiving, since this row disappears.
 */
export function AccountRowActions({
  account,
  minorUnit,
  headingId,
}: {
  account: Account;
  minorUnit: number;
  headingId: string;
}) {
  const t = useTranslations("accounts");
  const [panel, setPanel] = useState<"none" | "edit" | "archive">("none");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  // Which button gets focus back when the open panel closes.
  const returnFocusTo = useRef<"edit" | "archive" | null>(null);

  useEffect(() => {
    if (!returnFocusTo.current) return;
    (returnFocusTo.current === "edit" ? editButtonRef : archiveButtonRef).current?.focus();
    returnFocusTo.current = null;
  }, [panel]);

  // After a successful archive the row (with its open modal dialog) unmounts.
  // Focus can only move once the dialog is gone, because a modal dialog makes the
  // rest of the page inert, so it happens in this unmount cleanup.
  const wasArchived = useRef(false);
  useEffect(
    () => () => {
      if (wasArchived.current) document.getElementById(headingId)?.focus();
    },
    [headingId],
  );

  function close(from: "edit" | "archive") {
    returnFocusTo.current = from;
    setPanel(from === "archive" ? "edit" : "none");
  }

  return (
    <>
      {panel === "none" && (
        // On narrow screens the buttons move to their own line, so the name isn't squeezed.
        <div className="flex basis-full justify-end gap-1.5 sm:basis-auto">
          <button
            ref={editButtonRef}
            type="button"
            onClick={() => setPanel("edit")}
            aria-label={t("actions.edit", { name: account.name })}
            title={t("actions.edit", { name: account.name })}
            className={`${iconButtonClasses} hover:text-foreground`}
          >
            <Pencil size={15} aria-hidden />
          </button>
        </div>
      )}

      {panel !== "none" && (
        <AccountForm
          mode="edit"
          account={account}
          minorUnit={minorUnit}
          onClose={() => close("edit")}
          editActions={
            <div className="ms-auto flex shrink-0 items-center gap-1.5">
              <button
                ref={archiveButtonRef}
                type="button"
                onClick={() => setPanel("archive")}
                aria-label={t("actions.archive", { name: account.name })}
                title={t("actions.archive", { name: account.name })}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-muted text-muted-foreground transition-colors hover:bg-amber-100 hover:text-amber-900 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none dark:hover:bg-amber-950 dark:hover:text-amber-200"
              >
                <Archive size={15} aria-hidden />
              </button>
              <DeleteAccountButton account={account} headingId={headingId} />
            </div>
          }
        />
      )}

      {/* Mounted only while open, so a previous failure's error doesn't reappear. */}
      {panel === "archive" && (
        <ArchiveDialog
          account={account}
          onArchived={() => (wasArchived.current = true)}
          onCancel={() => close("archive")}
        />
      )}
    </>
  );
}

/**
 * Unarchive for one archived account row. No confirmation: restoring loses nothing.
 * On success the row moves to the active list, so focus goes to `headingId`.
 */
export function UnarchiveButton({ account, headingId }: { account: Account; headingId: string }) {
  const t = useTranslations("accounts");
  const announce = useAnnounce();

  // Same as archiving: the row unmounts after the refresh, so focus moves in the cleanup.
  const wasRestored = useRef(false);
  useEffect(
    () => () => {
      if (wasRestored.current) document.getElementById(headingId)?.focus();
    },
    [headingId],
  );

  const [restoreError, runRestore, isRestoring] = useActionState(async (): Promise<"network" | "generic" | null> => {
    try {
      const result = await setAccountArchived(account.id, false);
      if (result.success) {
        announce(t("announcements.restored", { name: account.name }));
        wasRestored.current = true;
        return null;
      }
      return formErrorFor(result) === "network" ? "network" : "generic";
    } catch {
      return "network";
    }
  }, null);

  return (
    <div className="flex basis-full flex-wrap items-center justify-end gap-x-3 gap-y-1 sm:basis-auto">
      {restoreError && (
        <p role="alert" className="text-[13px] text-destructive">
          {t(`errors.${restoreError}`)}
        </p>
      )}
      {/* aria-disabled, not disabled: a disabled button loses keyboard focus. */}
      <button
        type="button"
        onClick={() => !isRestoring && startTransition(() => runRestore())}
        aria-disabled={isRestoring}
        aria-label={t("actions.unarchive", { name: account.name })}
        title={t("actions.unarchive", { name: account.name })}
        className={`${iconButtonClasses} hover:text-foreground aria-disabled:cursor-wait aria-disabled:opacity-60`}
      >
        <ArchiveRestore size={15} aria-hidden />
      </button>
      <DeleteAccountButton account={account} headingId={headingId} />
    </div>
  );
}

function ArchiveDialog({
  account,
  onArchived,
  onCancel,
}: {
  account: Account;
  onArchived: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("accounts");
  const announce = useAnnounce();
  const [archiveError, runArchive, isArchiving] = useActionState(async (): Promise<"network" | "generic" | null> => {
    try {
      const result = await setAccountArchived(account.id, true);
      if (result.success) {
        // Focus moves to the heading, which says nothing about the result, so say it here.
        announce(t("announcements.archived", { name: account.name }));
        onArchived();
        return null;
      }
      return formErrorFor(result) === "network" ? "network" : "generic";
    } catch {
      // The action call itself failed (offline, Next server down): show it in the dialog.
      return "network";
    }
  }, null);

  return (
    <ConfirmDialog
      open
      title={t.rich("archiveDialog.title", {
        name: account.name,
        account: (name) => <bdi className="rounded bg-muted px-1.5 py-0.5 text-foreground">{name}</bdi>,
      })}
      confirmLabel={isArchiving ? t("archiveDialog.confirming") : t("archiveDialog.confirm")}
      onConfirm={() => startTransition(() => runArchive())}
      onCancel={onCancel}
      pending={isArchiving}
      error={archiveError && t(`errors.${archiveError}`)}
    >
      {t("archiveDialog.description")}
    </ConfirmDialog>
  );
}

/** Shared permanent deletion action for active and archived account rows. */
function DeleteAccountButton({ account, headingId }: { account: Account; headingId: string }) {
  const t = useTranslations("accounts");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const wasDeleted = useRef(false);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    buttonRef.current?.focus();
    returnFocus.current = false;
  }, [open]);

  useEffect(
    () => () => {
      if (wasDeleted.current) document.getElementById(headingId)?.focus();
    },
    [headingId],
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("actions.delete", { name: account.name })}
        title={t("actions.delete", { name: account.name })}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-danger-bg text-danger-fg transition-colors hover:bg-destructive hover:text-white focus-visible:ring-2 focus-visible:ring-danger-fg focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none"
      >
        <Trash2 size={15} aria-hidden />
      </button>
      {open && (
        <DeleteAccountDialog
          account={account}
          onDeleted={() => (wasDeleted.current = true)}
          onCancel={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** Keeps failures in the confirmation dialog and requires an explicit destructive click. */
function DeleteAccountDialog({
  account,
  onDeleted,
  onCancel,
}: {
  account: Account;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("accounts");
  const announce = useAnnounce();
  const [isFinalConfirmation, setIsFinalConfirmation] = useState(false);
  const [deleteError, runDelete, isDeleting] = useActionState(async (): Promise<"network" | "generic" | null> => {
    try {
      const result = await deleteAccount(account.id);
      if (result.success) {
        announce(t("announcements.deleted", { name: account.name }));
        onDeleted();
        return null;
      }
      return formErrorFor(result) === "network" ? "network" : "generic";
    } catch {
      return "network";
    }
  }, null);

  const accountNameValues = {
    name: account.name,
    account: (name: ReactNode) => (
      <bdi className="rounded bg-muted px-1.5 py-0.5 text-foreground">{name}</bdi>
    ),
  };

  return (
    <ConfirmDialog
      key={isFinalConfirmation ? "final" : "initial"}
      open
      title={t.rich(isFinalConfirmation ? "deleteDialog.finalTitle" : "deleteDialog.title", accountNameValues)}
      confirmLabel={
        isDeleting
          ? t("deleteDialog.confirming")
          : t(isFinalConfirmation ? "deleteDialog.confirm" : "deleteDialog.continue")
      }
      onConfirm={() => {
        if (isFinalConfirmation) startTransition(() => runDelete());
        else setIsFinalConfirmation(true);
      }}
      onCancel={onCancel}
      pending={isDeleting}
      error={deleteError && t(`errors.${deleteError}`)}
    >
      {t.rich(isFinalConfirmation ? "deleteDialog.finalDescription" : "deleteDialog.description", accountNameValues)}
    </ConfirmDialog>
  );
}
