"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  Landmark,
  Languages,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Moon,
  Pencil,
  Plus,
  SearchX,
  Sparkles,
  Store,
  Sun,
  SunMoon,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";

import { CATEGORY_ICON_KEYS, CategoryIcon } from "@/components/categories/category-icon";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChoiceGroup, choiceSegmentClassName, choiceSegmentsClassName } from "@/components/ui/choice-group";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormAlert } from "@/components/ui/form-alert";
import { IconButton, type IconButtonVariant } from "@/components/ui/icon-button";
import { LiveStatusProvider, useAnnounce } from "@/components/ui/live-status";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { Modal } from "@/components/ui/modal";
import { SelectField } from "@/components/ui/select-field";
import { StrengthMeter } from "@/components/ui/strength-meter";
import { TextField } from "@/components/ui/text-field";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ToggleButton } from "@/components/ui/toggle-button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { ACCOUNT_TYPES, CATEGORY_TYPES, contrastRatio, TRANSACTION_TYPES } from "@/lib/validation";

// The colour tokens of app/globals.css; a new token needs adding here to be shown.
const COLOR_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "border",
  "input",
  "primary",
  "primary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "ring",
  "destructive",
  "success",
  "success-bg",
  "danger-bg",
  "navy",
  "field",
] as const;

/** The main text colour and the surface it is used on. */
const CONTRAST_PAIRS = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["muted-foreground", "card"],
  ["muted-foreground", "background"],
  ["primary-foreground", "primary"],
  ["accent-foreground", "accent"],
  ["destructive", "card"],
  ["success", "card"],
  ["success", "success-bg"],
  ["destructive", "danger-bg"],
] as const;

// Whole class names, so Tailwind finds and generates them.
const TYPE_ROLES = [
  { token: "title", className: "text-title" },
  { token: "heading", className: "text-heading" },
  { token: "subheading", className: "text-subheading" },
  { token: "body", className: "text-body" },
  { token: "label", className: "text-label" },
  { token: "caption", className: "text-caption" },
  { token: "overline", className: "text-overline uppercase" },
] as const;

// The Lucide icons the app uses besides the category icons.
const INTERFACE_ICONS = {
  Archive,
  ArchiveRestore,
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  Landmark,
  Languages,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Moon,
  Pencil,
  Plus,
  SearchX,
  Sparkles,
  Store,
  Sun,
  SunMoon,
  Trash2,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserRound,
  Wallet,
  X,
} satisfies Record<string, LucideIcon>;

/** Icons that point in the reading direction, so the app mirrors them in right-to-left languages. */
const DIRECTIONAL_ICONS = new Set<string>([
  "ArrowDownLeft",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUpRight",
  "ChevronLeft",
  "ChevronRight",
  "LogOut",
  "TrendingDown",
  "TrendingUp",
]);

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
type TokenValues = Record<Theme, Record<string, string>>;

const TYPE_VARIABLES = TYPE_ROLES.flatMap(({ token }) => [`--text-${token}`, `--text-${token}--font-weight`]);

