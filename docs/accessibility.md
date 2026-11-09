# Accessibility: WCAG 2.1 AA audit

Target: WCAG 2.1 levels A and AA, for every page of the frontend in light and dark theme, in English and Persian (RTL).

## How it is checked

| Check | Tool | Scope | Run by |
|---|---|---|---|
| Automated scan | `cd frontend && npm run check:a11y` (axe-core 4.14 through Playwright 1.64, Chromium). It is also the `a11y` job of `.github/workflows/frontend.yml`. | `/status`, `/login`, `/register`, `/privacy`, `/terms`, `/design-system`, 404, `/dashboard`, `/accounts`, `/accounts?archived=true`, `/transactions` (also with the filters panel open, an empty search result and the page links), `/analytics`, `/categories`, `/profile`, `/more`, and 13 dialogs and inline forms (new/edit/archive account, new/edit/delete category, new/edit/delete transaction, edit profile, change password, delete profile and its confirmation). Each runs in light and dark, `en` and `fa`, at 1280 px and 320 px: 244 scans. | CI on every frontend PR |
| Reflow and text spacing | The same script fails if a page scrolls sideways at 320 px (equal to 1280 px at 400% zoom), with and without the 1.4.12 text-spacing overrides. | Same as above | CI |
| Contrast of theme tokens | Ratios computed from `app/globals.css` for every text token on every background token, and for `--ring`/`--input` as UI components. | Both themes | Claude Code, 2026-10-28 |
| Focus visibility and order | Scripted Tab walk through each page, failing on any focus stop with no outline or ring, or one that is off screen. | All pages above, 1280 px and 320 px | Claude Code, 2026-10-28 |
| Keyboard-only walkthrough | Manual | Register, create account/category/transaction, edit, delete, transfer, change language/theme, logout | Team |
| Screen reader | VoiceOver, macOS, Safari | The same flows | Team |

The latest scan (2026-11-07) found no failures in 244 scans.

## Success criteria

Status: **Pass**, **N/A** (no such content), **Implemented** (implementation confirmed complete by the team), **Limitation** (known and accepted).

