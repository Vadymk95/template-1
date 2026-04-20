# Verification — when to run what (agents & humans)

**Goal:** match checks to the change. Do **not** run the full CI stack for every tiny edit.

Full reference: `.github/workflows/ci.yml`. One-command mirror: `npm run ci:local`.

---

## Minimal check by task type

| What you changed | Suggested commands |
|------------------|-------------------|
| **Docs only** (`*.md` in repo root / `README`, brain markdown) | `npm run format:check` |
| **Styling only** (`*.css`, `*.scss`, `*.styled.*`) | `npm run format:check` + `npm run lint` (if CSS is in ESLint scope) |
| **TS/TSX / tests** (logic, components, hooks, stores) | `npm run lint && npm run typecheck && npm test` |
| **E2E / Playwright** (`e2e/**`, `playwright.config.ts`, routing/flows) | `npm run build && PLAYWRIGHT_USE_PREVIEW=1 npm run test:e2e` (needs `npx playwright install chromium` once) |
| **Touches `src/env.ts`, `vite.config.ts`, `src/lib/vitals.ts`, `src/lib/webVitals/`** | Above + `npm run build && node scripts/check-web-vitals-chunks.mjs` |
| **Suspected bundle size / duplicate deps** | `npm run build:analyze` → open `dist/bundle-analysis.html` (do not commit HTML) |
| **Regressions in standard vs attribution web-vitals chunks** | `npm run verify:web-vitals-chunks` (two full builds — use sparingly) |

---

## Full local CI (same order as GitHub Actions)

```bash
npm run ci:local
```

Runs: `npm audit --audit-level=moderate` → `typecheck` → `lint:oxlint` → `lint` → `format:check` → `test:coverage` → `build` → `node scripts/check-web-vitals-chunks.mjs` → `npx playwright install --with-deps chromium` → `PLAYWRIGHT_USE_PREVIEW=1 npm run test:e2e` (Chromium E2E against `vite preview`).

Use **before push** or when impact is unclear. **Do not** run as default for one-line fixes or copy edits in Brain.

---

## Do not run by default

| Command | Why |
|---------|-----|
| `npm run verify:web-vitals-chunks` | Two production builds; only for vitals/env/chunk work |
| `ANALYZE=true` / `build:analyze` | Heavy; only for bundle investigation |
| `npm ci` | Reinstalls deps; CI uses it on clean runners — locally use when lockfile changes |

---

## Brain / MAP sync

If you add new scripts or CI steps, update this file and `PROJECT_CONTEXT.md` → Dev Tooling. If entry points, routes, or `src/lib` layout change, align `MAP.md` (and `SKELETONS.md` if new hazard).
