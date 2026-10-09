# react-enterprise-foundation — Project Context

Production-ready React SPA template. Copy, rename, start building: DX tooling, i18n, routing, state, testing and CI are already wired.

## Tech Stack

The one stack table. Versions are `package.json`; held packages are `scripts/version-holds.json`.

| Layer        | Choice                            | Version                                   |
| ------------ | --------------------------------- | ----------------------------------------- |
| UI           | React                             | 19                                        |
| Language     | TypeScript                        | 6.0 strict (held)                         |
| Bundler      | Vite + Rolldown (official `vite`) | 8                                         |
| Styling      | Tailwind CSS                      | **v4** (CSS-based config)                 |
| Components   | shadcn/ui (new-york)              | latest                                    |
| Global State | Zustand + devtools                | 5                                         |
| Server State | TanStack Query                    | 5                                         |
| Routing      | React Router                      | 7                                         |
| Forms        | react-hook-form + zod             | 7 / 4                                     |
| i18n         | i18next + react-i18next           | 26 / 17                                   |
| Testing      | Vitest + Testing Library          | 4.1 (held)                                |
| Linting      | ESLint 10 flat + Oxlint (staged)  | 10 / 1.x                                  |
| Formatting   | Prettier                          | 3                                         |
| Git hooks    | Husky + commitlint + lint-staged  | 9 / 21                                    |

## Architecture

```
src/
  components/
    common/      # ErrorBoundary, RouteErrorBoundary, RouteSkeleton, SkipLink, I18nInitErrorFallback, ThemeToggle, LanguageSwitcher
    layout/      # Header, Footer, Main (`#main` landmark)
    ui/          # shadcn/ui primitives
  hocs/          # WithSuspense, ProtectedRoute
  hooks/         # a11y/ (useRouteFocus), i18n/ (useI18nReload), theme/ (useTheme), <domain>/ with tests alongside
  mocks/browser.ts   # DEV-only MSW worker (handlers from test/handlers)
  lib/
    api/         # client, auth; `greeting.*` = wired Query + transport (HomePage); `_example.*` = unwired pattern seeds
    i18n/        # i18next setup, constants, resources
    webVitals/   # subscribeStandard / subscribeAttribution (loaded from vitals.ts)
    queryClient.ts, vitals.ts, logger, utils (cn)
  pages/         # HomePage (eager index route), LoginPage, DashboardPage (behind ProtectedRoute), NotFoundPage, DevPlayground (DEV-only) — all but the index lazy
  router/        # index.tsx (createBrowserRouter), modules/ (route modules), routes.ts (path constants)
  store/         # user/ (userStore + tests), utils/ (createSelectors)
  test/          # setup.ts, server.ts, handlers.ts, test-utils
  env.ts         # @t3-oss/env-core validated public env
```

Flows, the "add a page / feature" recipes, routing: `MAP.md`.

## Key Patterns

- **TanStack Query**: a `queries.ts` under `src/lib/api/` holds a stable key factory and per-query `queryOptions()` factories; components call `useQuery(...)` with them directly, and a thin hook only wraps real logic. Unwired reference: `_example.queries.ts`; wired and minimal: `greeting.queries.ts`.
- **Components**: a folder per component, UI in `Name.tsx`, logic in `useName.ts`, tests alongside (`react-patterns.mdc` § 2).
- **Stores**: Zustand with `createSelectors` (`useStore.use.field()`); the persisted user store in `src/store/user/` is the pattern.

### i18n namespace strategy

All four scaffolded namespaces are eager (`src/lib/i18n/constants.ts`: `DEFAULT_NAMESPACES = ['common', 'errors', 'home', 'auth']`, `LAZY_NAMESPACES = []`) and preload with the i18n init promise the app gates on. Eager is intentional for a small (<10 KB) JSON tree: predictable LCP, no double waterfall, no translation flash. Go lazy once a namespace exceeds about 5 KB or is route-bounded: move it to `LAZY_NAMESPACES`; `useTranslation('feature-namespace')` then fetches it through `i18next-http-backend` on mount, wrapped in `<WithSuspense>` for a fallback.

## Dev Tooling

- **The gate, its moments and scripts**: `AGENTS.md` § Commands / the gate is the only definition; stage timings and what was deliberately not added: `VERIFICATION.md`; the full script list: `package.json`.
- `npm run dev` serves on port 3000 (`vite.config.ts`). ESLint runs through the IDE extension (`.vscode/extensions.json`) and `lint-staged`, not inside Vite.
- **E2E**: Playwright (`e2e/`, `playwright.config.ts`). Local `npm run test:e2e` starts `vite` dev on 3000; CI, `test:e2e:prod` and `PLAYWRIGHT_USE_PREVIEW=1` use `vite preview` on 4173 after `build`. Browsers install on demand through `scripts/ensure-playwright.mjs`.
