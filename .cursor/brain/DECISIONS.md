# Architectural Decisions

## [2026-04] MSW browser worker — `src/mocks/browser.ts` + dev opt-out

**Decision**: DEV-only MSW uses `setupWorker` in `src/mocks/browser.ts` (handlers shared with Vitest via `test/handlers`). `main.tsx` starts the worker when `import.meta.env.DEV` and `import.meta.env.VITE_ENABLE_MSW !== 'false'` (opt-out; default-on in dev).

**Why**: Keeps the worker setup out of the root file, reuses one handler list for Node and browser, and allows turning mocks off without removing code.

---

## [2026-04] Verification guide (`.cursor/brain/VERIFICATION.md`) + `ci:local`

**Decision**: `.cursor/brain/VERIFICATION.md` defines minimal checks per task type; `npm run ci:local` mirrors CI. Agents should read it and avoid running audit/build/vitals-analyze for every trivial edit.

**Why**: Reduces noise, latency, and false “full audit” habits while keeping a single command for pre-push confidence.

---

## [2026-04] i18n init failure — English-only fallback

**Decision**: If `i18nInitPromise` rejects, `main.tsx` removes `html.i18n-loading`, logs via `logger.error('[i18n] …')`, and renders `I18nInitErrorFallback` (fixed English; `t()` is not available).

**Why**: Previously the app could stay on an empty tree forever when locale JSON failed to load. User-facing copy cannot use i18n in this branch.

---

## [2026-04] Web Vitals chunk split — automated check

**Decision**: `scripts/check-web-vitals-chunks.mjs` asserts `dist/assets` after build: default bundle must contain only `subscribeStandard` + standard `web-vitals` chunk; optional `npm run verify:web-vitals-chunks` runs two builds and asserts the attribution variant too.

**Why**: Branching on `env` from `@/env` pulled both dynamic imports into the graph; `import.meta.env.VITE_WEB_VITALS_ATTRIBUTION` is required for dead-code elimination. The script catches regressions without manual bundle inspection.

---

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

## [2026-04] ESLint 9 (not 10) — intentional hold

**Decision**: Holding on ESLint **9.x**. Not upgrading to ESLint **10** yet.

**Why**: `eslint-plugin-react` **7.x** uses `context.getFilename()` which was **removed in ESLint 10**. Runtime crash, not a peer-dep warning. No v8 of the plugin exists. Revisit when `eslint-plugin-react` releases ESLint 10 support.

---

## [2026-04] eslint-import-resolver-typescript — single solution `tsconfig`

**Decision**: `createTypeScriptImportResolver` uses **`./tsconfig.json`** only (solution file with `references`), not an array of `tsconfig.*.json`.

**Why**: The resolver warns when multiple `project` entries are passed; its README recommends one config with project references. With a single file it sets `references: 'auto'` and follows `tsconfig.app` / `tsconfig.node` / `tsconfig.vitest` like `tsc -b`.

---

## [2026-04] TypeScript 6 — upgraded

**Decision**: Running **TypeScript 6.0.x** (`~6.0.2`).

**Why**: `typescript-eslint` 8.58.1 supports TypeScript 6. One breaking change affected our config: `baseUrl` is deprecated in TS6. Fixed by removing `"baseUrl"` from both `tsconfig.json` and `tsconfig.app.json` — `paths` works without it in TS6.

---

## [2026-04] Component pattern: arrow function + FunctionComponent

**Decision**: All React components use `const X: FunctionComponent<Props> = () => {}`. No `FC`, no function declarations for components.

**Why**: `FC` is an alias (`type FC<P> = FunctionComponent<P>`) — writing `FunctionComponent` makes the type relationship explicit. Arrow functions are consistent with hooks/utilities style. ESLint enforces both: `no-restricted-imports` bans `FC`, `func-style: expression` bans function declarations (exception: `src/components/ui/` which is shadcn-generated).

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

**Decision**: GitHub Actions runs `npm ci` → audit → `typecheck` → `lint:oxlint` → `lint` (ESLint) → `format:check` → `test:coverage` → **`npm run build`** → **Web Vitals chunk verification** (`node scripts/check-web-vitals-chunks.mjs` on `dist/`). Triggers on PR and push to `master`. Dependabot opens weekly npm update PRs (capped at 8 open).

**Why**: Typecheck and dual lint stages catch errors early; coverage in CI enforces thresholds from Vitest config. Production build gates bundler regressions; post-build chunk check catches accidental web-vitals graph coupling. Audit at moderate+ fails on registry-reported issues. Dependabot reduces manual drift for security patches.

**Trade-offs**: `audit-level=moderate` may fail on moderate+ advisories that have no fix yet — then pin, ignore with documented exception, or wait for upstream (team choice).

---

## [2026-03] Vendor chunks: `codeSplitting.groups` + `@tanstack/query-core`

**Decision**: Under `build.rolldownOptions.output.codeSplitting.groups`, the **`state-vendor`** group includes paths for `zustand`, `@tanstack/react-query`, and **`@tanstack/query-core`**.

**Why**: Analyzer runs showed `query-core` splitting out when only `react-query` matched. Same cacheable vendor boundary as the previous `manualChunks` logic.
