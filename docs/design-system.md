# Design system

[Back to project README](../README.md)

Developer reference for shared tokens and UI components. The public /design-system page previews them in the current theme and language.

## Design tokens and conventions

| Area | Convention |
|---|---|
| Colors | Tokens in `frontend/app/globals.css`, e.g. `bg-card`, `text-muted-foreground`. |
| Typography | `text-title` for page h1, `text-heading` for dialog titles, `text-subheading` for card headings, `text-body`, `text-label`, `text-caption`, `text-overline` with uppercase; roles combine size, weight and tracking. |
| Focus | `focus-ring` for links/buttons; add `focus-visible:ring-offset-*` when a gap is needed. |
| Icons | `lucide-react`; `aria-hidden` next to visible text; `rtl:-scale-x-100` for arrows. |
| Category icons | `CATEGORY_ICONS` in `components/categories/category-icon.tsx`. |
| Reuse | Use the shared components below instead of copying class strings. |

## UI component catalog

Component types in `frontend/components/ui/` define available props and variants; use `/design-system` to preview them.

| Component / helper | Purpose and usage |
|---|---|
| `Button`, `buttonClassName` | Form/dialog actions; show pending state by disabling and changing the label; use the helper for button-styled links. |
| `IconButton` | Icon-only actions; `label` provides the accessible name and tooltip. |
| `ToggleButton` | On/off icon action; keep the label stable and expose state with `aria-pressed`. |
| `TextField` | Labelled input; link hints/errors and mark invalid fields. |
| `SelectField` | Labelled choice; required by default unless `required={false}`. |
| `ChoiceGroup` and segment helpers | Group radios/checkboxes with a legend and shared error; segmented styles use a `peer sr-only` input followed by a span. |
| `Modal` | Form dialog; mark the initial field `data-autofocus`; busy state blocks closing. |
| `ConfirmDialog` | Destructive-action confirmation; initial focus on Cancel. |
| `LiveStatusProvider`, `useAnnounce` | Announce action results to screen readers, especially when a row disappears. |
| `FormAlert` | Form-level error or success message; `null` hides it. |
| `Card` | Bordered panel; use a labelled semantic section where appropriate. |
| `Badge` and tone helper | Status/value label; meaning must remain clear without color. |
| `EmptyState` | Explain an empty list and optionally link to the next action. |
| `StrengthMeter` | Segmented strength indicator with a text label. |
| `UserAvatar` | Photo with initials fallback; use empty alt text when decorative. |
| `ThemeToggle` | Accessible light/dark switch; label names the destination theme. |
| `LocaleSwitcher` | Language picker for public pages and app navigation. |
