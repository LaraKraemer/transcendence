"use client";

import { Check, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";

import { formErrorFor } from "@/components/auth/form-parts";
import { CATEGORY_ICON_KEYS, CategoryIcon } from "@/components/categories/category-icon";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, choiceSegmentClassName, choiceSegmentsClassName } from "@/components/ui/choice-group";
import { FormAlert } from "@/components/ui/form-alert";
import { IconButton } from "@/components/ui/icon-button";
import { useAnnounce } from "@/components/ui/live-status";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/text-field";
import { createCategory, updateCategory } from "@/lib/actions/categories";
import type { Category } from "@/lib/types";
import {
  CATEGORY_TYPES,
  HEX_COLOR_PATTERN,
  MAX_CATEGORY_NAME_LENGTH,
  hslToHex,
  hueAndLightness,
  isCategoryErrorCode,
  readableOn,
  type CategoryErrorCode,
  type CategoryType,
} from "@/lib/validation";

// Seven colours picked to be easy to tell apart: the closest pair is ΔE 53 in CIELAB
// (above ~25 reads as clearly different at a glance). The last circle picks any other
// colour with hue and lightness sliders.
// Not the native <input type="color">: it opens the browser's or the OS's own colour window
// (in Safari and Firefox a separate system window), which lives outside the page. The page
// has no API to close it (showPicker() can only open it), it ignores clicks on the page, and
// it stays open after the dialog closes; clicking outside to dismiss it would also land on
// the dialog's backdrop. Range inputs live inside the dialog and close with it.
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
const isPresetColor = (color: string) => SWATCHES.some((swatch) => swatch.hex === color.toUpperCase());

// The custom colour keeps one saturation, so two sliders reach every hue from dark to pastel.
const CUSTOM_SATURATION = 70;
const MIN_CUSTOM_LIGHTNESS = 15;
const MAX_CUSTOM_LIGHTNESS = 85;
// Teal: a first custom colour that none of the presets already covers.
const DEFAULT_CUSTOM = { hue: 180, lightness: 45 };
const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];
// A white thumb with a dark outline stays visible on every part of both tracks.
const sliderClasses =
  "h-2.5 w-full cursor-pointer appearance-none rounded-full ring-1 ring-foreground/15 ring-inset focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(8,14,25,.45),0_1px_3px_rgba(8,14,25,.35)] [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_0_0_1px_rgba(8,14,25,.45),0_1px_3px_rgba(8,14,25,.35)]";

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
 * "Add category" tile at the end of the list.
 */
export function NewCategoryButton({ variant }: { variant: "header" | "tile" }) {
  const t = useTranslations("categories");
  const [open, setOpen] = useState(false);
  // While saving, the modal can't be closed: a failure would have nowhere to show, and save could run twice.
  const [saving, setSaving] = useState(false);
  // A new key per opening gives the form fresh values, while the dialog itself
  // stays mounted, so closing it returns focus to this button.
  const [formKey, setFormKey] = useState(0);

  function openForm() {
    setFormKey((key) => key + 1);
    setOpen(true);
  }

  return (
    <>
      {variant === "header" ? (
        <IconButton label={t("newCategory")} variant="primary" size="md" onClick={openForm}>
          <Plus size={18} aria-hidden />
        </IconButton>
      ) : (
        <button
          type="button"
          onClick={openForm}
          aria-label={t("addCategory")}
          title={t("addCategory")}
          className="flex min-h-[66px] cursor-pointer items-center justify-center gap-[7px] rounded-xl border-[1.5px] border-dashed border-border p-3.5 text-[13px] font-semibold text-muted-foreground hover:border-ring hover:text-foreground focus-ring"
        >
          <Plus size={15} aria-hidden />
          {t("addCategory")}
        </button>
      )}
      <Modal open={open} title={t("form.title")} onClose={() => setOpen(false)} busy={saving}>
        <CategoryForm
          key={formKey}
          onDone={() => setOpen(false)}
          onPendingChange={setSaving}
        />
      </Modal>
    </>
  );
}

/**
 * The category form: empty to create one, or prefilled from `category` to edit it,
 * in which case only the changed fields are saved.
 */
