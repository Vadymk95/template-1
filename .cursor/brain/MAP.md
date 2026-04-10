# Architecture Map

## Entry Points

| File                   | Role                                                |
| ---------------------- | --------------------------------------------------- |
| `index.html`           | HTML shell — i18n-loading class for FOUC prevention |
| `src/main.tsx`         | Root: i18n init → QueryClient → Router providers    |
| `src/App.tsx`          | Layout shell: ErrorBoundary → Header/Main/Footer    |
| `src/router/index.tsx` | Router assembly, merge route modules here           |

## Adding a New Page

1. Create `src/pages/FooPage/FooPage.tsx` + `index.ts` (lazy export)
2. Add route to `src/router/modules/base.routes.tsx` (or new module)
3. Wrap with `WithSuspense` in route element
4. Add translations: `public/locales/en/foo.json`
5. Add route name constant to `src/router/routes.ts`

## Adding a New Feature

1. New store → `src/store/<domain>/store.ts` + `store.test.ts`
2. Hooks → `src/hooks/<domain>/useHook.ts` + `useHook.test.ts`
3. Components → `src/components/<domain>/Component/` (tsx + hook + test)
4. API → `src/lib/api/<domain>.ts` (TanStack Query hooks inside feature or hooks folder)

## Adding a shadcn Component

```bash
npx shadcn@latest add <component>
# Components land in src/components/ui/
```

> components.json is configured for Tailwind v4 (config: "")

## State Boundaries

```
Zustand  →  global UI/auth state (userStore, settingsStore, ...)
           userStore uses persist middleware → survives page refresh (localStorage key: "user-store")
           getAuthToken() exported for apiClient — avoids circular imports
TanStack →  server data, caching, background refetch
Local    →  component-only state (useState)
```

## Routing

```
/           → HomePage (no lazy, entry route)
/login      → LoginPage (lazy + WithSuspense)
/dashboard  → DashboardPage (lazy + WithSuspense, behind ProtectedRoute)
/*          → NotFoundPage (lazy + WithSuspense)
/dev        → DevPlayground (dev only, lazy + WithSuspense, remove in prod)
```

## i18n Flow

```
app start → i18next init → loads common + errors + <current page ns>
→ RootProviders renders (isI18nReady gate)
→ document.lang set
→ HMR: useI18nReload watches public/locales/** in dev
```

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
| **Browser** | `public/mockServiceWorker.js` | `msw/browser` | Dev without a real backend, Storybook, Playwright in-browser. |

`public/mockServiceWorker.js` is a generated Service Worker — do not edit it manually.
To enable browser mode: call `setupWorker(...handlers)` in `src/main.tsx` under `import.meta.env.DEV`.
To update after MSW upgrade: `npx msw init public/`.

## CI / Supply chain

| Artifact                   | Role                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | PR + push `master`: audit (moderate+), lint, format, test, **build** |
| `.github/dependabot.yml`   | Weekly npm version PRs (limit 8 open)                                |
