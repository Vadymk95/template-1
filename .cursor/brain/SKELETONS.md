# Skeletons — Danger Zones

## Tailwind v4 — NO tailwind.config.ts

**There is no `tailwind.config.ts`.** All theme config is in `src/index.css`.

- Adding TW config file will conflict with `@tailwindcss/vite` plugin
- Dark mode is `@custom-variant dark`, NOT `darkMode: 'class'` in JS config
- `container` is no longer configured via JS — apply utilities directly

## i18n Init Race

`main.tsx` has a `isI18nReady` gate — app renders `null` until i18next resolves.

- Don't call `t()` outside the `I18nextProvider` subtree
- Don't add async providers between `I18nextProvider` and `RouterProvider` without updating the gate

## Lazy Pages + Suspense

Lazy pages MUST be wrapped with `WithSuspense` in the route definition.
Missing `WithSuspense` = uncaught Suspense boundary = blank screen.

## createSelectors — no direct store subscription in tests

Tests for stores use the base store directly (`useUserStoreBase`), not the selector wrapper.
Selector wrapper relies on React context and will throw outside component tree.

## DevPlayground

`src/pages/DevPlayground/` is a dev sandbox. Remove before production or add a prod guard.

## Vite 8 + Rolldown

Production builds use **Rolldown** via the official **`vite`** package (Vite 8+), not the legacy `rolldown-vite` npm alias.

- Follow [Vite 8 migration](https://vite.dev/guide/migration): prefer `build.rolldownOptions` and `output.codeSplitting.groups` over deprecated `rollupOptions` / `manualChunks`
- CJS default export interop and chunking behavior can differ from Rollup-era Vite — see migration guide if a dependency breaks
- Some plugins may still assume Rollup-only hooks — test new plugins on `npm run build`

## tw-animate-css vs tailwindcss-animate

This project uses `tw-animate-css` (CSS import, no PostCSS plugin).
`tailwindcss-animate` (the old PostCSS plugin) will NOT work with `@tailwindcss/vite`.
Don't add `tailwindcss-animate` as a dependency — it's a breaking conflict.

## husky + commitlint

Pre-commit: lint + format on staged files (lint-staged)
Commit-msg: commitlint (`type(scope): subject`, max 96 chars)
Pre-push: TypeScript project check via `npx tsc -b --force --noEmit`

Skipping hooks (`--no-verify`) bypasses all checks — don't do it.

## ESLint flat config

`eslint.config.js` is the only ESLint config. Do not add a legacy `.eslintrc.*` — flat config owns all rules; a second config file risks confusion and stale docs.
