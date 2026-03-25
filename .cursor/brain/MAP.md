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
TanStack →  server data, caching, background refetch
Local    →  component-only state (useState)
```

## Routing

```
/ → HomePage (no lazy, entry route)
/* → NotFoundPage (lazy + WithSuspense)
/dev → DevPlayground (dev only, remove in prod)
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

To change brand color: update `--primary` HSL values in `:root`.
To add new color token: add to `:root`, then map in `@theme inline`.

## CI / Supply chain

| Artifact                   | Role                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `.github/workflows/ci.yml` | PR + push `master`: audit (moderate+), lint, format, test, **build** |
| `.github/dependabot.yml`   | Weekly npm version PRs (limit 8 open)                                |
