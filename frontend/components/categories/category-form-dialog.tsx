"use client";

import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";

import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { CATEGORY_ICON_KEYS, CategoryIcon } from "@/components/categories/category-icon";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import { createCategory } from "@/lib/actions/categories";
import {
  CATEGORY_KINDS,
  HEX_COLOR_PATTERN,
  MAX_CATEGORY_NAME_LENGTH,
  isCategoryErrorCode,
  readableOn,
  type CategoryErrorCode,
  type CategoryKind,
} from "@/lib/validation";

// The swatches from docs/design/desktop/categories.html; any other #RRGGBB can be typed in.
const SWATCHES = [
  { name: "navy", hex: "#1E3352" },
  { name: "green", hex: "#15803D" },
  { name: "violet", hex: "#7C3AED" },
  { name: "amber", hex: "#B45309" },
  { name: "blue", hex: "#2563EB" },
  { name: "teal", hex: "#0F766E" },
  { name: "rose", hex: "#BE123C" },
] as const;

type CategoryFields = "name" | "icon" | "color" | "kind";
const FIELD_ORDER: CategoryFields[] = ["name", "kind", "icon", "color"];

type FormState = {
  fieldErrors: Partial<Record<CategoryFields, CategoryErrorCode>>;
  error: "network" | "generic" | null;
};
const initialState: FormState = { fieldErrors: {}, error: null };

/**
 * "New category" trigger plus its modal form. `variant="tile"` is the dashed
 * "Add category" tile at the end of a group, which preselects that group's kind.
 */
export function NewCategoryButton({
  variant,
  defaultKind = "expense",
}: {
  variant: "header" | "tile";
  defaultKind?: CategoryKind;
}) {
  const t = useTranslations("categories");
  const [open, setOpen] = useState(false);
  // While saving, the modal can't be closed: a failure would have nowhere to show, and save could run twice.
  const [saving, setSaving] = useState(false);
  // A new key per opening gives the form fresh values, while the dialog itself
  // stays mounted, so closing it returns focus to this button.
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
        className={
          variant === "header"
            ? "flex shrink-0 cursor-pointer items-center gap-[7px] rounded-[10px] bg-primary px-[18px] py-[11px] text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            : "flex min-h-[66px] cursor-pointer items-center justify-center gap-[7px] rounded-xl border-[1.5px] border-dashed border-border p-3.5 text-[13px] font-semibold text-muted-foreground hover:border-ring hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        }
      >
        <Plus size={variant === "header" ? 16 : 15} aria-hidden />
        {variant === "header" ? t("newCategory") : t("addCategory")}
        {/* Each group has its own tile, so screen readers also hear which group it adds to ("Add category (Expenses)"). */}
        {variant === "tile" && <span className="sr-only"> ({t(`groups.${defaultKind}`)})</span>}
      </button>
      <Modal open={open} title={t("form.title")} onClose={() => setOpen(false)} busy={saving}>
        <CategoryForm
          key={formKey}
          defaultKind={defaultKind}
          onDone={() => setOpen(false)}
          onPendingChange={setSaving}
        />
      </Modal>
    </>
  );
}

