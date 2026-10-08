# Frontend

Next.js 16 (App Router), React 19, Tailwind 4. See the root `CLAUDE.md` for the full stack and
`docs/design/README.md` for the design tokens.

## Getting started

```bash
cp .env.example .env.local   # when running outside Docker
npm run dev                  # http://localhost:3000
npm run lint
npm run build
```

## Internationalization & RTL

The app supports **English, German, Ukrainian and Persian (RTL)**, using
[next-intl](https://next-intl.dev). The design decisions come from issue #7.

### How the language is chosen

There are no locale prefixes in URLs (`/login` is `/login` in every language). The language is
decided per request in `i18n/request.ts`:

1. the `locale` cookie, written by the language switcher;
2. otherwise the browser's `Accept-Language`;
3. otherwise English.

The root layout renders `<html lang dir>` on the server, so RTL pages never flash LTR first.

### Adding or changing text

- Every user-facing string lives in `messages/<locale>.json`. **Add a new key to all four
  files.** The keys are typed from `en.json` (see `global.d.ts`), so a missing or misspelled key
  in code fails `tsc` and the build.
- Server components: `const t = await getTranslations("namespace")` from `next-intl/server`.
- Client components: `const t = useTranslations("namespace")` from `next-intl`.
- Page titles: `generateMetadata` with `getTranslations("metadata")`.
- Never build sentences by concatenating translations. Use placeholders such as
  `"Net balance · {month}"`, and ICU plurals where a count is involved (Ukrainian needs
  `one`/`few`/`many`).
- Don't show backend `error` strings to users; they are English. Map the HTTP status or a
  validation code to a translated message, as the auth forms do (`components/auth/form-parts.tsx`).

### Numbers, money and dates

Never hard-code `€1,729.55` or `Aug`. Use the formatter (`getFormatter()` on the server,
`useFormatter()` on the client). It applies each locale's separators, digits and calendar:
German gets `1.729,55 €`, and Persian gets Persian digits and the Solar Hijri calendar.

### RTL rules

- **Use logical properties only:** `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start` and
  `text-end`, never `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`. Flex and grid already
  follow `dir`, so with logical properties the layout mirrors by itself.
- Directional icons (arrows, trends, chevrons) get `rtl:-scale-x-100`. Non-directional icons
  stay as they are.
- Inherently left-to-right input (email, password, IBAN) gets `dir="ltr"`. Free text such as
  names inherits the page direction. Avoid `dir="auto"` there: an empty field resolves to LTR,
  which puts the placeholder on the wrong side in RTL.
- Gradients take their angle from `--grad-angle` / `--grad-panel-angle`, which `[dir="rtl"]`
  mirrors in `app/globals.css`.

### Adding a language

1. Add its code to `locales` in `i18n/config.ts`, along with its native name in `localeNames`.
   For an RTL language, also add it to `rtlLocales`.
2. Create `messages/<code>.json` with every key from `en.json`.
3. If its script isn't covered by Geist (Latin and Cyrillic) or Vazirmatn (Arabic), add a font in
   `app/layout.tsx` and append it to `--font-sans` in `app/globals.css`.
