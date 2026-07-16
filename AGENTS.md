# react-enterprise-foundation — agent guide

Production-ready React 19 + Vite 8 (Rolldown) + TypeScript 6.0 SPA template — routing, Zustand + TanStack Query, i18next, Tailwind v4, Vitest + Playwright pre-configured.

## Start here

1. Read `.cursor/brain/PROJECT_CONTEXT.md` before any task. Architecture map: `.cursor/brain/MAP.md`. Danger zones: `.cursor/brain/SKELETONS.md`. What to run per change: `.cursor/brain/VERIFICATION.md`. Template seeds (do NOT remove as "dead code"): `.cursor/brain/TEMPLATE_SEEDS.md`.
2. `.cursor/rules/*.mdc` are **binding for the files they cover** — read the rules relevant to the area you touch before the first edit.

## Source of truth (tiebreaker)

- **This file is the canonical guide for every tool.** Cursor and Codex load it natively; Claude Code loads it through the one-line `@AGENTS.md` import in `CLAUDE.md`. Edit THIS file; never grow the shim.
- **Code is ground truth; this file is a verifiable pointer.** If a line here conflicts with the code, follow the CODE and fix or flag the stale line in the same session.

## Stack

React 19 · TypeScript 6.0 strict · Vite 8 (Rolldown) · Tailwind **v4** · shadcn/ui · Zustand 5 · TanStack Query 5 · React Router 7 · i18next · Vitest 4.1 · Playwright

## Critical rules

**Tailwind v4** — no `tailwind.config.ts`. Theme lives in `src/index.css` (`@theme inline {}`). Dark mode via `.dark` class. Animations via `tw-animate-css`.

**Components** — always extract logic to `useComponentName.ts` hook alongside the component. Declare in/out explicitly: `const X: FunctionComponent<Props> = () => …` or an explicit return type (`(): ReactElement`, hooks `(): UseXResult`) — enforced by `@typescript-eslint/explicit-function-return-type` (inline callbacks exempt). Interface callbacks use property style (`onSelect: (id: string) => void`), not method style — enforced by `method-signature-style`.

**Pages** — lazy by default (`PageName.tsx` + `index.ts` with `lazy()`), wrap with `WithSuspense` in router.

**Stores** — Zustand with `createSelectors`. Files in `src/store/<domain>/`, tests alongside.

**i18n** — no hardcoded strings. Every user-visible string goes through `t()`.

**Imports** — `@/` alias only, no relative `../../`. Order enforced by eslint-plugin-import-x.

**Reuse first** — before creating any function/util/component/constant, search for an existing equivalent and extend it. Duplicate utilities are a violation, not a style choice.

**Consistency beats preference** — match the surrounding file's style and patterns.

## Commands / the gate

```bash
npm run dev          # Vite dev server
npm run verify       # typecheck → oxlint → eslint → prettier check → tests+coverage (commit gate)
npm run ci:local     # full local CI (adds audit, build, chunk/size checks, e2e)
```

The gate is **zero-warnings**: `eslint --max-warnings 0`, `oxlint --deny-warnings`. If it fails, fix the cause — do **not** downgrade rules, silence warnings, or sprinkle `eslint-disable`. If a rule is genuinely wrong for a class of files, add a documented file-scoped override in `eslint.config.js` stating why (see the shadcn/ui and `*.queries.ts` overrides for the pattern).

## Version holds (do not "fix" by bumping)

- **ESLint stays 9.x** — `eslint-plugin-react` peers stop at `^9.7`, `eslint-plugin-jsx-a11y` at `^9` (verified 2026-07-16). ESLint 9 EOL is 2026-08-06 — re-check the peers before bumping.
- **TypeScript stays `~6.0.x`** — `typescript-eslint` peer is `<6.1.0`. TS 7 exists; do not bump until the peer widens.
- **`oxlint` tilde-tracks `eslint-plugin-oxlint`** — lockstep releases; the plugin pins `~<its version>`.
- **`@types/node` stays 24.x** — types match `engines.node >= 24`, not the newest Node.

## Machine-agnostic configs

Committed configs must never contain absolute local paths. The VS Code i18next extension rewrites `i18next.i18nPaths` with absolute paths when it can't resolve the configured ones — keep them relative and existing.

## Out of scope (ask before touching)

- Weakening the verify gate, lint severities, or coverage thresholds to get green.
- Removing template scaffolding listed in `.cursor/brain/TEMPLATE_SEEDS.md`.
- Node engine bump (`engines.node`).

## Commit format

`type(scope): description` — max 96 chars.
Types: `feat` `fix` `chore` `docs` `style` `refactor` `perf` `test` `revert`

## Maintaining this file

Treat it like code. Add a rule when an agent or developer makes the same mistake twice — one line tied to the observed failure. Prune stale lines; a bloated file reduces compliance. One-line digests only — depth lives in `.cursor/brain/`.
