# Skeletons — Danger Zones

## Tailwind v4 — NO tailwind.config.ts

**There is no `tailwind.config.ts`.** All theme config is in `src/index.css`.

- Adding TW config file will conflict with `@tailwindcss/vite` plugin
- Dark mode is `@custom-variant dark`, NOT `darkMode: 'class'` in JS config
- `container` is no longer configured via JS — apply utilities directly

## i18n Init Race

`main.tsx` has a `isI18nReady` gate — app renders `null` until i18next resolves. If `i18nInitPromise` rejects, `html.i18n-loading` is removed in the error path and `I18nInitErrorFallback` is shown (English-only copy — `t()` is unavailable).

- Don't call `t()` outside the `I18nextProvider` subtree
- Don't add async providers between `I18nextProvider` and `RouterProvider` without updating the gate

## Lazy Pages + Suspense

Lazy pages MUST be wrapped with `WithSuspense` in the route definition.
Missing `WithSuspense` = uncaught Suspense boundary = blank screen.

## Main landmark + route focus

`Main` exposes `#main` with `tabIndex={-1}`; `App` passes its ref to `useRouteFocus`. Do not drop the pairing or strip `data-route-focus` handling in CSS without an accessibility review — programmatic focus after navigation is intentional.

## DevPlayground — DEV-only by contract

`src/pages/DevPlayground/` and its `/dev/ui` route are mounted only under
`import.meta.env.DEV`. The env guard lives in `src/router/modules/base.routes.tsx`
and must stay there — removing it leaks a shadcn kitchen-sink page into
production bundles. This is a **template seed** (see
`.cursor/brain/TEMPLATE_SEEDS.md`); do not delete it during "remove unused
code" sweeps.

## createSelectors — no direct store subscription in tests

Tests for stores use the base store directly (`useUserStoreBase`), not the selector wrapper.
Selector wrapper relies on React context and will throw outside component tree.

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

CI and lint-staged also run **Oxlint** (`.oxlintrc.json`) before ESLint — fast structural checks; ESLint remains authoritative for TypeScript- and React-specific rules.

## userStore — persist middleware

`userStore` uses Zustand `persist` with `localStorage` key `"user-store"`.

- In tests: `logout()` in `beforeEach` resets in-memory state AND persists null values — test isolation is maintained
- If you add a new domain store with `persist`, do the same: call the reset action in `beforeEach`, or mock `localStorage` in `setup.ts`
- Do not call `persist.clearStorage()` in tests — it leaves the store in an uninitialized state and breaks subsequent tests in the same file