function CategoryForm({
  defaultKind,
  onDone,
  onPendingChange,
}: {
  defaultKind: CategoryKind;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations("categories");
  const announce = useAnnounce();
  const idPrefix = useId();
  const [values, setValues] = useState<Record<CategoryFields, string>>({
    name: "",
    kind: defaultKind,
    icon: CATEGORY_ICON_KEYS[0],
    color: SWATCHES[2].hex,
  });
  const set = (field: CategoryFields) => (value: string) => setValues((prev) => ({ ...prev, [field]: value }));

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, submitted: Record<CategoryFields, string>): Promise<FormState> => {
      try {
        const result = await createCategory(submitted);
        if (result.success) {
          announce(t("announcements.created", { name: submitted.name.trim() }));
          onDone();
          return initialState;
        }
        const fieldErrors = Object.fromEntries(
          Object.entries(result.errors ?? {})
            .map(([field, codes]) => [field, codes.find(isCategoryErrorCode)] as const)
            .filter(([, code]) => code),
        );
        return Object.keys(fieldErrors).length > 0
          ? { fieldErrors, error: null }
          : { fieldErrors: {}, error: formErrorFor(result) === "network" ? "network" : "generic" };
      } catch {
        // The action call itself failed (offline, Next server down).
        return { fieldErrors: {}, error: "network" };
      }
    },
    initialState,
  );

  // onSubmit rather than <form action>: React resets a form after every action,
  // which would drop the radio selections while state still holds them.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(() => submitAction(values));
  }

  useEffect(() => onPendingChange(isPending), [isPending, onPendingChange]);

  // After a failed submit, move keyboard focus to the first invalid field.
  useEffect(() => {
    const firstInvalid = FIELD_ORDER.find((field) => fieldErrors[field]);
    if (firstInvalid) document.querySelector<HTMLElement>(`[data-field="${idPrefix}-${firstInvalid}"]`)?.focus();
  }, [fieldErrors, idPrefix]);

  const errorText = (code?: CategoryErrorCode) => code && t(`errors.${code}`, { max: MAX_CATEGORY_NAME_LENGTH });
  const colorIsValid = HEX_COLOR_PATTERN.test(values.color.trim());
  const previewColor = colorIsValid ? values.color.trim() : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset disabled={isPending}>
        {/* Live preview, as in the design */}
        <div className="mb-[22px] flex items-center gap-3.5" aria-hidden>
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted ring-1 ring-foreground/15 ring-inset"
            style={previewColor ? { backgroundColor: previewColor, color: readableOn(previewColor) } : undefined}
          >
            <CategoryIcon icon={values.icon} size={22} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{values.name.trim() || t("form.previewName")}</div>
            <div className="text-[13px] text-muted-foreground">{t(`kinds.${values.kind as CategoryKind}`)}</div>
          </div>
        </div>

        <FormAlert message={error && t(`errors.${error}`)} />

        <TextField
          id={`${idPrefix}-name`}
          data-field={`${idPrefix}-name`}
          data-autofocus
          label={t("form.name")}
          type="text"
          required
          maxLength={MAX_CATEGORY_NAME_LENGTH}
          placeholder={t("form.namePlaceholder")}
          value={values.name}
          onChange={(e) => set("name")(e.target.value)}
          error={errorText(fieldErrors.name)}
        />

        <ChoiceGroup legend={t("form.kind")} error={errorText(fieldErrors.kind)} idPrefix={`${idPrefix}-kind`}>
          <div className="flex gap-1 rounded-[11px] border border-border bg-muted p-1">
            {CATEGORY_KINDS.map((kind, index) => (
              <label key={kind} className="flex-1">
                <input
                  type="radio"
                  name="kind"
                  value={kind}
                  checked={values.kind === kind}
                  onChange={() => set("kind")(kind)}
                  data-field={index === 0 ? `${idPrefix}-kind` : undefined}
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-[8px] px-2 py-1.5 text-center text-[13px] font-medium text-muted-foreground peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {t(`kinds.${kind}`)}
                </span>
              </label>
            ))}
          </div>
        </ChoiceGroup>

        <ChoiceGroup legend={t("form.icon")} error={errorText(fieldErrors.icon)} idPrefix={`${idPrefix}-icon`}>
          <div className="grid grid-cols-6 gap-2">
            {CATEGORY_ICON_KEYS.map((icon, index) => (
              <label key={icon} title={t(`icons.${icon}`)}>
                <input
                  type="radio"
                  name="icon"
                  value={icon}
                  checked={values.icon === icon}
                  onChange={() => set("icon")(icon)}
                  aria-label={t(`icons.${icon}`)}
                  data-field={index === 0 ? `${idPrefix}-icon` : undefined}
                  className="peer sr-only"
                />
                <span className="flex aspect-square cursor-pointer items-center justify-center rounded-[10px] border-[1.5px] border-transparent bg-muted text-muted-foreground peer-checked:border-primary peer-checked:bg-accent peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring dark:peer-checked:border-accent-foreground dark:peer-checked:text-accent-foreground">
                  <CategoryIcon icon={icon} />
                </span>
              </label>
            ))}
          </div>
        </ChoiceGroup>

        <ChoiceGroup legend={t("form.color")} idPrefix={`${idPrefix}-color`}>
          <div className="mb-3 flex flex-wrap gap-3">
            {SWATCHES.map((swatch) => {
              const selected = values.color.trim().toUpperCase() === swatch.hex;
              return (
                <label key={swatch.hex} title={t(`colors.${swatch.name}`)}>
                  <input
                    type="radio"
                    name="color-swatch"
                    value={swatch.hex}
                    checked={selected}
                    onChange={() => set("color")(swatch.hex)}
                    aria-label={t(`colors.${swatch.name}`)}
                    className="peer sr-only"
                  />
                  <span
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card"
                    style={{
                      backgroundColor: swatch.hex,
                      color: readableOn(swatch.hex),
                      // The selection ring uses the text colour: a ring in the swatch's own colour vanishes on a dark card.
                      boxShadow: selected ? "0 0 0 2px var(--card), 0 0 0 4px var(--foreground)" : undefined,
                    }}
                  >
                    {selected && <Check size={14} aria-hidden />}
                  </span>
                </label>
              );
            })}
          </div>
          <TextField
            id={`${idPrefix}-color-hex`}
            data-field={`${idPrefix}-color`}
            label={t("form.colorHex")}
            type="text"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            placeholder="#2563EB"
            value={values.color}
            onChange={(e) => set("color")(e.target.value)}
            // On the field itself, so it turns red and is announced with it.
            error={errorText(fieldErrors.color)}
            trailing={
              // The browser's own colour picker (no library): the circle opens the system palette.
              // Its value must be a lowercase #rrggbb, so while the typed hex is incomplete it shows the default.
              <input
                type="color"
                value={(previewColor ?? SWATCHES[2].hex).toLowerCase()}
                onChange={(e) => set("color")(e.target.value.toUpperCase())}
                aria-label={t("form.pickColor")}
                title={t("form.pickColor")}
                className="size-6 cursor-pointer appearance-none rounded-full border border-border bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
              />
            }
          />
        </ChoiceGroup>

        <div className="mt-2 flex gap-3">
          <Button variant="outline" onClick={onDone}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" variant="success">
            <Check size={16} aria-hidden />
            {isPending ? t("form.submitting") : t("form.submit")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/** A labelled group of choices (radios) with an inline error, like TextField's. */
function ChoiceGroup({
  legend,
  error,
  idPrefix,
  children,
}: {
  legend: string;
  error?: string;
  idPrefix: string;
  children: ReactNode;
}) {
  const errorId = `${idPrefix}-error`;
  return (
    <fieldset className="mb-[18px]" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-[7px] text-[13px] font-semibold">{legend}</legend>
      {children}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
