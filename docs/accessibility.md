# Accessibility: WCAG 2.1 AA audit

Target: WCAG 2.1 levels A and AA, for every page of the frontend in light and dark theme, in English and Persian (RTL).

## How it is checked

| Check | Tool | Scope | Run by |
|---|---|---|---|
| Automated scan | `cd frontend && npm run check:a11y` (axe-core 4.14 through Playwright 1.64, Chromium). It is also the `a11y` job of `.github/workflows/frontend.yml`. | `/login`, `/register`, `/privacy`, `/terms`, 404, `/dashboard`, `/accounts`, `/accounts?archived=true`, `/transactions`, `/categories`, `/profile`, `/more`, and 10 dialogs and inline forms (new/edit/archive account, new/edit/delete category, new/edit/delete transaction, edit profile). Each runs in light and dark, `en` and `fa`, at 1280 px and 320 px: 172 scans. | CI on every frontend PR |
| Reflow and text spacing | The same script fails if a page scrolls sideways at 320 px (equal to 1280 px at 400% zoom), with and without the 1.4.12 text-spacing overrides. | Same as above | CI |
| Contrast of theme tokens | Ratios computed from `app/globals.css` for every text token on every background token, and for `--ring`/`--input` as UI components. | Both themes | Claude Code, 2026-10-28 |
| Focus visibility and order | Scripted Tab walk through each page, failing on any focus stop with no outline or ring, or one that is off screen. | All pages above, 1280 px and 320 px | Claude Code, 2026-10-28 |
| Keyboard-only walkthrough | Manual | Register, create account/category/transaction, edit, delete, transfer, change language/theme, logout | **Pending: team** |
| Screen reader | VoiceOver, macOS, Safari | The same flows | **Pending: team** |

The latest scan found no failures (0 of 172 scans; axe best-practice rules also run clean).

## Fixed in this audit