| SC | Level | Name | Status | How verified / notes |
|---|---|---|---|---|
| 1.1.1 | A | Non-text Content | Pass | Named controls, decorative icons hidden, avatar alt text and chart data tables. |
| 1.2.1–1.2.5 | A/AA | Time-based media | N/A | No audio or video. |
| 1.3.1 | A | Info and Relationships | Pass | axe; headings, landmarks, table headers, labels and grouped form controls. |
| 1.3.2 | A | Meaningful Sequence | Pass | DOM order follows the layout; logical CSS properties support RTL. |
| 1.3.3 | A | Sensory Characteristics | Pass | Instructions do not rely only on shape, position or color. |
| 1.3.4 | AA | Orientation | Pass | No orientation lock. Scanned in portrait (320 px) and landscape (1280 px). |
| 1.3.5 | AA | Identify Input Purpose | Pass | Auth/profile fields use appropriate autocomplete values. |
| 1.4.1 | A | Use of Color | Pass | Signs, text labels and states convey meaning without color. |
| 1.4.2 | A | Audio Control | N/A | No audio. |
| 1.4.3 | AA | Contrast (Minimum) | Pass | axe and theme-token checks; see `app/globals.css` for values (minimum recorded text contrast 4.6:1; 4.4:1 red is icons only). |
| 1.4.4 | AA | Resize Text | Pass | Browser zoom to 200% (640 CSS px at 1280) is within the 320 px reflow scan. |
| 1.4.5 | AA | Images of Text | Pass | No images of text. The logo "P" is text. |
| 1.4.10 | AA | Reflow | Pass | `check:a11y` fails on sideways scrolling at 320 px. Tables collapse to rows on narrow screens. |
| 1.4.11 | AA | Non-text Contrast | Pass | Focus rings and field borders meet 3:1; decorative card borders are excluded. |
| 1.4.12 | AA | Text Spacing | Pass / Limitation | `check:a11y` applies the 1.4.12 overrides. Limitation: the sidebar and More page truncate a long email with "…"; the full email is shown on the profile page. |
| 1.4.13 | AA | Content on Hover or Focus | Pass | Only native `title` tooltips. No custom hover or focus popups. |
| 2.1.1 | A | Keyboard | Implemented | Every control is a native `button`, `a`, `input`, `select` or `<dialog>`. |
| 2.1.2 | A | No Keyboard Trap | Implemented | The Tab walk cycles through every page. Dialogs use `showModal()`, and Esc closes them unless a save is running. |
| 2.1.4 | A | Character Key Shortcuts | N/A | No single-key shortcuts. |
| 2.2.1 | A | Timing Adjustable | N/A | No time limits. Sessions last 30 days. |
| 2.2.2 | A | Pause, Stop, Hide | Pass | The dashboard loading pulse stops on load and with `prefers-reduced-motion`. Automatic updates on `/status` can be paused and resumed. |
| 2.3.1 | A | Three Flashes | Pass | Nothing flashes. |
| 2.4.1 | A | Bypass Blocks | Pass | "Skip to content" link to `#main` on app pages, plus landmarks. |
| 2.4.2 | A | Page Titled | Pass | Each page has a translated title. |
| 2.4.3 | A | Focus Order | Pass | Tab order checked; dialogs focus the initial field or Cancel and return focus to the opener. |
| 2.4.4 | A | Link Purpose (In Context) | Pass | axe; links and icon buttons have clear names. |
| 2.4.5 | AA | Multiple Ways | Pass | Shared navigation, dashboard links and profile links. |
| 2.4.6 | AA | Headings and Labels | Pass | axe. One `h1` per page, `h2` per section and dialog title. All fields have visible labels. |
| 2.4.7 | AA | Focus Visible | Pass | Scripted Tab walk: every focus stop shows a ring or outline (ring contrast: see 1.4.11). Supports `forced-colors`. |
| 2.5.1 | A | Pointer Gestures | N/A | No multipoint or path gestures. |
| 2.5.2 | A | Pointer Cancellation | Pass | Actions run on click; backdrop dismissal requires the press to start there. |
| 2.5.3 | A | Label in Name | Pass | axe `label-content-name-mismatch` (fixed, see above). |
| 2.5.4 | A | Motion Actuation | N/A | No motion input. |
| 3.1.1 | A | Language of Page | Pass | `<html lang dir>` follows the chosen locale (`en`, `de`, `uk`, `fa`). |
| 3.1.2 | AA | Language of Parts | Pass | Language options carry lang; mixed-direction user text uses bdi. |
| 3.2.1 | A | On Focus | Pass | Focus never triggers navigation or submission. |
| 3.2.2 | A | On Input | Implemented | Account/language changes keep the user on the page and preserve select focus. |
| 3.2.3 | AA | Consistent Navigation | Pass | One app shell for all protected pages, one auth shell for sign-in and sign-up. |
| 3.2.4 | AA | Consistent Identification | Pass | Shared components use consistent labels, behavior and icons. |
| 3.3.1 | A | Error Identification | Implemented | Field errors are linked to inputs; form errors use role=alert. |
| 3.3.2 | A | Labels or Instructions | Pass | Visible labels on every field. Sign-up states the password minimum below the field (fixed, see above). |
| 3.3.3 | AA | Error Suggestion | Pass | Messages say how to fix the input ("at least 12 characters", "Choose a JPEG or PNG image"). |
| 3.3.4 | AA | Error Prevention (Legal, Financial, Data) | Pass | Destructive actions need confirmation; transactions remain editable and archiving reversible. |
| 4.1.1 | A | Parsing | Pass | React output. The criterion is always satisfied for HTML since the WCAG 2.1 errata. |
| 4.1.2 | A | Name, Role, Value | Implemented | axe. Native elements, `aria-pressed` on toggles, `aria-current` on navigation. |
| 4.1.3 | AA | Status Messages | Implemented | LiveStatusProvider announces results such as saves, archives and deletions. |

## Manual regression checks

The team confirms the accessibility implementation is complete; use these walkthroughs for regression checks and record the date, tester, browser and screen reader when running them.

1. Keyboard only (Chrome and Safari, macOS): register → create account → create category → create expense and income → edit → transfer → delete → change language to فارسی and back → toggle theme → log out. Check that focus is always visible, Esc closes every dialog, and focus returns to the button that opened it.
2. VoiceOver (macOS, Safari): the same flows. Listen for field names and errors, dialog titles and descriptions, the "archived/deleted/saved" announcements, and the current page in the navigation.

Out of scope: WCAG 2.2 and AAA criteria, mobile screen readers (TalkBack, iOS VoiceOver; untested), and the PDF of the print export.

## Pages added later

Add new pages and dialogs to `publicPages`, `protectedPages` or `dialogs` in `frontend/a11y.check.mjs`, and update the scope and scan count above. Charts need a text or table alternative (1.1.1).

The status page is included in the automated scan; `node status.check.mjs` checks its refresh, failure and pause/resume behavior separately.
Manual accessibility verification for the status page was reported complete by the user on 2026-11-02, including VoiceOver navigation.
