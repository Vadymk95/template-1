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
| Linting      | ESLint 10 flat + Oxlint (staged)  | 10 / 1.x                  |
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

Current (`src/lib/i18n/constants.ts`): all four scaffolded namespaces are
**eager** — `DEFAULT_NAMESPACES = ['common', 'errors', 'home', 'auth']`,
`LAZY_NAMESPACES = []`. They preload alongside the i18n init promise the app
gates on. To add a lazy feature namespace:

1. Move it from `DEFAULT_NAMESPACES` (or add fresh) to `LAZY_NAMESPACES`.
2. Inside the consuming feature: `useTranslation('feature-namespace')` triggers
   the lazy fetch via `i18next-http-backend` on mount.
3. Wrap in `<WithSuspense>` if you want a fallback during the fetch.

The eager-by-default posture is intentional for a small (<10 KB) JSON tree —
predictable LCP, no double waterfall, no "translation flash" on lazy mount.
Once a namespace exceeds ~5 KB or is route-bounded, move it to lazy.

### Route focus (a11y)

- `useRouteFocus` in `App` receives a ref to `Main` (`#main`, `tabIndex={-1}`); on pathname change (not initial mount) focus moves to the landmark for WCAG 2.4.1; `data-route-focus` gates focus-ring styling in CSS.

### Web Vitals

- `src/lib/vitals.ts` — lazy reporting after hydration; optional `VITE_WEB_VITALS_ATTRIBUTION=true` loads `web-vitals/attribution` via `subscribeAttribution.ts` (flag also in `src/env.ts` for Zod/docs; **branch uses `import.meta.env`** so Vite drops the unused chunk). Load failures: `logger.warn` with context.
- Custom backend: pass `reportWebVitals(yourReporter)`.
- **Re-verify chunk split:** after `npm run build`, `npm run verify:web-vitals-chunks` (checks existing `dist/`; CI runs it after build). Full regression (two builds: default + attribution): `npm run verify:web-vitals-chunks:full`.

### Pre-i18n shell

- `index.html` `#i18n-boot` + `src/index.css`: decorative spinner while `html.i18n-loading` (no translated strings — i18n not ready).

## Dev Tooling

- **Which checks to run** — see `.cursor/brain/VERIFICATION.md`. Targeted checks are for the iteration loop; the gate is what says "done".
- `npm run verify` — **the gate**, all offline checks: `check-hooks` → typecheck → oxlint → eslint → format:check → test:coverage → build → `verify:web-vitals-chunks` → `size:check` → `ensure-playwright` → **`test:e2e:prod`**.
- `npm run verify:ci` — `audit:gate && verify`. Husky **pre-push** runs this, and the GitHub `validate` job is a single step over the same script. `verify` is a strict superset of CI's offline checks, so a green `verify` predicts a green CI — keep it that way by adding new checks to the SCRIPT, never only to the workflow. `ci:local` is an alias.
- `npm run audit:gate` — fail-closed dependency audit (`scripts/audit-gate.mjs`): blocks every high/critical advisory, an expired or stale allowance in `scripts/audit-allowlist.json`, and its own inability to complete. Not inside `verify` because it needs the network.
- `npm run fix` — the one remedy command: `oxlint --fix` → `eslint --fix` → `prettier --write`, repo-wide.
- `npm run bench:verify` — the gate step by step with timings, to attribute a slow run.
- `npm run test:e2e:prod` — Playwright against `vite preview` (same mode as CI / the gate). Browsers are installed on demand by `scripts/ensure-playwright.mjs`, which reads the exact build paths out of `playwright install --dry-run`.
- `npm run dev` — Vite dev server (`vite.config.ts` pins port 3000). ESLint runs via the IDE extension (recommended in `.vscode/extensions.json`) and in `lint-staged` — no in-Vite linter.
- `npm run build` — `tsc -b` then Vite production build (Rolldown)
- `npm run verify:web-vitals-chunks` — asserts chunk split on the current `dist/` (run after `build`); `verify:web-vitals-chunks:full` — two production builds asserting standard vs attribution variants (use after changing `src/lib/vitals.ts` or env wiring)
- `npm run size:check` — per-chunk brotli budgets from `.size-limit.json`
- `npm run build:analyze` — bundle visualizer (`ANALYZE=true`)
- `npm run typecheck` — `tsc -b` only
- `npm run test` — Vitest run. **The gate uses `test:coverage`**: thresholds in `vitest.config.ts` only enforce when `--coverage` is passed.
- `npm run lint` — **ESLint 10** flat: `typescript-eslint` **strict + stylistic** (type-aware), `import-x` (**order**, **no-cycle**, **no-restricted-paths** for layer boundaries), `no-magic-numbers`, a raw-hex ban in `components`/`pages`, `i18next/no-literal-string`, parent-relative imports under `src/**` restricted (use `@/` or `@locales/`); `vite-plugins/**` may use `../src/**` (loads before Vite resolves `@/`). `settings.react.version` is pinned to a literal — `'detect'` crashes under ESLint 10, see `DECISIONS.md`.
- **E2E** — Playwright (`e2e/`, `playwright.config.ts`): local default `npm run test:e2e` starts **`vite` dev** on port 3000; CI / `test:e2e:prod` / `PLAYWRIGHT_USE_PREVIEW=1` uses **`vite preview`** on 4173 after `build`.
- **Security workflow** — `.github/workflows/security.yml`: gitleaks over full history plus CodeQL `security-extended`, on push, PR and a weekly cron. Runs in parallel with `validate`, not from `verify`. Exclusions live in `.github/codeql/codeql-config.yml` with their reason.
- Pre-commit: `lint-staged` (oxlint fix → eslint fix → Prettier) on the staged set, then the TDD sibling gate, then **repo-wide** oxlint and `format:check` — because `lint-staged` restores unstaged hunks after fixing, which used to leave already-fixed files uncommitted.
- **Agent commands** — `.claude/commands/`: `/onboard`, `/feat`, `/test`, `/review`, `/docs`, each mirrored by a shim in `.cursor/commands/`.
