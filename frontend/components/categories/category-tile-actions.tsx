"use client";

import { Check, Palette, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";

import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { CategoryPreview, ColorField } from "@/components/categories/category-form-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { countCategoryTransactions, deleteCategory, updateCategoryColor } from "@/lib/actions/categories";
import type { Category } from "@/lib/types";

const iconButtonClasses =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[9px] bg-card text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

type ActionError = "network" | "generic" | null;

/**
 * Change color and Delete for one category tile, each in its own dialog.
 * Like AccountRowActions, the dialogs mount only while open, so they start
 * fresh each time. `headingId` is where focus goes after deleting, since the
 * tile disappears.
 */
export function CategoryTileActions({ category, headingId }: { category: Category; headingId: string }) {
  const t = useTranslations("categories");
  const [panel, setPanel] = useState<"none" | "color" | "delete">("none");
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  // Which button gets focus back when the open dialog closes.
  const returnFocusTo = useRef<"color" | "delete" | null>(null);

  useEffect(() => {
    if (panel !== "none" || !returnFocusTo.current) return;
    (returnFocusTo.current === "color" ? colorButtonRef : deleteButtonRef).current?.focus();
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

  function close(from: "color" | "delete") {
    returnFocusTo.current = from;
    setPanel("none");
  }

  return (
    <>
      <div className="ms-auto flex shrink-0 gap-1.5">
        <button
          ref={colorButtonRef}
          type="button"
          onClick={() => setPanel("color")}
          aria-label={t("actions.editColor", { name: category.name })}
          title={t("actions.editColor", { name: category.name })}
          className={`${iconButtonClasses} hover:text-foreground`}
        >
          <Palette size={15} aria-hidden />
        </button>
        <button
          ref={deleteButtonRef}
          type="button"
          onClick={() => setPanel("delete")}
          aria-label={t("actions.delete", { name: category.name })}
          title={t("actions.delete", { name: category.name })}
          className={`${iconButtonClasses} hover:text-destructive`}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>

      {panel === "color" && <ColorDialog category={category} onClose={() => close("color")} />}
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

type ColorFormState = { colorInvalid: boolean; error: ActionError };
const initialColorState: ColorFormState = { colorInvalid: false, error: null };

/** Picks a new color with a live preview and saves it with `PATCH /categories/:id`. */
function ColorDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const t = useTranslations("categories");
  const announce = useAnnounce();
  const idPrefix = useId();
  const savedColor = category.color.toUpperCase();
  const [color, setColor] = useState(savedColor);

  const [{ colorInvalid, error }, submitAction, isPending] = useActionState(
    async (_prev: ColorFormState, submitted: string): Promise<ColorFormState> => {
      // Unchanged: nothing to save, and the backend would only repeat what it has.
      if (submitted === savedColor) {
        onClose();
        return initialColorState;
      }
      try {
        const result = await updateCategoryColor(category.id, submitted);
        if (result.success) {
          announce(t("announcements.colorSaved", { name: category.name }));
          onClose();
          return initialColorState;
        }
        if (result.errors?.color) return { colorInvalid: true, error: null };
        return { colorInvalid: false, error: formErrorFor(result) === "network" ? "network" : "generic" };
      } catch {
        // The action call itself failed (offline, Next server down).
        return { colorInvalid: false, error: "network" };
      }
    },
    initialColorState,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => submitAction(color));
  }

  return (
    // The preview already shows the name, so the title is only for screen readers.
    <Modal open title={t("colorDialog.title", { name: category.name })} titleHidden onClose={onClose} busy={isPending}>
      <form onSubmit={handleSubmit} noValidate>
        <fieldset disabled={isPending} className="min-w-0">
          {/* pe-11 keeps a long name clear of the modal's ✕. */}
          <div className="pe-11">
            <CategoryPreview name={category.name} kind={category.kind} icon={category.icon} color={color} />
          </div>
          <FormAlert message={error && t(`errors.${error}`)} />
          <ColorField
            value={color}
            onChange={setColor}
            error={colorInvalid ? t("errors.colorInvalid") : undefined}
            idPrefix={`${idPrefix}-color`}
          />
          <div className="mt-2 flex gap-3">
            <Button variant="outline" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" variant="success">
              <Check size={16} aria-hidden />
              {isPending ? t("form.submitting") : t("colorDialog.submit")}
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
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

  const [deleteError, runDelete, isDeleting] = useActionState(async (): Promise<ActionError> => {
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