/** "rgb(30, 51, 82)" → "#1e3352". */
const rgbToHex = (rgb: string) =>
  `#${(rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;

let tokenSnapshot: string | undefined;

/**
 * Every token's value in both themes, read once from an element with the theme's class, so the
 * values come from globals.css rather than a copy. Colours are read back as the browser resolves
 * them, because the minified CSS shortens them (#ffffff → #fff). A JSON string, which
 * useSyncExternalStore can compare.
 */
function readTokenValues(): string {
  tokenSnapshot ??= JSON.stringify(
    Object.fromEntries(
      THEMES.map((theme) => {
        const probe = document.createElement("div");
        probe.className = theme;
        document.body.append(probe);
        const style = getComputedStyle(probe);
        const values: Record<string, string> = {};
        for (const token of COLOR_TOKENS) {
          probe.style.color = `var(--${token})`;
          values[`--${token}`] = rgbToHex(style.color);
        }
        for (const name of TYPE_VARIABLES) values[name] = style.getPropertyValue(name).trim();
        probe.remove();
        return [theme, values];
      }),
    ),
  );
  return tokenSnapshot;
}

const neverChanges = () => () => {};

/** The token values, or null on the server and during hydration (the page shows the swatches without them). */
function useTokenValues(): TokenValues | null {
  const json = useSyncExternalStore(neverChanges, readTokenValues, () => "");
  return json ? (JSON.parse(json) as TokenValues) : null;
}

/** A colour square in the given theme. The frame is drawn in the page's theme, so it shows on either background. */
function Swatch({ theme, token, className = "size-7" }: { theme: Theme; token: string; className?: string }) {
  return (
    <span aria-hidden className={`block shrink-0 overflow-hidden rounded-[8px] border border-border ${className}`}>
      <span className={`${theme} block size-full`} style={{ background: `var(--${token})` }} />
    </span>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10 scroll-mt-6">
      <h2 id={id} className="text-heading">
        {title}
      </h2>
      <p className="mt-1 mb-5 max-w-3xl text-body text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

export function DesignSystemShowcase() {
  const t = useTranslations("designSystem");
  const tokens = useTokenValues();
  const sections = [
    { id: "colors", title: t("colors.title") },
    { id: "contrast", title: t("contrast.title") },
    { id: "typography", title: t("typography.title") },
    { id: "icons", title: t("icons.title") },
    { id: "components", title: t("components.title") },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl pt-2">
      <h1 id="design-system-title" className="text-title">
        {t("title")}
      </h1>
      <p className="mt-1 max-w-3xl text-body text-muted-foreground">{t("intro")}</p>
      <nav aria-labelledby="design-system-title" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {sections.map(({ id, title }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="focus-ring block rounded-[10px] border border-border bg-card px-3 py-1.5 text-label hover:border-ring"
              >
                {title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section id="colors" title={t("colors.title")} description={t("colors.description")}>
        <Card className="p-4 sm:p-6">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
            {COLOR_TOKENS.map((token) => (
              <li key={token} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <code dir="ltr" className="min-w-0 flex-1 basis-40 text-label font-normal rtl:text-right">
                  --{token}
                </code>
                {THEMES.map((theme) => (
                  <span key={theme} className="flex w-[7.5rem] items-center gap-2 text-caption">
                    <Swatch theme={theme} token={token} />
                    <span className="min-w-0">
                      <span className="block text-muted-foreground">{t(`colors.${theme}`)}</span>
                      <code dir="ltr" className="block rtl:text-right">
                        {tokens?.[theme][`--${token}`]}
                      </code>
                    </span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5">
            <span className="min-w-0 flex-1 basis-40 text-label font-normal">
              {t("colors.gradient")} <code dir="ltr">--grad</code>
            </span>
            {THEMES.map((theme) => (
              <span key={theme} className="flex w-[7.5rem] items-center gap-2 text-caption">
                <Swatch theme={theme} token="grad" className="h-7 w-14" />
                <span className="text-muted-foreground">{t(`colors.${theme}`)}</span>
              </span>
            ))}
          </div>
        </Card>
      </Section>

      <Section id="contrast" title={t("contrast.title")} description={t("contrast.description")}>
        <Card className="px-4 py-2 sm:px-6">
          <ContrastTable tokens={tokens} />
        </Card>
      </Section>

      <Section id="typography" title={t("typography.title")} description={t("typography.description")}>
        <Card className="px-4 sm:px-6">
          <ul>
          {TYPE_ROLES.map(({ token, className }) => {
            const weight = tokens?.light[`--text-${token}--font-weight`];
            return (
              <li
                key={token}
                className="flex flex-col gap-1 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6"
              >
                <div className="shrink-0 text-caption text-muted-foreground sm:w-52">
                  <code dir="ltr" className="font-semibold text-foreground">
                    {className.split(" ")[0]}
                  </code>{" "}
                  <span dir="ltr">
                    {tokens?.light[`--text-${token}`]}
                    {weight && ` · ${weight}`}
                  </span>
                </div>
                <p className={`min-w-0 break-words ${className}`}>{t("typography.sample")}</p>
              </li>
            );
          })}
          </ul>
        </Card>
      </Section>

      <Section id="icons" title={t("icons.title")} description={t("icons.description")}>
        <Card className="p-4 sm:p-6">
          <h3 className="mb-3 text-subheading">{t("icons.interface")}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {Object.entries(INTERFACE_ICONS).map(([name, Icon]) => (
              <li key={name} className="flex items-center gap-2.5 rounded-[10px] bg-muted px-3 py-2.5 text-caption">
                <Icon
                  size={18}
                  aria-hidden
                  className={`shrink-0 ${DIRECTIONAL_ICONS.has(name) ? "rtl:-scale-x-100" : ""}`}
                />
                <code dir="ltr" className="min-w-0 wrap-anywhere">
                  {name}
                </code>
              </li>
            ))}
          </ul>
          <h3 className="mt-6 mb-3 text-subheading">{t("icons.categories")}</h3>
          <CategoryIcons />
        </Card>
      </Section>

      <Section id="components" title={t("components.title")} description={t("components.description")}>
        <ComponentDemos />
      </Section>
    </div>
  );
}

function ContrastTable({ tokens }: { tokens: TokenValues | null }) {
  const t = useTranslations("designSystem");
  const format = useFormatter();

  const level = (ratio: number) =>
    ratio >= 4.5 ? t("contrast.aa") : ratio >= 3 ? t("contrast.aaLarge") : t("contrast.fails");

  // At 320 px with WCAG text spacing the table is wider than the page, so it scrolls in its own
  // region; tabIndex lets keyboard users scroll it.
  return (
    <div role="region" aria-label={t("contrast.caption")} tabIndex={0} className="focus-ring overflow-x-auto rounded-sm">
      <table className="w-full text-body">
        <caption className="sr-only">{t("contrast.caption")}</caption>
        <thead>
          <tr className="border-b border-border text-overline text-muted-foreground uppercase">
            <th scope="col" className="py-3 pe-3 text-start">
              {t("contrast.pair")}
            </th>
            {THEMES.map((theme) => (
              <th key={theme} scope="col" className="px-2 py-3 text-start">
                {t(`colors.${theme}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONTRAST_PAIRS.map(([text, surface]) => (
            <tr key={`${text}/${surface}`} className="border-b border-border last:border-b-0">
              <th scope="row" className="py-3 pe-3 text-start text-caption font-normal">
                {t.rich("contrast.pairLabel", {
                  text: `--${text}`,
                  surface: `--${surface}`,
                  code: (chunks) => (
                    <code dir="ltr" className="inline-block whitespace-nowrap">
                      {chunks}
                    </code>
                  ),
                })}
              </th>
              {THEMES.map((theme) => {
                const textColor = tokens?.[theme][`--${text}`];
                const surfaceColor = tokens?.[theme][`--${surface}`];
                const ratio = textColor && surfaceColor ? contrastRatio(textColor, surfaceColor) : undefined;
                return (
                  <td key={theme} className="px-2 py-3 align-middle">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span aria-hidden className="block shrink-0 overflow-hidden rounded-[8px] border border-border">
                        <span
                          className={`${theme} flex size-8 items-center justify-center text-xs font-semibold`}
                          style={{ color: `var(--${text})`, background: `var(--${surface})` }}
                        >
                          Aa
                        </span>
                      </span>
                      {ratio !== undefined && (
                        <span className="text-caption">
                          <span className="block font-semibold tabular-nums">
                            {t("contrast.ratio", { ratio: format.number(ratio, { maximumFractionDigits: 2 }) })}
                          </span>
                          <span className="block text-muted-foreground">{level(ratio)}</span>
                        </span>
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoryIcons() {
  const t = useTranslations("categories.icons");
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      {CATEGORY_ICON_KEYS.map((key) => (
        <li key={key} className="flex items-center gap-2.5 rounded-[10px] bg-muted px-3 py-2.5 text-caption">
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-accent text-primary dark:text-accent-foreground">
            <CategoryIcon icon={key} />
          </span>
          <span className="min-w-0">
            <span className="block wrap-anywhere">{t(key)}</span>
            <code dir="ltr" className="block text-muted-foreground wrap-anywhere rtl:text-right">
              {key}
            </code>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One component's card: its name as the heading and its examples. */
function ComponentDemo({ name, className = "", children }: { name: string; className?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <Card as="section" aria-labelledby={headingId} className={`min-w-0 p-4 sm:p-6 ${className}`}>
      <h3 id={headingId} className="mb-4 text-subheading">
        <code dir="ltr">{name}</code>
      </h3>
      {children}
    </Card>
  );
}

/** An example with the name of its state or variant above it. */
function Example({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-overline text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}

const BUTTON_VARIANTS: ButtonVariant[] = ["primary", "success", "outline", "danger"];

function ComponentDemos() {
  const t = useTranslations();
  const format = useFormatter();
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordShown, setPasswordShown] = useState(false);
  const change = (ratio: number) =>
    t("dashboard.vsLastMonth", { change: format.number(ratio, { style: "percent", signDisplay: "exceptZero" }) });
  const sample = { name: t("accounts.types.savings") };
  // One of each IconButton variant, with an icon and label from a place it is used.
  const iconButtonDemos: { variant: IconButtonVariant; icon: LucideIcon; label: string }[] = [
    { variant: "primary", icon: Plus, label: t("categories.newCategory") },
    { variant: "success", icon: Plus, label: t("accounts.newAccount") },
    { variant: "danger", icon: Trash2, label: t("accounts.actions.delete", sample) },
    { variant: "muted", icon: Pencil, label: t("accounts.actions.edit", sample) },
    { variant: "muted-danger", icon: Trash2, label: t("accounts.actions.delete", sample) },
    { variant: "muted-warning", icon: Archive, label: t("accounts.actions.archive", sample) },
    { variant: "card", icon: Pencil, label: t("categories.actions.edit", sample) },
    { variant: "card-danger", icon: Trash2, label: t("categories.actions.delete", sample) },
    { variant: "ghost", icon: X, label: t("common.close") },
    { variant: "plain", icon: X, label: t("common.close") },
    { variant: "outline", icon: Upload, label: t("transactionImport.title") },
    { variant: "outline-danger", icon: LogOut, label: t("nav.logout") },
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
      <ComponentDemo name="Button" className="lg:col-span-2">
        <div className="flex flex-col gap-5">
          {BUTTON_VARIANTS.map((variant) => (
            <div key={variant}>
              <code dir="ltr" className="mb-2 block text-caption text-muted-foreground rtl:text-right">
                variant=&quot;{variant}&quot;
              </code>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Example label={t("designSystem.states.default")}>
                  <Button variant={variant}>{t("accounts.form.submit")}</Button>
                </Example>
                <Example label={t("designSystem.states.disabled")}>
                  <Button variant={variant} disabled>
                    {t("accounts.form.submit")}
                  </Button>
                </Example>
                <Example label={t("designSystem.states.loading")}>
                  <Button variant={variant} disabled>
                    {t("accounts.form.submitting")}
                  </Button>
                </Example>
              </div>
            </div>
          ))}
        </div>
      </ComponentDemo>

      <ComponentDemo name="IconButton" className="lg:col-span-2">
        <div className="flex flex-col gap-5">
          <Example label={<code dir="ltr" className="normal-case">variant</code>}>
            <div className="flex flex-wrap gap-4">
              {iconButtonDemos.map(({ variant, icon: Icon, label }) => (
                <div key={variant} className="flex flex-col items-center gap-1.5">
                  {/* The card variants are made for a muted surface such as a category tile. */}
                  <span className={`rounded-[11px] p-1 ${variant.startsWith("card") ? "bg-muted" : ""}`}>
                    <IconButton label={label} variant={variant} size={variant === "plain" ? "inline" : "sm"}>
                      <Icon size={15} aria-hidden />
                    </IconButton>
                  </span>
                  <code dir="ltr" className="text-caption text-muted-foreground">
                    {variant}
                  </code>
                </div>
              ))}
            </div>
          </Example>
          <Example label={<code dir="ltr" className="normal-case">size</code>}>
            <div className="flex flex-wrap items-end gap-4">
              {(["sm", "md", "lg", "xl", "fab"] as const).map((size) => (
                <div key={size} className="flex flex-col items-center gap-1.5">
                  <IconButton label={t("categories.newCategory")} variant="primary" size={size}>
                    <Plus size={size === "fab" ? 24 : 18} aria-hidden />
                  </IconButton>
                  <code dir="ltr" className="text-caption text-muted-foreground">
                    {size}
                  </code>
                </div>
              ))}
            </div>
          </Example>
          <Example label={t("designSystem.states.disabled")}>
            <IconButton label={t("accounts.newAccount")} variant="success" size="md" disabled>
              <Plus size={18} aria-hidden />
            </IconButton>
          </Example>
        </div>
      </ComponentDemo>

      <ComponentDemo name="ToggleButton">
        <Example label={<code dir="ltr" className="normal-case">pressed={String(passwordShown)}</code>}>
          <ToggleButton
            label={t("auth.showPassword")}
            pressed={passwordShown}
            onPressedChange={setPasswordShown}
            variant="outline"
            size="lg"
          >
            {passwordShown ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </ToggleButton>
        </Example>
      </ComponentDemo>

      <ComponentDemo name="TextField">
        <Example label={t("designSystem.states.default")}>
          <TextField id="ds-text-default" label={t("accounts.form.name")} placeholder={t("accounts.form.namePlaceholder")} />
        </Example>
        <Example label={t("designSystem.states.error")}>
          <TextField id="ds-text-error" label={t("accounts.form.name")} error={t("accounts.errors.nameRequired")} />
        </Example>
        <Example label={t("designSystem.states.disabled")}>
          <TextField id="ds-text-disabled" label={t("accounts.form.institution")} defaultValue="DKB" disabled />
        </Example>
      </ComponentDemo>

      <ComponentDemo name="SelectField">
        <Example label={t("designSystem.states.default")}>
          <SelectField id="ds-select-default" label={t("accounts.form.type")} defaultValue="checking">
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`accounts.types.${type}`)}
              </option>
            ))}
          </SelectField>
        </Example>
        <Example label={t("designSystem.states.error")}>
          <SelectField
            id="ds-select-error"
            label={t("accounts.form.type")}
            defaultValue="savings"
            error={t("accounts.errors.typeInvalid")}
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`accounts.types.${type}`)}
              </option>
            ))}
          </SelectField>
        </Example>
        <Example label={t("designSystem.states.disabled")}>
          <SelectField id="ds-select-disabled" label={t("accounts.form.type")} defaultValue="cash" disabled>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`accounts.types.${type}`)}
              </option>
            ))}
          </SelectField>
        </Example>
      </ComponentDemo>

      <ComponentDemo name="ChoiceGroup">
        {/* As in the transaction form: radios, one disabled. */}
        <Example label={`${t("designSystem.states.default")} · ${t("designSystem.states.disabled")}`}>
          <ChoiceGroup legend={t("transactions.form.type")} idPrefix="ds-choice-radio">
            <div className={choiceSegmentsClassName}>
              {TRANSACTION_TYPES.map((type) => (
                <label key={type} className="flex-1">
                  <input
                    type="radio"
                    name="ds-choice-radio"
                    defaultChecked={type === "expense"}
                    disabled={type === "transfer"}
                    className="peer sr-only"
                  />
                  <span className={choiceSegmentClassName}>{t(`transactions.form.types.${type}`)}</span>
                </label>
              ))}
            </div>
          </ChoiceGroup>
        </Example>
        {/* As in the category form: checkboxes, here with nothing chosen. */}
        <Example label={t("designSystem.states.error")}>
          <ChoiceGroup
            legend={t("categories.form.types")}
            idPrefix="ds-choice-checkbox"
            error={t("categories.errors.typesInvalid")}
          >
            <div className={choiceSegmentsClassName}>
              {CATEGORY_TYPES.map((type) => (
                <label key={type} className="flex-1">
                  <input type="checkbox" name="ds-choice-checkbox" className="peer sr-only" />
                  <span className={choiceSegmentClassName}>{t(`categories.types.${type}`)}</span>
                </label>
              ))}
            </div>
          </ChoiceGroup>
        </Example>
      </ComponentDemo>

      <ComponentDemo name="Modal">
        <Button variant="outline" onClick={() => setModalOpen(true)}>
          {t("designSystem.demo.openDialog")}
        </Button>
        <Modal open={modalOpen} title={t("profile.nameDialog.title")} onClose={() => setModalOpen(false)}>
          <p className="mb-5 text-body text-muted-foreground">{t("designSystem.demo.dialogText")}</p>
          <TextField id="ds-modal-name" label={t("profile.name")} defaultValue="Jane Appleseed" data-autofocus />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => setModalOpen(false)}>{t("profile.nameDialog.save")}</Button>
          </div>
        </Modal>
      </ComponentDemo>

      <ComponentDemo name="ConfirmDialog · LiveStatusProvider">
        <LiveStatusProvider>
          <ConfirmDemo />
        </LiveStatusProvider>
      </ComponentDemo>

      <ComponentDemo name="FormAlert">
        <FormAlert message={t("auth.errors.network")} />
      </ComponentDemo>

      <ComponentDemo name="StrengthMeter">
        <div className="flex flex-col gap-3">
          <StrengthMeter score={1} tone="danger" label={t("auth.strength.tooShort")} />
          <StrengthMeter score={2} tone="success" label={t("auth.strength.good")} />
          <StrengthMeter score={3} tone="success" label={t("auth.strength.strong")} />
        </div>
      </ComponentDemo>

      <ComponentDemo name="Badge">
        <Example label={<code dir="ltr" className="normal-case">variant=&quot;label&quot;</code>}>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="warning">{t("accounts.archived")}</Badge>
            <Badge tone="info">{t("accounts.types.checking")}</Badge>
            <Badge tone="success">{t("accounts.types.savings")}</Badge>
            <Badge tone="danger">{t("categories.types.expense")}</Badge>
          </div>
        </Example>
        <Example label={<code dir="ltr" className="normal-case">variant=&quot;pill&quot;</code>}>
          <div className="flex flex-wrap gap-2">
            <Badge variant="pill" tone="success">
              <TrendingUp size={14} aria-hidden className="rtl:-scale-x-100" />
              {change(0.12)}
            </Badge>
            <Badge variant="pill" tone="danger">
              <TrendingDown size={14} aria-hidden className="rtl:-scale-x-100" />
              {change(-0.05)}
            </Badge>
            <Badge variant="pill">{change(0)}</Badge>
          </div>
        </Example>
      </ComponentDemo>

      <ComponentDemo name="Card · EmptyState">
        <Card className="p-5">
          <p className="text-body">{t("designSystem.demo.cardText")}</p>
        </Card>
        <Card className="mt-3 px-4 py-8">
          <EmptyState>{t("transactions.emptyAll")}</EmptyState>
        </Card>
        <Card className="mt-3 px-4 py-8">
          <EmptyState href="/accounts">{t("accounts.empty")}</EmptyState>
        </Card>
      </ComponentDemo>

      <ComponentDemo name="UserAvatar">
        <div className="flex items-center gap-4">
          <UserAvatar
            displayName="Jane Appleseed"
            avatarUrl={null}
            alt="Jane Appleseed"
            className="size-9 bg-primary text-[13px] font-semibold text-primary-foreground"
          />
          <UserAvatar
            displayName="Ali Rezaei"
            avatarUrl={null}
            alt="Ali Rezaei"
            className="size-[46px] bg-success-bg text-[15px] font-bold text-success"
          />
        </div>
      </ComponentDemo>

      <ComponentDemo name="ThemeToggle">
        <div className="flex gap-6">
          <Example label={<code dir="ltr" className="normal-case">variant=&quot;auth&quot;</code>}>
            <ThemeToggle />
          </Example>
          <Example label={<code dir="ltr" className="normal-case">variant=&quot;app&quot;</code>}>
            <ThemeToggle variant="app" />
          </Example>
        </div>
      </ComponentDemo>

      <ComponentDemo name="LocaleSwitcher">
        <div className="flex flex-wrap gap-6">
          <Example label={<code dir="ltr" className="normal-case">variant=&quot;select&quot;</code>}>
            <div className="w-fit">
              <LocaleSwitcher />
            </div>
          </Example>
          <Example label={<code dir="ltr" className="normal-case">variant=&quot;pill&quot;</code>}>
            <div className="w-fit">
              <LocaleSwitcher variant="pill" />
            </div>
          </Example>
        </div>
        <div className="mt-4">
          <Example label={<code dir="ltr" className="normal-case">variant=&quot;list&quot;</code>}>
            <LocaleSwitcher variant="list" />
          </Example>
        </div>
      </ComponentDemo>
    </div>
  );
}

/** Archive confirmation; confirming announces the result to screen readers and shows what they heard. */
function ConfirmDemo() {
  const t = useTranslations();
  const announce = useAnnounce();
  const [open, setOpen] = useState(false);
  const [announced, setAnnounced] = useState<string | null>(null);
  const name = t("accounts.types.savings");

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Archive size={16} aria-hidden />
        {t("accounts.actions.archive", { name })}
      </Button>
      {announced && (
        <p className="mt-3 text-caption text-muted-foreground">{t("designSystem.demo.announced", { message: announced })}</p>
      )}
      <ConfirmDialog
        open={open}
        title={t("accounts.archiveDialog.title", { name })}
        confirmLabel={t("accounts.archiveDialog.confirm")}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          const message = t("accounts.announcements.archived", { name });
          setOpen(false);
          announce(message);
          setAnnounced(message);
        }}
      >
        {t("accounts.archiveDialog.description")}
      </ConfirmDialog>
    </>
  );
}