export function CategoryForm({
  category,
  onDone,
  onPendingChange,
}: {
  category?: Category;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = useTranslations("categories");
  const announce = useAnnounce();
  const idPrefix = useId();
  // The values the form opened with; when editing, updateCategory sends only what differs from them.
  const [opened] = useState(() =>
    category
      ? { name: category.name, types: category.types, icon: category.icon, color: category.color.toUpperCase() }
      : { name: "", types: ["expense"] as CategoryType[], icon: CATEGORY_ICON_KEYS[0] as string, color: DEFAULT_COLOR },
  );
  const [values, setValues] = useState(opened);
  const set = (field: "name" | "icon" | "color") => (value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));
  // Slider positions, kept while a preset is selected so switching back restores the last custom colour.
  const [customColor, setCustomColor] = useState(() =>
    isPresetColor(opened.color) ? DEFAULT_CUSTOM : hueAndLightness(opened.color),
  );
  const pickCustomColor = (next: typeof customColor) => {
    setCustomColor(next);
    set("color")(hslToHex(next.hue, CUSTOM_SATURATION, next.lightness));
  };
  const toggleType = (type: CategoryType) =>
    setValues((prev) => ({
      ...prev,
      types: prev.types.includes(type) ? prev.types.filter((selected) => selected !== type) : [...prev.types, type],
    }));

  const [{ fieldErrors, error }, submitAction, isPending] = useActionState(
    async (_prev: FormState, submitted: typeof values): Promise<FormState> => {
      try {
        const result = category
          ? await updateCategory(category.id, opened, submitted)
          : await createCategory(submitted);
        if (result.success) {
          announce(t(category ? "announcements.saved" : "announcements.created", { name: submitted.name.trim() }));
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
  const isCustomColor = !isPresetColor(values.color);

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
          <div className={choiceSegmentsClassName}>
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
                <span className={choiceSegmentClassName}>
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
            {/* Custom colour: a rainbow until it is selected, then the chosen colour with a check
                and the sliders below. */}
            <label title={t("form.customColor")} className="flex justify-center">
              <input
                type="radio"
                name="color-swatch"
                value="custom"
                checked={isCustomColor}
                onChange={() => pickCustomColor(customColor)}
                aria-label={t("form.customColor")}
                data-field={`${idPrefix}-color`}
                className="peer sr-only"
              />
              <span
                className={`${circleClasses} cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card`}
                style={
                  isCustomColor && previewColor
                    ? { backgroundColor: previewColor, color: readableOn(previewColor), boxShadow: selectedRing }
                    : {
                        backgroundImage:
                          "conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)",
                      }
                }
              >
                {isCustomColor && <Check size={14} aria-hidden />}
              </span>
            </label>
          </div>
          {isCustomColor && (
            <div className="mt-4 grid gap-3 text-[13px] font-medium text-muted-foreground">
              <label className="grid gap-2">
                {t("form.hue")}
                {/* ltr even in RTL locales, so the thumb moves the same way as the gradient. */}
                <input
                  type="range"
                  dir="ltr"
                  min={0}
                  max={359}
                  value={customColor.hue}
                  onChange={(e) => pickCustomColor({ ...customColor, hue: Number(e.target.value) })}
                  className={sliderClasses}
                  style={{
                    backgroundImage: `linear-gradient(to right, ${HUE_STOPS.map((hue) => `hsl(${hue} ${CUSTOM_SATURATION}% ${customColor.lightness}%)`).join(", ")})`,
                  }}
                />
              </label>
              <label className="grid gap-2">
                {t("form.lightness")}
                <input
                  type="range"
                  dir="ltr"
                  min={MIN_CUSTOM_LIGHTNESS}
                  max={MAX_CUSTOM_LIGHTNESS}
                  value={customColor.lightness}
                  onChange={(e) => pickCustomColor({ ...customColor, lightness: Number(e.target.value) })}
                  className={sliderClasses}
                  style={{
                    backgroundImage: `linear-gradient(to right, ${[MIN_CUSTOM_LIGHTNESS, 50, MAX_CUSTOM_LIGHTNESS].map((lightness) => `hsl(${customColor.hue} ${CUSTOM_SATURATION}% ${lightness}%)`).join(", ")})`,
                  }}
                />
              </label>
            </div>
          )}
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
