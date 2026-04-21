# Architecture Map

## Entry Points

| File                   | Role                                                |
| ---------------------- | --------------------------------------------------- |
| `index.html`           | HTML shell — `i18n-loading` FOUC guard + `#i18n-boot` decorative spinner until i18n ready |
| `src/main.tsx`         | Async bootstrap: optional DEV MSW worker (`src/mocks/browser.ts`, opt-out `VITE_ENABLE_MSW=false`) → root: i18n ready gate (or `I18nInitErrorFallback` on init failure) → `I18nextProvider` → QueryClient → Router; `reportWebVitals()` after mount |
| `src/App.tsx`          | Layout shell: ErrorBoundary → Header/Main/Footer    |
| `src/router/index.tsx` | Router assembly, merge route modules here           |

## Adding a New Page

1. Create page files: lazy routes use `FooPage.tsx` + `index.ts` with `lazy()`; the index route (`HomePage`) is eager — export the page from `index.ts` (re-exporting `HomePage.tsx`; see `pages/HomePage/`)
2. Add route to `src/router/modules/base.routes.tsx` (or new module)
3. Wrap with `WithSuspense` in route element
4. Add translations: `public/locales/en/foo.json`
5. Add route name constant to `src/router/routes.ts`

## Adding a New Feature

1. New store → `src/store/<domain>/store.ts` + `store.test.ts`
2. Hooks → `src/hooks/<domain>/useHook.ts` + `useHook.test.ts`
3. Components → `src/components/<domain>/Component/` (tsx + hook + test)
4. Server state → `src/lib/api/<domain>.queries.ts`: export a **key factory** + `queryOptions()` factories; `useQuery(detailOptions(id))` in UI, or a thin hook only when wrapping adds value (pattern seeds: `src/lib/api/_example.queries.ts`; minimal wired pair in app: `greeting.queries.ts` / `greeting.ts` on HomePage)
5. API transport / client calls → `src/lib/api/<domain>.ts` (template: `src/lib/api/_example.ts`; wired transport alongside: `greeting.ts`)

> All files prefixed `_` under `src/lib/api/` are **template seeds** — kept as canonical pattern references, not wired into the app. See [`TEMPLATE_SEEDS.md`](./TEMPLATE_SEEDS.md) before deleting any.

## Adding a shadcn Component

Use the shadcn CLI; primitives land under `src/components/ui/`. `components.json` targets Tailwind v4 (no separate JS theme file).

## State Boundaries

```
Zustand  →  global UI/auth state (e.g. userStore; add domain stores under `src/store/<domain>/`)
           userStore uses persist middleware → survives page refresh (localStorage key: "user-store")
           getAuthToken() exported for apiClient — avoids circular imports
TanStack →  server data, caching, background refetch
Local    →  component-only state (useState)
```

## Routing

```
/            → HomePage (index route, not lazy)
/login       → LoginPage (lazy + WithSuspense)
/dashboard   → DashboardPage (lazy + WithSuspense; parent layout ProtectedRoute → redirect to /login if unauthenticated)
/*           → NotFoundPage (lazy + WithSuspense)
/dev/ui      → DevPlayground (DEV only, lazy + WithSuspense; omitted in production build — template seed)
```

## i18n Flow

```
app start → i18next init → loads common + errors + <current page ns>
→ RootProviders: isI18nReady gate; init rejection → English-only error UI (no i18n)
→ document.lang set
→ HMR: useI18nReload watches public/locales/** in dev
```

## Observability (Web Vitals)

`src/lib/vitals.ts` schedules reporting after paint; dynamic imports pick `subscribeStandard` vs `subscribeAttribution` from `src/lib/webVitals/`. CI runs `scripts/check-web-vitals-chunks.mjs` on `dist/` after build to guard chunk split (see `DECISIONS.md`).

## CSS / Theming

```
src/index.css — single source of truth for Tailwind v4:
  @import "tailwindcss"    — base + utilities
  @import "tw-animate-css" — animation utilities
  @custom-variant dark     — class-based dark mode
  @theme inline {}         — maps TW utility names → CSS variables
  :root / .dark {}         — HSL design tokens
```

Dark mode toggle: `src/hooks/theme/useTheme.ts`
- Modes: `'light' | 'dark' | 'system'` (system follows OS preference)
- Toggles `.dark` class on `<html>`, persists to `localStorage` key `"theme"`
- Usage: `const { theme, setTheme } = useTheme()`

To change brand color: update `--primary` HSL values in `:root`.
To add new color token: add to `:root`, then map in `@theme inline`.

## Testing / MSW

MSW runs in two modes — same handlers, different adapter:

| Mode | Where | Adapter | When to use |
|------|-------|---------|-------------|
| **Node** | `src/test/server.ts` | `msw/node` | Unit + integration tests (Vitest). No browser needed. |
| **Browser** | `public/mockServiceWorker.js` | `msw/browser` via `src/mocks/browser.ts` | Dev without a real backend (worker started from `main.tsx` unless `VITE_ENABLE_MSW` is `'false'`); Storybook / Playwright can reuse the same handlers. |

`public/mockServiceWorker.js` is a generated Service Worker — do not edit it manually.
Browser adapter: `setupWorker(...handlers)` lives in `src/mocks/browser.ts`; `main.tsx` imports it only in DEV.
To update after MSW upgrade: `npx msw init public/`.

## CI / Supply chain

| Artifact                   | Role                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | PR + push `master`: audit (moderate+) → typecheck → oxlint → ESLint → format → test:coverage → **build** → web-vitals chunk check |
| `.cursor/brain/VERIFICATION.md` | **When to run which checks** (agents: avoid full pipeline for tiny edits); local mirror: `npm run ci:local` |
| `.github/dependabot.yml`   | Weekly npm version PRs (limit 8 open)                                |
