# Architectural Decisions

## [2026-03] Tailwind v4 migration

**Decision**: Migrated from Tailwind v3 (config in `tailwind.config.ts`) to Tailwind v4 (config in `src/index.css`).

**Why**: v4 uses a Vite-native plugin (`@tailwindcss/vite`) which is faster and eliminates PostCSS as a build dependency. CSS-based config (`@theme inline`) is more collocated with actual styles.

**Trade-offs**: The `container` utility no longer has a JS-configurable `center`/`padding` option — apply utilities directly. `tailwindcss-animate` replaced by `tw-animate-css` (CSS import, no PostCSS plugin).

---

## [2026-03] rolldown-vite over standard vite

**Decision**: Using `npm:rolldown-vite` aliased as `vite`.

**Why**: Rust-based bundler with significantly faster build times. OXC minifier used instead of esbuild/terser.

**Risk**: Pre-stable. Some vite plugins may be incompatible. Monitor and revert to standard vite if plugins break. Tracked in SKELETONS.md.

---

## [2026-03] ESLint 9 (not 10) — intentional hold

**Decision**: Holding on ESLint 9.x. Not upgrading to ESLint 10 despite it being available.

**Why**: `typescript-eslint` 8.x is incompatible with ESLint 10 — missing `addGlobals()` method causes crash before any rules execute. Will upgrade when typescript-eslint ships a compatible release.

---

## [2026-03] @vitejs/plugin-react v5 (not v6) — intentional hold

**Decision**: Holding on @vitejs/plugin-react v5.x.

**Why**: v6 requires Vite 8+. We're on rolldown-vite 7.x. v6 also removes Babel as a dependency, requiring migration to `@rolldown/plugin-babel` for any Babel usage (currently none, but worth tracking).

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

## [2026-03] npm registry: `rolldown-vite@7.x` deprecation notice

**Context**: `npm ci` may print that `rolldown-vite@7.3.1` is deprecated in favor of migrating to Vite 8.

**Decision**: Stay on the pinned `rolldown-vite` 7.x line until a deliberate upgrade path to Vite 8 (or stable Rolldown) is tested end-to-end.

**Why**: The warning is registry metadata, not a build failure; early migration without a validated plugin matrix risks regressions. Track upstream release notes before bumping.

---

## [2026-03] `manualChunks`: include `@tanstack/query-core`

**Decision**: The `state-vendor` chunk groups `zustand`, `@tanstack/react-query`, and **`@tanstack/query-core`**.

**Why**: `ANALYZE` / rollup-visualizer showed `query-core` split between the entry chunk and `state-vendor` because only `react-query` was matched. Adding `query-core` merges all TanStack Query packages into one cacheable chunk and **reduces entry JS size** (fewer bytes on the app entry module graph).
