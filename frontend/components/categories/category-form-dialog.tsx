"use client";

import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";

import { FormAlert, formErrorFor } from "@/components/auth/form-parts";
import { CATEGORY_ICON_KEYS, CategoryIcon } from "@/components/categories/category-icon";
import { Button } from "@/components/ui/button";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import { createCategory } from "@/lib/actions/categories";
import {
  CATEGORY_TYPES,
  HEX_COLOR_PATTERN,
  MAX_CATEGORY_NAME_LENGTH,
  isCategoryErrorCode,
  readableOn,
  type CategoryErrorCode,
  type CategoryType,
} from "@/lib/validation";

// Seven colours picked to be easy to tell apart: the closest pair is ΔE 53 in CIELAB
// (above ~25 reads as clearly different at a glance). The last circle in the row
// opens the system palette for any other colour.
const SWATCHES = [
  { name: "red", hex: "#DC2626" },
  { name: "yellow", hex: "#FACC15" },
  { name: "green", hex: "#4ADE80" },
  { name: "blue", hex: "#60A5FA" },
  { name: "violet", hex: "#8B5CF6" },
  { name: "pink", hex: "#F472B6" },
  { name: "slate", hex: "#334155" },
] as const;
const DEFAULT_COLOR = "#8B5CF6";

// Shared by the preset circles and the custom one; the selection ring uses the
// text colour, because a ring in the circle's own colour vanishes on a dark card.
const circleClasses =
  "flex aspect-square w-full max-w-8 items-center justify-center rounded-full ring-1 ring-foreground/15 ring-inset";
const selectedRing = "0 0 0 2px var(--card), 0 0 0 4px var(--foreground)";

type CategoryFields = "name" | "icon" | "color" | "types";
const FIELD_ORDER: CategoryFields[] = ["name", "types", "icon", "color"];

type FormState = {
  fieldErrors: Partial<Record<CategoryFields, CategoryErrorCode>>;
  error: "network" | "generic" | null;
};
const initialState: FormState = { fieldErrors: {}, error: null };

/**
 * "New category" trigger plus its modal form. `variant="tile"` is the dashed
 * "Add category" tile at the end of a group, which preselects that group's type.
 */
export function NewCategoryButton({
  variant,
  defaultType = "expense",
}: {
  variant: "header" | "tile";
  defaultType?: CategoryType;
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
        {variant === "tile" && <span className="sr-only"> ({t(`groups.${defaultType}`)})</span>}
      </button>
      <Modal open={open} title={t("form.title")} onClose={() => setOpen(false)} busy={saving}>
        <CategoryForm
          key={formKey}
          defaultType={defaultType}
          onDone={() => setOpen(false)}
          onPendingChange={setSaving}
        />
      </Modal>
    </>
  );
}

function CategoryForm({
  defaultType,
  onDone,
  onPendingChange,
}: {
  defaultType: CategoryType;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations("categories");
  const announce = useAnnounce();
  const idPrefix = useId();
  const [values, setValues] = useState({
    name: "",
    types: [defaultType] as CategoryType[],
    icon: CATEGORY_ICON_KEYS[0] as string,
    color: DEFAULT_COLOR,
  });
  const set = (field: "name" | "icon" | "color") => (value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));
  const toggleType = (type: CategoryType) =>
    setValues((prev) => ({
      ...prev,
      types: prev.types.includes(type) ? prev.types.filter((selected) => selected !== type) : [...prev.types, type],
    }));

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, submitted: typeof values): Promise<FormState> => {
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
  // which would drop the radio and checkbox selections while state still holds them.
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
  const previewColor = HEX_COLOR_PATTERN.test(values.color) ? values.color : undefined;
  const isCustomColor = !SWATCHES.some((swatch) => swatch.hex === values.color.toUpperCase());

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
            <div className="text-[13px] text-muted-foreground">
              {CATEGORY_TYPES.filter((type) => values.types.includes(type))
                .map((type) => t(`types.${type}`))
                .join(" · ")}
            </div>
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

        <ChoiceGroup legend={t("form.types")} error={errorText(fieldErrors.types)} idPrefix={`${idPrefix}-types`}>
          <div className="flex gap-1 rounded-[11px] border border-border bg-muted p-1">
            {CATEGORY_TYPES.map((type, index) => (
              <label key={type} className="flex-1">
                <input
                  type="checkbox"
                  name="types"
                  value={type}
                  checked={values.types.includes(type)}
                  onChange={() => toggleType(type)}
                  data-field={index === 0 ? `${idPrefix}-types` : undefined}
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-[8px] px-2 py-1.5 text-center text-[13px] font-medium text-muted-foreground peer-checked:bg-card peer-checked:font-semibold peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {t(`types.${type}`)}
                </span>
              </label>
            ))}
          </div>
        </ChoiceGroup>

        <ChoiceGroup legend={t("form.icon")} error={errorText(fieldErrors.icon)} idPrefix={`${idPrefix}-icon`}>
          <div className="grid grid-cols-5 gap-2">
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

        <ChoiceGroup legend={t("form.color")} error={errorText(fieldErrors.color)} idPrefix={`${idPrefix}-color`}>
          {/* One row: seven presets, then the custom colour. On narrow screens the circles shrink
              (never below 24px) instead of wrapping. */}
          <div className="grid grid-cols-8 gap-1 sm:gap-2">
            {SWATCHES.map((swatch) => {
              const selected = values.color.toUpperCase() === swatch.hex;
              return (
                <label key={swatch.hex} title={t(`colors.${swatch.name}`)} className="flex justify-center">
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
                    className={`${circleClasses} cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card`}
                    style={{
                      backgroundColor: swatch.hex,
                      color: readableOn(swatch.hex),
                      boxShadow: selected ? selectedRing : undefined,
                    }}
                  >
                    {selected && <Check size={14} aria-hidden />}
                  </span>
                </label>
              );
            })}
            {/* Custom colour: the browser's own picker (no library), stretched invisibly over a circle
                that shows a rainbow until a custom colour is chosen, then that colour with a check. */}
            <label
              title={t("form.customColor")}
              className="relative flex justify-center rounded-full has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-card"
            >
              <span
                aria-hidden
                className={circleClasses}
                style={
                  isCustomColor
                    ? { backgroundColor: values.color, color: readableOn(values.color), boxShadow: selectedRing }
                    : {
                        backgroundImage:
                          "conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
                      }
                }
              >
                {isCustomColor && <Check size={14} aria-hidden />}
              </span>
              <input
                type="color"
                // The picker needs a lowercase #rrggbb value.
                value={values.color.toLowerCase()}
                onChange={(e) => set("color")(e.target.value.toUpperCase())}
                aria-label={t("form.customColor")}
                data-field={`${idPrefix}-color`}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
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
