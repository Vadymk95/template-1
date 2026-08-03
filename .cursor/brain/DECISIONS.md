# Architectural Decisions

## [2026-07] The gate is `verify`; `verify` is a superset of CI

**Decision.** Every check lives in `package.json`, never only in a workflow file. `verify` holds all
offline checks; `verify:ci` is `audit:gate && verify` and is what both `.husky/pre-push` and GitHub
Actions run. The CI job is one step: `npm run verify:ci`, plus only what CI alone can do — dependency
install, the browser cache, artifact upload.

**Why.** CI used to list its own steps, and two of them (`npm audit`, `verify:web-vitals-chunks`) were
absent from `verify`, while `size:check` lived in `ci:local` and therefore ran in no pipeline at all. So
a green local gate did not predict a green CI, and one gate never ran anywhere. Both are the same
defect: a check added to the workflow instead of to the script.

**Consequence, accepted.** `verify` is slower — it now also builds, checks the web-vitals chunk split,
checks the size budget and runs Playwright. It can go red on a dependency bump rather than on your own
code. That is the cost of a gate that no longer lies. If it becomes intolerable, a check comes out of
BOTH the script and CI, so the superset property survives.

**`audit:gate` is in `verify:ci`, not `verify`,** because it needs the network. An implementer working
offline must still be able to run the complete offline gate.

**Pre-commit is repo-scoped.** `lint-staged` fixes and re-stages the staged set, but for a partially
staged file it restores the unstaged hunks *after* fixing, so formatting drift survived the commit and
only failed at push — leaving files that were already fixed and never committed. The hook now also runs
`lint:oxlint` and `format:check` over the whole repo and refuses the commit, naming the remedy
(`npm run fix && git add -u`). ESLint stays on pre-push: type-aware and slow. **Not adopted:** a hook
that commits for you. It would sweep whatever else is dirty into the commit and has no honest message
to use.

**Advisory exceptions are data, not thresholds.** `audit:gate` fails on every high or critical
advisory, on an expired allowance, on an allowance whose advisory has disappeared, and on its own
inability to complete. Lowering `--audit-level` to make a finding go away is not available; writing
down the reason with an expiry is. `scripts/audit-gate.test.mjs` covers the fail-closed paths,
including the invalid-payload one — a security gate that reports success when it cannot run is worse
than no gate.

**An allowance is the last resort, not the first.** `GHSA-mh99-v99m-4gvg` (brace-expansion,
unbounded expansion → OOM) was allowlisted here on the reading that `minimatch@3` is pinned by
eslint's own dependencies and by `eslint-plugin-react` / `eslint-plugin-jsx-a11y`, so nothing could be
bumped. That was true of the *direct* dependencies and wrong about the *transitive* one:
`brace-expansion@5.0.8` sits outside the advisory range `<=5.0.7`, and a root override
`"brace-expansion": ">=5.0.8"` closes the advisory with `minimatch@3` untouched — 5.0.8 is
dual-published, so `require()` still resolves a CommonJS build. `npm audit` goes to zero for it and the
full gate stays green. What made the allowance look inevitable was npm's own suggested remediation:
`eslint-plugin-react@7.22.0`, a semver-major **downgrade**. Read the advisory's fixed range directly
instead of trusting `fixAvailable`.

**Removing an allowance and adding the override are ONE commit.** The moment the override lands the
advisory disappears from the audit, which makes the allowance **stale**, which fails the gate by
design. Verified rather than assumed: re-adding the entry after the override produces
`Stale allowlist entry: GHSA-mh99-v99m-4gvg` and exit 1. That is the stale check doing its job — it is
what stops allowances outliving the problem they described.

**Revisit trigger:** if `verify` crosses roughly five minutes locally, move e2e into its own CI job and
out of the pre-push hook — but out of `verify` only together with the workflow, never one alone.

## [2026-07] ESLint 10; `settings.react.version` must be a literal

**Decision.** ESLint 10, ahead of the 9.x end of life on 2026-08-06. Three plugins still cap their
`eslint` peer below 10 — `eslint-plugin-react` at `^9.7`, `eslint-plugin-jsx-a11y` at `^9`, and
`eslint-plugin-import` at `^9`, which arrives transitively — so each gets an `overrides` entry mapping
its peer to `$eslint`. `npm install` and `npm ci` both succeed with **no `--legacy-peer-deps`**; the
blanket flag was rejected as a permanent posture in a repo with a hardened `.npmrc`.

