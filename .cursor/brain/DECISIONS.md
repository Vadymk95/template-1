# Architectural Decisions

## [2026-03] Tailwind v4 migration

**Decision**: Migrated from Tailwind v3 (config in `tailwind.config.ts`) to Tailwind v4 (config in `src/index.css`).

**Why**: v4 uses a Vite-native plugin (`@tailwindcss/vite`) which is faster and eliminates PostCSS as a build dependency. CSS-based config (`@theme inline`) is more collocated with actual styles.

**Trade-offs**: The `container` utility no longer has a JS-configurable `center`/`padding` option — apply utilities directly. `tailwindcss-animate` replaced by `tw-animate-css` (CSS import, no PostCSS plugin).

---

## [2026-03] Vite 8 with built-in Rolldown

**Decision**: Use the official **`vite@^8`** package. Removed `npm:rolldown-vite` alias and `overrides`.

**Why**: Vite 8 ships Rolldown as the unified bundler ([announcement](https://vite.dev/blog/announcing-vite8)); the separate `rolldown-vite` preview is superseded. Aligns with ecosystem (e.g. `@vitejs/plugin-react` v6, Vitest 4.1 vite peer).

**Config**: `build.rolldownOptions.output.codeSplitting.groups` replaces Rollup `manualChunks` for vendor chunks.

---

## [2026-03] ESLint 9 (not 10) — intentional hold

**Decision**: Holding on ESLint **9.x**. Not upgrading to ESLint **10** yet.

**Why**: `typescript-eslint` **8.57.2** already lists `eslint@^10` as a peer, but **`eslint-plugin-react-hooks`** (v5 and v7) still only declares peer support through **ESLint 9** — upgrading ESLint would yield peer-dep conflicts or forced `legacy-peer-deps`. Revisit when `eslint-plugin-react-hooks` declares ESLint 10 support (or team drops/ replaces that rule pack).

---

## [2026-03] TypeScript 5.9 (not 6) — intentional hold

**Decision**: Stay on **TypeScript 5.9.x** (`~5.9.3`).

**Why**: `typescript-eslint` **8.57.2** peer range is `typescript: '>=4.8.4 <6.0.0'`. Moving to TS 6 requires a **typescript-eslint** major that supports it; avoid until that ships.

---

## [2026-03] @vitejs/plugin-react v6

**Decision**: `@vitejs/plugin-react@^6` with Vite 8 (Oxc-based refresh; Babel not required for default setup).

**Why**: v6 matches Vite 8 peer range. React Compiler, if needed later, uses `reactCompilerPreset` + `@rolldown/plugin-babel` per plugin docs.

---

## [2026-03] No FSD architecture in this template

**Decision**: Using simple folder structure (`components/`, `hooks/`, `store/`, `lib/`, `pages/`) instead of FSD layers.

**Why**: FSD is powerful but adds onboarding friction for a template. This template is meant to be cloned and extended. FSD can be layered on by the consumer if needed. Vibeten uses FSD and its rules can serve as reference.

---

## [2026-03] Zustand for global state, TanStack Query for server state

**Decision**: Hard boundary — no Zustand for server data, no TanStack Query for pure UI state.

**Why**: Mixing responsibilities leads to cache inconsistency and double-refetch bugs. Zustand + devtools gives Redux-like observability for client state. TanStack Query owns all async lifecycle (loading, error, stale, refetch).

---

## [2026-03] CI: production build + audit + Dependabot

**Decision**: GitHub Actions runs `npm ci` → `npm audit --audit-level=moderate` → lint → format → test → **`npm run build`**. Workflow triggers on PR and push to `master`. Dependabot opens weekly npm update PRs (capped at 8 open).

**Why**: Without a production build step, broken Vite/Rollup/`tsc -b` paths could pass CI. Audit at moderate+ fails the pipeline on registry-reported issues. Dependabot reduces manual drift for security patches. These add **CI minutes only**, not local dev overhead.

**Trade-offs**: `audit-level=moderate` may fail on moderate+ advisories that have no fix yet — then pin, ignore with documented exception, or wait for upstream (team choice).

---

## [2026-03] Vendor chunks: `codeSplitting.groups` + `@tanstack/query-core`

**Decision**: Under `build.rolldownOptions.output.codeSplitting.groups`, the **`state-vendor`** group includes paths for `zustand`, `@tanstack/react-query`, and **`@tanstack/query-core`**.

**Why**: Analyzer runs showed `query-core` splitting out when only `react-query` matched. Same cacheable vendor boundary as the previous `manualChunks` logic.
