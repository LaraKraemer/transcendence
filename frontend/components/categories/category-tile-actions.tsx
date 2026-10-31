"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { formErrorFor } from "@/components/auth/form-parts";
import { CategoryForm } from "@/components/categories/category-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { countCategoryTransactions, deleteCategory } from "@/lib/actions/categories";
import type { Category } from "@/lib/types";

/**
 * Edit and Delete for one category tile, each in its own dialog. Like
 * AccountRowActions, the dialogs mount only while open, so they start fresh
 * each time. `headingId` is where focus goes after deleting, since the tile
 * disappears.
 */
export function CategoryTileActions({ category, headingId }: { category: Category; headingId: string }) {
  const t = useTranslations("categories");
  const [panel, setPanel] = useState<"none" | "edit" | "delete">("none");
  const [saving, setSaving] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  // Which button gets focus back when the open dialog closes.
  const returnFocusTo = useRef<"edit" | "delete" | null>(null);

  useEffect(() => {
    if (panel !== "none" || !returnFocusTo.current) return;
    (returnFocusTo.current === "edit" ? editButtonRef : deleteButtonRef).current?.focus();
    returnFocusTo.current = null;
  }, [panel]);

  // After a successful delete the tile (with its open modal dialog) unmounts, and
  // focus can only move once the dialog is gone (see AccountRowActions).
  const wasDeleted = useRef(false);
  useEffect(
    () => () => {
      if (wasDeleted.current) document.getElementById(headingId)?.focus();
    },
    [headingId],
  );

  function close(from: "edit" | "delete") {
    returnFocusTo.current = from;
    setPanel("none");
  }

  return (
    <>
      <div className="ms-auto flex shrink-0 gap-1.5">
        <IconButton
          ref={editButtonRef}
          label={t("actions.edit", { name: category.name })}
          variant="card"
          onClick={() => setPanel("edit")}
        >
          <Pencil size={15} aria-hidden />
        </IconButton>
        <IconButton
          ref={deleteButtonRef}
          label={t("actions.delete", { name: category.name })}
          variant="card-danger"
          onClick={() => setPanel("delete")}
        >
          <Trash2 size={15} aria-hidden />
        </IconButton>
      </div>

      {panel === "edit" && (
        // While saving, the modal can't be closed: a failure would have nowhere to show.
        <Modal open title={t("form.editTitle")} onClose={() => close("edit")} busy={saving}>
          <CategoryForm category={category} onDone={() => close("edit")} onPendingChange={setSaving} />
        </Modal>
      )}
      {panel === "delete" && (
        <DeleteDialog
          category={category}
          onDeleted={() => (wasDeleted.current = true)}
          onCancel={() => close("delete")}
        />
      )}
    </>
  );
}

/**
 * Asks before deleting, saying how many transactions use the category (they
 * are kept, without a category). Delete stays disabled until the count has loaded
 * or failed to load, so the warning is never skipped by a quick click.
 */
function DeleteDialog({
  category,
  onDeleted,
  onCancel,
}: {
  category: Category;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("categories");
  const announce = useAnnounce();
  // undefined while loading, null when the count couldn't be loaded.
  const [transactionCount, setTransactionCount] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let isCurrent = true;
    countCategoryTransactions(category.id).then(
      (count) => isCurrent && setTransactionCount(count),
      () => isCurrent && setTransactionCount(null),
    );
    return () => {
      isCurrent = false;
    };
  }, [category.id]);

  const [deleteError, runDelete, isDeleting] = useActionState(async (): Promise<"network" | "generic" | null> => {
    try {
      const result = await deleteCategory(category.id);
      if (result.success) {
        // Focus moves to the heading, which says nothing about the result, so say it here.
        announce(t("announcements.deleted", { name: category.name }));
        onDeleted();
        return null;
      }
      return formErrorFor(result) === "network" ? "network" : "generic";
    } catch {
      // The action call itself failed (offline, Next server down).
      return "network";
    }
  }, null);

  return (
    <ConfirmDialog
      open
      title={t("deleteDialog.title", { name: category.name })}
      confirmLabel={isDeleting ? t("deleteDialog.confirming") : t("deleteDialog.confirm")}
      onConfirm={() => startTransition(() => runDelete())}
      onCancel={onCancel}
      pending={isDeleting}
      confirmDisabled={transactionCount === undefined}
      error={deleteError && t(`errors.${deleteError}`)}
    >
      {transactionCount === undefined
        ? t("deleteDialog.counting")
        : transactionCount === null
          ? t("deleteDialog.unknownCount")
          : t("deleteDialog.description", { count: transactionCount })}
    </ConfirmDialog>
  );
}
