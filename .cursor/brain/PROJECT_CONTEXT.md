# react-enterprise-foundation — Project Context

## Purpose

Production-ready React SPA template. Copy, rename, start building. Includes all the boring setup (DX tooling, i18n, routing, state, testing, CI) so you don't repeat it.

## Tech Stack

| Layer        | Choice                            | Version                   |
| ------------ | --------------------------------- | ------------------------- |
| UI           | React                             | 19                        |
| Language     | TypeScript                        | 6.0 strict                |
| Bundler      | Vite + Rolldown (official `vite`) | 8                         |
| Styling      | Tailwind CSS                      | **v4** (CSS-based config) |
| Components   | shadcn/ui (new-york)              | latest                    |
| Global State | Zustand + devtools                | 5                         |
| Server State | TanStack Query                    | 5                         |
| Routing      | React Router                      | 7                         |
| Forms        | react-hook-form + zod             | 7 / 4                     |
| i18n         | i18next + react-i18next           | 26 / 17                   |
| Testing      | Vitest + Testing Library          | 4                         |
| Linting      | ESLint 9 flat + Oxlint (staged)   | 9 / 1.x                   |
| Formatting   | Prettier                          | 3                         |
| Git hooks    | Husky + commitlint + lint-staged  | 9 / 20                    |

## Architecture

```
src/
  components/
    common/      # App-level: ErrorBoundary, RouteErrorBoundary, RouteSkeleton, SkipLink, I18nInitErrorFallback, ThemeToggle, LanguageSwitcher
    layout/      # Header, Footer, Main (`#main` landmark + route-focus hook)
    ui/          # shadcn/ui primitives
  hocs/          # WithSuspense, ProtectedRoute (auth gate for nested routes)
  hooks/
    a11y/        # useRouteFocus — focus `#main` on client navigations (skips first paint)
    i18n/        # useI18nReload (dev HMR)
    theme/       # useTheme (light / dark / system)
    <domain>/    # Feature hooks with tests alongside
  mocks/
    browser.ts   # DEV-only MSW `setupWorker` (handlers from `test/handlers`)
  lib/
    api/         # client, auth; `greeting.*` = minimal wired Query + transport (HomePage); `_example.*` = unwired pattern seeds
    i18n/        # i18next setup, constants, resources
    webVitals/   # subscribeStandard / subscribeAttribution (loaded from vitals.ts)
    queryClient.ts  # TanStack Query client factory
    env.ts       # @t3-oss/env-core validated public env
    vitals.ts, logger, utils  # observability + cn()
  pages/
    HomePage/       # Index route (not lazy); `index.ts` re-exports `HomePage.tsx`
    LoginPage/      # Auth UI (lazy)
    DashboardPage/  # Behind ProtectedRoute (lazy)
    NotFoundPage/   # Catch-all (lazy)
    DevPlayground/  # DEV-only sandbox
  router/
    index.tsx    # createBrowserRouter assembly
    modules/     # base.routes.tsx (+ future route modules)
    routes.ts    # Path constants (e.g. DevPlayground → /dev/ui)
  store/
    user/        # userStore + tests
    utils/       # createSelectors
  test/
    setup.ts, server.ts, handlers.ts, test-utils