| Criterion | Problem | Fix |
|---|---|---|
| 1.4.11 | Light focus ring `#94a3b8` was 2.4–2.6:1 on cards and fields. | `--ring: #64748b` (4.5–4.8:1). |
| 1.4.11 | Light field border `--input: #e7ecf2` was 1.1:1, so fields had no visible edge. | `--input: #7d8ba1` (3.25:1 on fields, 3.45:1 on cards). |
| 1.4.3 | Light red text on the red tint (form errors, the delete button on hover, expense badges) was 3.95:1. | `--destructive: #b91c1c` (5.3:1 on `--danger-bg`). `--danger-fg` is now always equal to it, so it was removed, together with the `text-red-700` workaround. |
| 1.4.3 | Text on the green end of the gradient (auth hero, the More page's profile card) was 4.2:1 (hero description: 2.9:1). | White text there: at least 5.0:1 in both themes. |
| 2.5.3 | The sidebar profile link's `aria-label` ("Name, Profile") left out the visible email. | The visible text is now the accessible name, followed by a visually hidden ", Profile". |
| 1.4.12 | At 320 px with text spacing, the transactions page scrolled sideways: the type filter by 26 px, then the table by 8 px (20 px in German, from the header "BESCHREIBUNG"). | The filter tabs wrap. Table cells use `overflow-wrap: anywhere` (unlike `break-word`, it lets a table column shrink). |
| 1.4.10 | The profile page truncated long email addresses, so the full address was not visible anywhere. | The email wraps on the profile page. |
| 3.3.2 | Sign-up showed the 12-character password minimum only as an error after submitting. | `TextField` takes a `hint` (linked with `aria-describedby`, like `SelectField`), and the password field shows "At least 12 characters". |

## Success criteria

Status: **Pass**, **N/A** (no such content), **Pending** (needs the manual check above), **Limitation** (known and accepted).

| SC | Level | Name | Status | How verified / notes |
|---|---|---|---|---|
| 1.1.1 | A | Non-text Content | Pass | axe. Icons are `aria-hidden` next to text or inside named buttons. Avatars have alt text, or `alt=""` when the name is next to them. The dashboard figures and category shares are text (`<dl>`, `<ul>`); bars are decoration. |
| 1.2.1–1.2.5 | A/AA | Time-based media | N/A | No audio or video. |
| 1.3.1 | A | Info and Relationships | Pass | axe. Headings, landmarks (`header`, `nav`, `main`, `aside`, `footer`), `<table>` with header cells, `<fieldset>`/`<legend>` for radio and checkbox groups, labels bound to fields. |
| 1.3.2 | A | Meaningful Sequence | Pass | DOM order matches visual order. Layout uses logical properties, so RTL mirrors without reordering. |
| 1.3.3 | A | Sensory Characteristics | Pass | Code review. No instruction refers to shape, position or colour only. |
| 1.3.4 | AA | Orientation | Pass | No orientation lock. Scanned in portrait (320 px) and landscape (1280 px). |
| 1.3.5 | AA | Identify Input Purpose | Pass | Code review. `autocomplete` is `name`, `email`, `new-password` or `current-password` on the auth and profile fields. |
| 1.4.1 | A | Use of Color | Pass | Code review. Amounts carry a sign (`+`/`−`), income/expense badges have text, the active nav item has `aria-current` and a filled pill, errors have text. |
| 1.4.2 | A | Audio Control | N/A | No audio. |
| 1.4.3 | AA | Contrast (Minimum) | Pass | axe (both themes) plus token ratios. Light: muted text 4.6–5.2:1, red 5.3–6.5:1, green 4.6–5.0:1. Dark: muted 6.1–7.7:1, red 4.4–5.6:1 (4.4 only for icons), green 6.8–8.5:1. Text on gradients is white (5.0:1 or more). |
| 1.4.4 | AA | Resize Text | Pass | Browser zoom to 200% (640 CSS px at 1280) is within the 320 px reflow scan. |
| 1.4.5 | AA | Images of Text | Pass | No images of text. The logo "P" is text. |
| 1.4.10 | AA | Reflow | Pass | `check:a11y` fails on sideways scrolling at 320 px. Tables collapse to rows on narrow screens. |
| 1.4.11 | AA | Non-text Contrast | Pass | Token ratios: focus ring 4.5:1 (light) and 5.2:1 (dark), field borders 3.25:1 and 3.07:1, active nav pill and buttons are filled. Card borders are decoration, not needed to identify a control. |
| 1.4.12 | AA | Text Spacing | Pass / Limitation | `check:a11y` applies the 1.4.12 overrides. Limitation: the sidebar and More page truncate a long email with "…"; the full email is shown on the profile page. |
| 1.4.13 | AA | Content on Hover or Focus | Pass | Only native `title` tooltips. No custom hover or focus popups. |
| 2.1.1 | A | Keyboard | Pending | Every control is a native `button`, `a`, `input`, `select` or `<dialog>`. Confirm with the keyboard walkthrough. |
| 2.1.2 | A | No Keyboard Trap | Pass / Pending | The Tab walk cycles through every page. Dialogs use `showModal()`, and Esc closes them unless a save is running. Confirm in the walkthrough. |
| 2.1.4 | A | Character Key Shortcuts | N/A | No single-key shortcuts. |
| 2.2.1 | A | Timing Adjustable | N/A | No time limits. Sessions last 30 days. |
| 2.2.2 | A | Pause, Stop, Hide | Pass | The only animation is the dashboard loading pulse, which stops on load and with `prefers-reduced-motion`. |
| 2.3.1 | A | Three Flashes | Pass | Nothing flashes. |
| 2.4.1 | A | Bypass Blocks | Pass | "Skip to content" link to `#main` on app pages, plus landmarks. |
| 2.4.2 | A | Page Titled | Pass | Every page sets a `title` through `generateMetadata` ("Accounts · Expense Tracker"). The transactions title names the account. |
| 2.4.3 | A | Focus Order | Pass | Scripted Tab walk: no focus stop off screen. Dialogs start on their first field, or on Cancel for confirmations, and return focus to the opener. |
| 2.4.4 | A | Link Purpose (In Context) | Pass | axe. Icon buttons are named after their object ("Edit Checking"). "View all" is described by its section heading. |
| 2.4.5 | AA | Multiple Ways | Pass | Main navigation on every page (sidebar, or tab bar plus More), dashboard links to transactions and accounts, profile reachable from the sidebar tile and the avatar. |
| 2.4.6 | AA | Headings and Labels | Pass | axe. One `h1` per page, `h2` per section and dialog title. All fields have visible labels. |
| 2.4.7 | AA | Focus Visible | Pass | Scripted Tab walk: every focus stop shows a ring or outline (ring contrast: see 1.4.11). Supports `forced-colors`. |
| 2.5.1 | A | Pointer Gestures | N/A | No multipoint or path gestures. |
| 2.5.2 | A | Pointer Cancellation | Pass | Actions run on `click` (up-event). A dialog backdrop closes it only if the press also started on the backdrop. |
| 2.5.3 | A | Label in Name | Pass | axe `label-content-name-mismatch` (fixed, see above). |
| 2.5.4 | A | Motion Actuation | N/A | No motion input. |
| 3.1.1 | A | Language of Page | Pass | `<html lang dir>` follows the chosen locale (`en`, `de`, `uk`, `fa`). |
| 3.1.2 | AA | Language of Parts | Pass | Language options carry their own `lang`. User content is wrapped in `<bdi>` where it sits inside translated text. |
| 3.2.1 | A | On Focus | Pass | Focus never triggers navigation or submission. |
| 3.2.2 | A | On Input | Pass / Pending | The account and language selects apply on change, but they update the current page in place and keep focus on the select. Confirm with VoiceOver that the update is noticeable. |
| 3.2.3 | AA | Consistent Navigation | Pass | One app shell for all protected pages, one auth shell for sign-in and sign-up. |
| 3.2.4 | AA | Consistent Identification | Pass | The same components (`Button`, `TextField`, `SelectField`, `Modal`, `ConfirmDialog`) and icon meanings everywhere. |
| 3.3.1 | A | Error Identification | Pass / Pending | Inline errors under each field, linked with `aria-describedby` and `aria-invalid`. Form-level errors use `role="alert"`. Confirm announcements with VoiceOver. |
| 3.3.2 | A | Labels or Instructions | Pass | Visible labels on every field. Sign-up states the password minimum below the field (fixed, see above). |
| 3.3.3 | AA | Error Suggestion | Pass | Messages say how to fix the input ("at least 12 characters", "Choose a JPEG or PNG image"). |
| 3.3.4 | AA | Error Prevention (Legal, Financial, Data) | Pass | Destructive actions ask for confirmation (delete transaction or category, archive account). Transactions stay editable, and archiving can be undone. |
| 4.1.1 | A | Parsing | Pass | React output. The criterion is always satisfied for HTML since the WCAG 2.1 errata. |
| 4.1.2 | A | Name, Role, Value | Pass / Pending | axe. Native elements, `aria-pressed` on toggles, `aria-current` on navigation. Confirm states with VoiceOver. |
| 4.1.3 | AA | Status Messages | Pass / Pending | `LiveStatusProvider` (`role="status"`, present from page load) announces results such as "Checking archived". Confirm with VoiceOver. |

## Manual checks still to do

The rows marked **Pending** need a person. Record the result here: date, who, browser, screen reader.

1. Keyboard only (Chrome and Safari, macOS): register → create account → create category → create expense and income → edit → transfer → delete → change language to فارسی and back → toggle theme → log out. Check that focus is always visible, Esc closes every dialog, and focus returns to the button that opened it.
2. VoiceOver (macOS, Safari): the same flows. Listen for field names and errors, dialog titles and descriptions, the "archived/deleted/saved" announcements, and the current page in the navigation.

Out of scope: WCAG 2.2 and AAA criteria, mobile screen readers (TalkBack, iOS VoiceOver; untested), and the PDF of the print export.

## Pages added later

The analytics, status and design-system pages (#144, #146, #148, #149) do not exist yet. Add each new page to `publicPages`, `protectedPages` or `dialogs` in `frontend/a11y.check.mjs`. Charts need a text or table alternative (1.1.1).
