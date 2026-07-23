# Architectural Decisions

## [2026-05] Magic strings → constants (Zustand keys + devtools labels)

**Decision**: extract magic strings used in 2+ places OR carrying external contract to named constants. Apply selectively per framework below. NOT a blanket "extract everything" — single-use strings stay inline (Ghost Principle).

**Extraction sites added this commit**:
- `src/store/keys.ts` — `STORAGE_KEYS` (Zustand `persist({ name })` + plain `localStorage.setItem(key)` keys — external contract: renaming breaks persisted user data), `DEVTOOLS_NAMES` (Zustand `devtools({ name })` labels — Redux DevTools panel grouping), `USER_STORE_ACTIONS` (per-store `set(..., false, { type })` labels — refactor safety + DevTools discoverability). Per-store ACTION constants keep namespaces short; do NOT roll into one mega-object as more stores land.

**Pattern**: `as const` objects, NOT `enum`. Type via `typeof OBJ[keyof typeof OBJ]`. Reasons:
- Zero runtime overhead vs enum (~150 bytes per enum compiled)
- Tree-shakeable (numeric enums have reverse-mapping bloat)
- Plays better with structural type matching
- Modern TS consensus (`const enum` known broken in bundlers per TS docs)

**TanStack Query keys — INTENTIONALLY NOT centralized**: existing `greetingKeys` / `exampleKeys` factories stay **colocated** with their `queryOptions()` factories in `src/lib/api/<domain>.queries.ts`. This matches Dominik Dorfmeister's "Effective React Query Keys" recommendation (TkDodo blog, 2021; still current as of TanStack Query v5) — colocated factories scale better than a central `queryKeys.ts` registry because (a) one file owns one feature's cache surface, (b) deleting a feature deletes its keys with it, (c) no central import-fan-out hotspot. A centralized `src/lib/queryKeys.ts` would have been a regression here.