```

## Key Patterns

### TanStack Query — `queryOptions()` + key factories

New features add a `queries.ts` (or `*.queries.ts`) under `src/lib/api/`: a stable **key factory** and **per-query** `queryOptions()` factories. Components call `useQuery(...)` with those options directly; add a thin custom hook only when it wraps real logic (not for every fetch). Unwired pattern reference: `_example.queries.ts`; minimal wired example used on the home route: `greeting.queries.ts`.

### Tailwind v4 (IMPORTANT — no tailwind.config.ts)

- Config lives in `src/index.css` via `@theme inline {}`
- Dark mode via `@custom-variant dark (&:where(.dark, .dark *))`
- Animations via `tw-animate-css` (import in CSS, not a JS plugin)
- Custom animations defined as `@keyframes` + `--animate-*` in `@theme`

### Components: presentational + hook

Feature components use a folder per component: UI in `ComponentName.tsx`, logic in `useComponentName.ts`, tests alongside. Layout and shared pieces follow the same idea where it applies.

### Stores: Zustand + createSelectors

`createSelectors` enables `useStore.use.field()` auto-selectors; the standard callback selector remains available. See `src/store/user/` for the persisted user store pattern.

### Pages: lazy by default

Non-index routes use `PageName.tsx` plus `index.ts` with `lazy(() => import('./PageName'))`; the router wraps lazy pages in `WithSuspense`. The home index route stays eager.

### i18n namespace strategy

- `common` — always loaded (buttons, labels)
- `errors` — always loaded (API/validation errors)
- `home` — loaded with HomePage
- Feature namespaces — lazy loaded on demand

### Route focus (a11y)

- `useRouteFocus` in `App` receives a ref to `Main` (`#main`, `tabIndex={-1}`); on pathname change (not initial mount) focus moves to the landmark for WCAG 2.4.1; `data-route-focus` gates focus-ring styling in CSS.

### Web Vitals

- `src/lib/vitals.ts` — lazy reporting after hydration; optional `VITE_WEB_VITALS_ATTRIBUTION=true` loads `web-vitals/attribution` via `subscribeAttribution.ts` (flag also in `src/env.ts` for Zod/docs; **branch uses `import.meta.env`** so Vite drops the unused chunk). Load failures: `logger.warn` with context.
- Custom backend: pass `reportWebVitals(yourReporter)`.
- **Re-verify chunk split:** after `npm run build`, `node scripts/check-web-vitals-chunks.mjs` (CI runs this on `dist/`). Full regression (two builds: default + attribution): `npm run verify:web-vitals-chunks`.

### Pre-i18n shell

- `index.html` `#i18n-boot` + `src/index.css`: decorative spinner while `html.i18n-loading` (no translated strings — i18n not ready).

## Dev Tooling

- **Which checks to run** — see `.cursor/brain/VERIFICATION.md` (point-in-time vs full `ci:local`; avoids running audit/build/vitals for every small change).
- `npm run ci:local` — mirrors `.github/workflows/ci.yml` locally (audit → typecheck → oxlint → eslint → format → test:coverage → build → web-vitals chunk check).
- `npm run dev` — Vite dev server (`vite.config.ts` pins port 3000). ESLint runs via the IDE extension (recommended in `.vscode/extensions.json`) and as a pre-commit gate in `lint-staged` — no in-Vite linter.
- `npm run build` — `tsc -b` then Vite production build (Rolldown)
- `npm run verify:web-vitals-chunks` — asserts standard vs attribution web-vitals chunks (two production builds; use after changing `src/lib/vitals.ts` or env wiring)
- `npm run build:analyze` — bundle visualizer (`ANALYZE=true`)
- `npm run typecheck` — `tsc -b` only (also used in CI before lint)
- `npm run test` — Vitest run
- `npm run lint` — ESLint 9 flat: `typescript-eslint` **strict + stylistic** (type-aware), `import-x` (**order**, **no-cycle**), parent-relative imports under `src/**` restricted (use `@/` or `@locales/` for locale JSON); `vite-plugins/**` may use `../src/**` (loads before Vite resolves `@/`). `lint:oxlint` runs first in CI.
- **E2E** — Playwright (`e2e/`, `playwright.config.ts`): local default `npm run test:e2e` starts **`vite` dev** on port 3000; CI / `PLAYWRIGHT_USE_PREVIEW=1` uses **`vite preview`** on 4173 after `build`. Chromium installed via `npx playwright install --with-deps chromium` in CI and `ci:local`.
- Staged commits: Oxlint fix → ESLint fix → Prettier (see `lint-staged` in package.json)