**`settings.react.version` is `'19.2'`, never `'detect'`.** `eslint-plugin-react` resolves `'detect'`
through `detectReactVersion` → `resolveBasedir`, which calls the `context.getFilename()` API that
ESLint 10 removed; every react rule needing the version then throws at load. A trailing config object
with no `files` key repeats the pin so no shared config can reintroduce `'detect'` for its own
patterns. Keep it in step with the `react` major/minor in `package.json`.

**The green was checked for fail-open**, because a silent no-op looks identical to a clean run: under
ESLint 10 the config declares 1252 rules with 237 active and 10 plugins loaded on a real source file.
ESLint 10 also caught a genuine dead store that 9.x did not — `no-useless-assignment` on an error
message initialised and then unconditionally overwritten in both branches below it.

**Still held:** TypeScript stays `~6.0.x` (`typescript-eslint@8.65.0` peers `typescript >=4.8.4
<6.1.0`), and `@types/node` stays 24.x to match `engines.node`. Both were re-verified, not assumed.

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

**Why**: `scripts/check-web-vitals-chunks.mjs` asserts chunk _composition_ (subscribeStandard vs subscribeAttribution split correctness), NOT chunk _size_. `chunkSizeWarningLimit: 600` (KB raw) in `vite.config.ts` is a Vite _warning_, not a CI fail. No per-chunk byte-budget gate currently exists. `size-limit` 868K weekly DLs is ~10× over `bundlesize@85K` (May 2026 npm registry direct) — clear winner.

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

## [2026-04] ESLint 9 (not 10) — intentional hold — SUPERSEDED

**Superseded by "[2026-07] ESLint 10; `settings.react.version` must be a literal" above.** The hold
was lifted before the 2026-08-06 end of life: the plugin peers still cap below 10, but three
`overrides` entries resolve that without `--legacy-peer-deps`, and the one real crash path turned out
to be `settings.react.version: 'detect'`. Kept for the reasoning, not as current guidance.

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

## Content variance is measured in a browser, not asserted in jsdom

**Decision.** Every content-bearing primitive is rendered once per content state on a dev-only route
(`/dev/ui/content-stress`) and MEASURED by Playwright at 390 / 640 / 768 / 1024 / 1440. The invariants
live as pure predicates in `e2e/support/geometry.ts`, shared by that spec and by
`e2e/layout-geometry.spec.ts`, which measures the assembled pages instead of the primitives. Two
consumers, one definition — two copies of a rule is the defect the module exists to prevent.

**Why a browser.** jsdom has no layout, so a unit test can pin a class string and nothing more. The
defects this found on the first run were all invisible to the unit suite: 172px of overflow from a
40-character unbroken token at 390, a button row 1161px wide inside a 798px container at 1440 (so NOT a
narrow-viewport problem), and 28px of horizontal DOCUMENT scroll from the header on every route at 390.

**Why the fixture is dev-only.** A stress page in the production bundle would be the wrong trade. That
choice has a consequence worth stating: the fixture is unreachable from the `vite preview` run inside
`verify`, so it needs its own server and its own rung — `verify:full`, plus a mandatory `dev-smoke` CI
job. `playwright.config.ts` MUST keep `dev/**` in `testIgnore`: without it the production project
collects the dev spec, runs it against `vite preview` where the route 404s, and the coverage becomes an
illusion that still reports a pass.

**Counts are derived, never literal.** The fixture publishes `data-stress-total` /
`data-stress-components` from its own case list and the spec compares what it FOUND against those, with a
floor and a named state set. A hardcoded `toHaveCount(32)` means adding a component silently requires
editing the spec, and the version that forgets is green.

**States: `minimal` / `typical` / `long` / `unbroken` for text, `none` / `one` / `many` for collections.**
`unbroken` is the load-bearing one — a long sentence wraps on its spaces and hides a missing wrap guard.
`minimal` is one character rather than the empty string, because an unreadable label is a content bug and
not a layout one. **Not included, deliberately:** an RTL state, because no RTL locale ships here and
adding one is a product decision, not a fixture decision.

## The 44px touch floor is a ratchet here, not a redesign

**Measured:** exactly two rendered sizes sit below the floor across every route and content state — 40
(`Button`, from `h-10` and `size-10`) and 36 (`Input`, from `h-9`). Both are shadcn's default scale, which
this template ships unaltered.

