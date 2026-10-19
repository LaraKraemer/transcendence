"use client";

import { Archive } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { formErrorFor } from "@/components/auth/form-parts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAnnounce } from "@/components/ui/live-status";
import { archiveCategory } from "@/lib/actions/categories";

/**
 * Archive action for one category tile, with a confirmation dialog.
 * `headingId` is where focus goes after archiving, since the tile disappears.
 */
export function ArchiveCategoryButton({
  category,
  headingId,
}: {
  category: { id: string; name: string };
  headingId: string;
}) {
  const t = useTranslations("categories");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  // After a successful archive this tile (with its open modal dialog) unmounts.
  // Focus can only move once the dialog is gone, because a modal dialog makes
  // the rest of the page inert, so it happens in this unmount cleanup.
  const wasArchived = useRef(false);
  useEffect(
    () => () => {
      if (wasArchived.current) document.getElementById(headingId)?.focus();
    },
    [headingId],
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("archive", { name: category.name })}
        title={t("archive", { name: category.name })}
        className="ms-auto flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-card hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Archive size={15} aria-hidden />
      </button>
      {/* Mounted only while open, so a previous failure's error doesn't reappear. */}
      {open && (
        <ArchiveDialog
          category={category}
          onArchived={() => (wasArchived.current = true)}
          onCancel={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ArchiveDialog({
  category,
  onArchived,
  onCancel,
}: {
  category: { id: string; name: string };
  onArchived: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("categories");
  const announce = useAnnounce();
  const [archiveError, runArchive, isArchiving] = useActionState(async (): Promise<"network" | "generic" | null> => {
    try {
      const result = await archiveCategory(category.id);
      if (result.success) {
        // Focus moves to the heading, which says nothing about the result, so say it here.
        announce(t("announcements.archived", { name: category.name }));
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
      title={t("archiveDialog.title", { name: category.name })}
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
