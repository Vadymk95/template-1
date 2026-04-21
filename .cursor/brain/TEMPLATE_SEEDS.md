# Template Seeds — Do NOT Remove as "Dead Code"

This file is the canonical registry of **template seeds**: code that lives in the
repo solely to show an agent (or a new engineer) "how this stack wants features
to look". They are the reference the rest of `.cursor/brain/*.md` points to.

## The contract

- Any file below is safe to look unused to a lint/tree-shake view — that's the
  point: it is _not_ wired into the runtime so it cannot drift with production
  refactors.
- `refactor` / `remove dead code` / `clean unused exports` agents must **skip**
  these files. Each one carries a header with the same "🌱 TEMPLATE SEED"
  marker and a "When to delete" clause.
- Seeds graduate to real code only when the repo graduates from "template" to a
  real MVP. At that point:
    1. replace each seed with the first real module of the same kind
       (`_example.queries.ts` → `users.queries.ts`, etc.);
    2. remove the seed's row from the table below;
    3. bump the README "graduated from template" note.

## Registry

| Seed                                              | Kind                     | Demonstrates                                                                 | Delete when…                                                    |
| ------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/api/_example.queries.ts`                 | TanStack Query pattern   | Key factory, `queryOptions()` factories, cancellable `fetch`                 | First real `<domain>.queries.ts` wired into a page              |
| `src/lib/api/_example.ts`                         | REST transport pattern   | Typed `apiClient` usage with response interface                              | First real `<domain>.ts` transport module exists                |
| `src/pages/DevPlayground/*` (`/dev/ui` route)     | shadcn primitives demo   | Button variants, Input states, form error styles — DEV-only route           | You have enough real pages to cover variant coverage visually   |
| `src/components/common/ThemeToggle/*`             | `useTheme` consumer      | Three-state light/dark/system cycle, icon button with a11y label             | Replaced by the product's real theme control                    |
| `src/components/common/LanguageSwitcher/*`        | `SUPPORTED_LANGUAGES` UI | Degrades to badge when one locale; becomes `<select>` once ≥ 2 locales       | Replaced by the product's real language picker / locked to one  |
| `src/components/layout/Header/*` demo wiring      | Hooks composition        | `useTheme`, `useTranslation`, `useUserStore` meeting in one layout shell     | Header is replaced with brand-specific nav / auth UI            |
| `src/components/layout/Footer/*` demo wiring      | Metadata surface         | `__APP_VERSION__` (Vite define from `package.json`), copyright year via `Date` | Footer is replaced with real links (legal, support, social)   |

## Why the underscore prefix?

Files prefixed with `_` in `src/lib/api/` are the established convention here
for "reference, not imported by app code". Keep the prefix for any new seed so
the signal stays consistent across the codebase.

## Why a DEV-only route (`/dev/ui`)?

`DevPlayground` is mounted only under `import.meta.env.DEV`. It is compiled out
of production bundles, so the code cost to ship is zero, while the onboarding
and design-system sanity-check cost savings compound every sprint.

## Related

From repo root the paths are `.cursor/brain/MAP.md`, `.cursor/brain/PROJECT_CONTEXT.md`, `.cursor/brain/SKELETONS.md` (same folder as this file). Links below use filenames relative to `.cursor/brain/`.

- [`MAP.md`](./MAP.md) — references the queries seed in the "Adding a New Feature" flow
- [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) — mentions the same seed by name in the stack section
- [`SKELETONS.md`](./SKELETONS.md) — danger-zones including DevPlayground's DEV-only contract
