# Verification — when to run what (agents & humans)

**Goal:** match checks to the change. Do **not** run the full CI stack for every tiny edit.

Full reference: `.github/workflows/ci.yml`.

- **Default commit/push gate:** `npm run verify` (typecheck → lint → format → coverage → build → e2e). Husky **pre-push** runs this.
- **Stricter local CI:** `npm run ci:local` (adds audit + web-vitals chunk check + size-limit on top of the same path).

---

## Minimal check by task type

- **Docs only** (`*.md` in repo root / `README`, brain markdown) — `npm run format:check`
- **Styling only** (`*.css`, `*.scss`, `*.styled.*`) — `npm run format:check` + `npm run lint` (if CSS is in ESLint scope)
- **TS/TSX / tests** (logic, components, hooks, stores) — `npm run lint && npm run typecheck && npm test`
- **E2E / Playwright** (`e2e/**`, `playwright.config.ts`, routing/flows) — `npm run test:e2e:prod` (or `npm run build && PLAYWRIGHT_USE_PREVIEW=1 npm run test:e2e`; needs Chromium once)
- **Touches `src/env.ts`, `vite.config.ts`, `src/lib/vitals.ts`, `src/lib/webVitals/`** — Above + `npm run build && node scripts/check-web-vitals-chunks.mjs`
- **MSW** (`src/mocks/**`, `test/handlers.ts`, MSW wiring in `main.tsx`) — `npm run lint && npm run typecheck && npm test` (smoke dev manually if handlers changed)
- **Suspected bundle size / duplicate deps** — `npm run build:analyze` → open `dist/bundle-analysis.html` (do not commit HTML)
- **Regressions in standard vs attribution web-vitals chunks** — `npm run verify:web-vitals-chunks:full` (two full builds — use sparingly)
- **Vendor chunk byte budget** (touched `vite.config.ts` `codeSplitting.groups`, added a vendor dep, or `npm run build` output looks heavier) — `npm run build && npm run size:check` (reads `.size-limit.json` per-chunk brotli budgets)

---

## Local gates (`verify` vs `ci:local`)

- **`npm run verify`** — commit/push gate: typecheck → oxlint → eslint → format → test:coverage → build → **`test:e2e:prod`** (Playwright vs `vite preview`). This is what husky **pre-push** runs.
- **`npm run ci:local`** — stricter mirror of GitHub Actions: audit at moderate+ → same path as verify through build → web-vitals chunk script → size:check → Playwright install → E2E. Use when you want the full CI-shaped run (audit + size budgets), not for every push.

**Do not** run `ci:local` as default for one-line fixes or copy edits in Brain.

---

## Do not run by default

- **`npm run verify:web-vitals-chunks:full`** — two production builds; only for vitals/env/chunk work (plain `verify:web-vitals-chunks` is a cheap `dist/` check)
- **`ANALYZE=true` / `build:analyze`** — heavy; only for bundle investigation
- **`npm ci`** — reinstalls deps; CI uses it on clean runners — locally use when lockfile changes

---

## Brain / MAP sync

If you add new scripts or CI steps, update this file and `.cursor/brain/PROJECT_CONTEXT.md` → Dev Tooling. If entry points, routes, or `src/lib` layout change, align `.cursor/brain/MAP.md` (and `.cursor/brain/SKELETONS.md` if new hazard).