**Decision.** `e2e/support/control-targets.ts` accepts those two EXACT sizes with a stated reason and an
exit condition; every other size below the floor fails the gate. Raising the whole kit to 44 would change
the visual scale of every app scaffolded from here, which is the consuming app's design decision. Keying
on the exact size is what keeps this a ratchet: a 38px control matches nothing in the list.

An acceptance list is the one gate component that fails by wrongly ACCEPTING, and sabotage never points
that way, so `control-targets.test.ts` is all near-misses: 37/38/39/41/42 refused, an icon-only control
refused at an accepted height but a narrow width, and the input entry proven unable to excuse an
icon-only control.

## `outline-hidden`, never `outline-none` — an accessibility change wearing a rename's clothes

**Compiled from the installed Tailwind rather than recalled:** `.outline-hidden` emits
`outline-style: none` PLUS `@media (forced-colors: active) { outline: 2px solid transparent;
outline-offset: 2px }`; `.outline-none` emits only the first. Every focusable control here pairs the
outline reset with a `ring-*`, which is a `box-shadow`, and `forced-colors` suppresses box-shadows. So
with `outline-none` a Windows high-contrast user had NO focus indicator at all (WCAG 2.4.7).

Swept in `button.tsx`, `input.tsx` and `SkipLink`. Pinned three ways, because no single one is enough:
class-string assertions (`focus-indicator.test.tsx`, `SkipLink.test.tsx`), a committed browser test that
emulates the mode (`e2e/forced-colors.spec.ts`), and `better-tailwindcss/no-deprecated-classes`. Mutation
check: restoring `outline-none` makes the browser test report `outline=none shadow=none` and the unit test
fail. **On every Tailwind minor bump, read the release notes for renamed utilities** — the build emits no
warning and only the lint rule can catch a rename that is already known.

## Tailwind class hygiene: two rules adopted on a pre-flight, one refused

`no-deprecated-classes` 2 findings / 2 genuine · `enforce-canonical-classes` 0 · `no-unknown-classes` 0.
The first two are enabled; `no-unknown-classes` is NOT, despite scoring zero, because its failure mode in
a TEMPLATE is a false positive on the first hand-written CSS class a consumer adds, and this repo already
applies `i18n-loading` imperatively rather than through a `className` the rule can see. Zero findings
today is not evidence it is safe for whatever gets scaffolded from here. Both plugins stay — the rule sets
do not overlap.

## Gate hygiene: three fail-open shapes closed

- **Coverage dropout.** Measured: with an unparseable file inside the coverage scope, vitest prints
  `Failed to parse <file>. Excluding it from coverage.` and **exits 0**, so the percentage describes a
  smaller set of files and can even go up. `scripts/check-coverage.mjs` wraps the run and refuses on that
  marker; proven in both directions. Marker-based rather than a file-count baseline on purpose — a
  baseline in a template would record the file count of an empty scaffold.
- **`bench:verify` had drifted from the gate it claimed to mirror**, missing the `check-hooks` and
  `ensure-playwright` steps while its own header said "same steps as `npm run verify`". The step list is
  now DERIVED from the `verify` script and throws on a segment it cannot parse, so a step cannot silently
  disappear from the benchmark. A second list claiming the gate's scope always drifts narrower than the
  gate; the fix is to have no second list.
- **`npx` without `--no-install`** in `ensure-playwright.mjs`: with an incomplete `node_modules`, npx
  fetches the newest Playwright and installs browsers for a version this repo does not pin.

## Cross-engine coverage is opt-in and scoped, and it earned its place immediately

`CROSS_BROWSER=1` adds Firefox and WebKit projects, `testMatch`-scoped to the geometry specs. Not in the
default run: three engines on every spec triples the local e2e wall-clock, and a WebKit font-metric
difference in an unrelated spec would fail a push for a reason unconnected to the change.

**What it found on the first run, which no amount of reasoning had:** Firefox reports `clientWidth: 0`
for an inline `<label>` — CSS `overflow` does not apply to inline non-replaced elements and CSSOM defines
their client box as zero — while Chromium reports a box. Every `<label>` on the page read as a 176px
overflow in one engine and as nothing in the other. The engine difference is real; the defect was in the
rule, which now exempts exactly `display: inline` and is tested in both directions.

A `testMatch` that matches nothing collects ZERO tests and reports success, so
`scripts/check-cross-browser-selection.mjs` asks Playwright whether every configured project actually has
work, and fails closed on a report it cannot read.