**When NOT to extract** (do NOT pile in cosmetic refactors):
- Single-use strings (logger source tags like `'[i18n]'`, one-off event names, test selectors)
- Self-documenting at use site (`aria-label` on a close button)
- i18n keys (handled by i18next)
- Throwaway prototype scope
- Already-extracted constants (`API_BASE_URL`, `I18N_HMR_EVENT`, `I18N_STORAGE_KEY` already live in their respective module's `constants.ts` — no second-mover refactor needed)

**Revisit trigger**: if consumer fork adds >3 stores or grows `USER_STORE_ACTIONS` past ~6 entries, reassess the per-store-ACTIONS-object split (may want code-gen or a tighter naming convention). If a fork centralizes TanStack Query keys into one registry file and the codebase stays maintainable for >3 months, the Dorfmeister-colocated recommendation in this ADR is the one to revisit — not the other way around.

## [2026-05] Boundary validation via Zod safeFetch wrapper

**Decision**: validate ALL API responses at boundary using Zod schemas via `src/lib/api/safeFetch.ts`. Reference example: `src/lib/api/greeting.queries.ts`. Pattern is opt-in for consumer forks — copy + extend per endpoint.

**Why**: catches BE shape drift at receive time (HTTP boundary) instead of buried in render. Removes "undefined → NaN → blank UI" class of bugs. Provides `z.infer<typeof Schema>` types for free (single source of truth).

**Scope**:
- TanStack Query `queryFn` (use `safeFetchQueryFn(url, schema)`)
- Direct fetch calls (use `safeFetch(url, schema)`)
- localStorage / sessionStorage reads (use `Schema.safeParse(JSON.parse(raw))`)

**When NOT to use**: tRPC / GraphQL with codegen (other pattern handles it); throwaway prototypes; high-frequency polling where ~50-200μs parse matters.

**Trade-offs**:
- +0 KB bundle (Zod already in deps for forms)
- ~50-200μs parse per response (negligible)
- Schemas duplicate BE types — acceptable for solo/small-team. For multi-team scale, consider codegen (openapi-zod-client, @ts-rest) later.

**AbortError pairing**: `safeFetchQueryFn` re-throws `AbortError` unchanged so TanStack Query treats it as cancellation (not error). Pairs with `src/lib/devGuards.ts` `installDevGuards()` which preventDefault's leaked AbortError unhandledrejection events in dev.

**Revisit trigger**: if consumer fork ships ≥5 endpoints without using safeFetch pattern within 60 days of starting product, drop pattern from template seed (consumer can copy-paste from past commits).

## [2026-05] `size-limit` per-chunk brotli budget — `ci:local` gate

**Decision**: add `size-limit@^12.1.0` + `@size-limit/preset-app@^12.1.0` devDeps + `npm run size:check` script + `.size-limit.json` config with per-chunk brotli budgets. Wired into `ci:local` AFTER `verify:web-vitals-chunks` (asserts size, not composition — orthogonal to existing script). Per /consilium 2026-05-23 APPLY Item 6 (5/6 YES, 1 COND satisfied by pre-flight overlap check).

**Why**: `scripts/check-web-vitals-chunks.mjs` asserts chunk *composition* (subscribeStandard vs subscribeAttribution split correctness), NOT chunk *size*. `chunkSizeWarningLimit: 600` (KB raw) in `vite.config.ts` is a Vite *warning*, not a CI fail. No per-chunk byte-budget gate currently exists. `size-limit` 868K weekly DLs is ~10× over `bundlesize@85K` (May 2026 npm registry direct) — clear winner.

**Initial budgets (brotli)** — set at current size + ~20% headroom so first-fork CI passes:

- `react-vendor`: 90 KB (current ~75 KB)
- `i18n-vendor`: 22 KB (current ~18 KB)
- `state-vendor`: 15 KB (current ~12 KB)
- `ui-vendor`: 12 KB (current ~9 KB)
- `index` entry: 25 KB (current ~20 KB)

**Conditions** (Pragma + Mini /consilium): budgets live in standalone `.size-limit.json` (not `package.json` `"size-limit"` key) to keep diff noise low and isolate budget changes from dep-bump churn. Pre-flight verified zero overlap with `verify:web-vitals-chunks.mjs` (different verification axis).

**Revisit trigger (60-day, 2026-07-23)**: if a fork hits ≥3 false-positive budget bumps from legitimate feature work in 60 days, recalibrate budgets to p75 of fork-distribution OR move size-limit out of `ci:local` into PR-comment-only (size-limit GH Action). If size-limit `--why` flag reports same vendor exceeding budget across 3 forks, raise the budget structurally.

## [2026-05] REJECT list — explicit non-adoption (2026-05-23 /consilium)

**Decision**: explicit DO-NOT-ADOPT register so future agents + forks don't re-litigate. Per /consilium 2026-05-23 APPLY Item 14 (6/6 voters YES). Sibling templates carry equivalent sections.

### React Compiler enable in template-1 (VETOED)

**Status**: skip. **Why**: /consilium 2026-05-23 Item 2 (`babel-plugin-react-compiler@1.0.0` + `@rolldown/plugin-babel`) — 1 YES / 3 NO / 2 COND + **Adversarial killer Q VETO** ("Name one Compiler-enabled production app at >100K MAU where #35105 or #35644 reproducers have been ruled out as of 2026-05-23" — unanswerable) + **ADR conflict**: reverses `[2026-03] @vitejs/plugin-react v6` Oxc-no-Babel decision. [Vite team Mar 2026 blog](https://vite.dev/blog/announcing-vite8) warns "adding babel-loader will eliminate most Oxc gains" — build-speed regression is concrete, Compiler benefit (Makarevich N=1 mixed-positive: 1-2 of 8-10 re-renders fixed) is workload-dependent. Open silent-bailout bugs: [facebook/react#35105](https://github.com/facebook/react/issues/35105), [#35644](https://github.com/facebook/react/issues/35644) (`Status: Unconfirmed`, no assignees, May 2026).
**Revisit (quarterly, 2026-08-23)**: if either bug closes AND ≥1 named >100K-MAU Compiler-enabled Vite app publishes "ruled out" retro AND Vite team blesses Babel-Compiler-Vite path explicitly, re-evaluate. `eslint-plugin-react-hooks@7.1.1` already loaded in `eslint.config.js` (`flat['recommended-latest']`) — Compiler correctness rules already fire as lint-only signal (no Compiler runtime needed for lint).

### Lighthouse CI in template-1 (not currently proposed, deferred)

**Status**: skip. **Why**: template-1 is enterprise SPA without PWA contract — synthetic Lighthouse perf gate adds CI-time cost (see sibling `template-spa-pwa` LHCI for cost profile) without proportional signal. Sibling `template-spa-pwa` ships LHCI because PWA install + offline contracts depend on it.
**Revisit (60-day, 2026-07-23)**: if a fork ships perf-critical SLA AND consumer requests LHCI gate, lift sibling template-spa-pwa lighthouserc as starting point.

### React Doctor `lint-staged --staged --fail-on warning` PR-gate (REJECTED)

**Status**: skip. **Why**: /consilium 2026-05-23 Item 1 — 0 YES / 4 NO / 2 COND. Pragma+Mini gang-of-two NO + Ergo category error ("Doctor is project-level scan, not staged-file linter") + Adversarial flagged [typicode/husky#1462](https://github.com/typicode/husky/issues/1462) Windows-path issues on cross-platform forks.
**Revisit (60-day, 2026-07-23)**: if React Doctor 1.0 ships AND ≥1 dated bug observed in a fork that Doctor would have caught, re-evaluate scoped to ad-hoc `npm run doctor` + GitHub Action `millionco/react-doctor@<commit-sha>` (NOT `@main`) with `--offline` + PR comment only (NOT lint-staged blocking).

### memlab (Meta heap-snapshot leak detector)

**Status**: skip by default. **Why**: 158K weekly DLs (May 2026), ZERO published GitHub releases ([facebook/memlab/releases](https://github.com/facebook/memlab/releases)), 0 of 8 React Doctor leaderboard flagship repos use in CI.
**Revisit (90-day, 2026-08-23)**: if memlab ships v2.0+ with formal releases AND ≥1 named React app at >10K MAU publishes a memlab-CI case study, re-evaluate.

### why-did-you-render (WDYR)

**Status**: skip as template default; consumer choice. **Why**: WDYR README declares "completely incompatible with React Compiler" — but template-1 doesn't ship Compiler, so WDYR is technically usable here for consumer forks. Template stays minimal; consumer adds WDYR if needed for re-render audit. Replacement for Compiler-on stacks: React DevTools Profiler "Memo ✨" badge.
**Revisit (no trigger needed)**: consumer-choice category.

### `react-native-flipper`

**Status**: not applicable (template-1 is web, not RN). Sunset since RN 0.74.

### Zstd compression plugin

**Status**: skip. **Why**: Safari Zstd landed 26.3 Feb 11, 2026 ([WebKit blog](https://webkit.org/blog/17798/webkit-features-for-safari-26-3/)), caniuse global compat 45/100 — pre-26.3 long-tail huge, Brotli still mandatory. Existing `vite-plugin-compression@brotliCompress` covers requirement.
**Revisit (no trigger needed)**: revisit only when caniuse Zstd global crosses 80/100 AND CDN/edge config supports automatic encoding negotiation.

### `vite-plugin-bundlesize`

**Status**: skip (use `size-limit` instead). **Why**: `size-limit@^12.1.0` adopted per /consilium Item 6. `vite-plugin-bundlesize` is a separate Vite-native gate (single-vendor) — size-limit has 10× wider adoption + ecosystem-shared config shape.
**Revisit (no trigger needed)**: re-evaluate only if size-limit deprecates or becomes unmaintained.

## [2026-04] MSW browser worker — `src/mocks/browser.ts` + dev opt-out

**Decision**: DEV-only MSW uses `setupWorker` in `src/mocks/browser.ts` (handlers shared with Vitest via `test/handlers`). `main.tsx` starts the worker when `import.meta.env.DEV` and `import.meta.env.VITE_ENABLE_MSW !== 'false'` (opt-out; default-on in dev).

**Why**: Keeps the worker setup out of the root file, reuses one handler list for Node and browser, and allows turning mocks off without removing code.

---

## [2026-04] Verification guide (`.cursor/brain/VERIFICATION.md`) + `ci:local`

**Decision**: `.cursor/brain/VERIFICATION.md` defines minimal checks per task type; `npm run ci:local` mirrors CI with extras (audit, size). Agents should read it and avoid running audit/build/vitals-analyze for every trivial edit.

**Why**: Reduces noise, latency, and false “full audit” habits while keeping a single command for full local CI confidence.

---

## [2026-07] Playwright e2e inside `verify` + pre-push

**Decision**: append build + `test:e2e:prod` (`PLAYWRIGHT_USE_PREVIEW=1`) to `npm run verify`, and point `.husky/pre-push` at full `npm run verify` (was typecheck-only). `ci:local` remains the stricter audit/size/LHCI-style (where applicable) superset.

**Why**: Catch preview-mode e2e regressions before CI; typecheck-only pre-push left runtime gaps.

**Trade-off**: pre-push is slower. Accepted so e2e cannot be skipped by habit.

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

**Snapshot (2026-05-22)**: ESLint 10.0.0 shipped 2026-02-09; latest 10.4.0 shipped 2026-05-15. ESLint 9.x EOL is 2026-08-06. The 9.x line is on `maintenance` dist-tag (currently `9.39.4`).

**Why**: `eslint-plugin-react@7.37.5` uses `context.getFilename()` + `sourceCode.isSpaceBetweenTokens` + `sourceCode.getAllComments` + RuleTester `type` field — all removed in ESLint 10 (runtime crash, not peer-warn). PR #3979 blocked transitively by `import-js/eslint-plugin-import#3230`. `eslint-plugin-jsx-a11y@6.10.2` peer caps `^9`, PR #1081 awaiting `ljharb` review since Mar 2026.

**Revisit when**: monthly review starting 2026-07-01 (1-month buffer pre-EOL) (2026-07 cycle missed - next check 2026-08-01). Either (a) `eslint-plugin-react` ships release widening peer to `^10`, OR (b) `eslint-plugin-jsx-a11y@7.x` ships, OR (c) we adopt forks:

- `@eslint-react/eslint-plugin@5.8.4+` (peer `eslint ^10.3.0`, requires Node ≥22, NOT drop-in — rule rewrite)
- `eslint-plugin-jsx-a11y-x@0.2.0+` (es-tooling org, peer `^9 || ^10`, drop-in)

---

## [2026-04] eslint-import-resolver-typescript — single solution `tsconfig`

**Decision**: `createTypeScriptImportResolver` uses **`./tsconfig.json`** only (solution file with `references`), not an array of `tsconfig.*.json`.

**Why**: The resolver warns when multiple `project` entries are passed; its README recommends one config with project references. With a single file it sets `references: 'auto'` and follows `tsconfig.app` / `tsconfig.node` / `tsconfig.vitest` like `tsc -b`.

---

## [2026-04] TypeScript 6 — upgraded

**Decision**: Running **TypeScript 6.0.x** (`~6.0.3`).

**Why**: `typescript-eslint` 8.58.1+ supports TypeScript 6 (peer relaxed to `<6.1.0`). One breaking change affected our config: `baseUrl` is deprecated in TS6. Fixed by removing `"baseUrl"` from both `tsconfig.json` and `tsconfig.app.json` — `paths` works without it in TS6.

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
