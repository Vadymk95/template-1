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

**Content variance** — anything that renders authored copy is proven against content it has NOT seen:
`minimal` / `typical` / `long` / `unbroken` for text, `none` / `one` / `many` for collections. The fixture
is `/dev/ui/content-stress` (dev-only), measured by `e2e/dev/content-stress.spec.ts` at
390 / 640 / 768 / 1024 / 1440; the assembled pages are measured by `e2e/layout-geometry.spec.ts`. Add a
case when you add a content-bearing component. Two rules earned the hard way: the RANGE of widths a guard
covers is part of its specification (a guard proven at one width usually just moves the defect), and a
wrap class with no red-to-green proof gets deleted rather than kept "to be safe".

**Rendering differences are measured, not predicted** — engines disagree about intrinsic sizing, font
metrics (so any `ch` measure), scrollbar gutters and `forced-colors`. `CROSS_BROWSER=1` adds Firefox and
WebKit to the geometry specs; CI runs that as its own job. Measured here: Firefox reports
`clientWidth: 0` for an inline `<label>` per CSSOM while Chromium reports a box. Never reason about what
an engine does — run it.

## Commands / the gate

**Five agent commands** in `.claude/commands/`. Each one puts the agent in a role, with this repo's own
gate, danger zones and test infrastructure named inside it — so nothing has to be guessed or invented.

```bash
/onboard   # get genuinely oriented: read the brain, VERIFY it against the code, report drift, stop
/feat      # implement a feature: reuse check → scope → plan → test-first → gate → report
/test      # write tests that hunt corner cases at integration seams, not the happy path
/review    # senior review of the diff: leaks, security, bug-hunt algorithm, test strength
/docs      # bring AGENTS.md + .cursor/brain/ back in line with the code and with master's history
```

Scripts:

```bash
npm run fix          # oxlint --fix → eslint --fix → prettier --write — the one remedy command
npm test             # vitest run (the gate uses test:coverage — thresholds only apply with --coverage)
```

The gate:

```bash
npm run dev           # Vite dev server
npm run verify        # THE gate: hooks → typecheck → oxlint → eslint → format → coverage → build
                      # → web-vitals chunks → size-limit → playwright browsers → e2e
npm run verify:ci     # verify + audit:gate — what pre-push and GitHub CI both run
npm run verify:full   # verify:ci + smoke:dev — adds the content-variance fixture (needs a dev server)
npm run smoke:dev     # the content-stress fixture alone, against `vite dev`
npm run test:e2e:prod # Playwright against `vite preview` (same mode as the gate)
npm run bench:verify  # the gate step by step with timings, to attribute a slow run
npm run test:mutation # StrykerJS strength gate — weekly `mutation.yml` job, NOT in verify (3m+ per run)
```

`verify:full` is the rung to run before a PR that touched a shared UI primitive, the layout shell or
`src/index.css`. It is not inside `verify` because it needs a second server on its own port; CI runs it as
a mandatory `dev-smoke` job instead, so it cannot be forgotten. `bench:verify` DERIVES its step list from
the `verify` script — do not hand-write a second list, that one had already drifted by two steps.

**`verify` is a strict superset of the offline checks CI runs.** A green `verify` therefore predicts a
green CI, and keeping that true is a rule: **a new check goes into the script, never only into the
workflow file.** `audit:gate` sits in `verify:ci` rather than `verify` because it needs the network,
so an offline agent can still run the full offline gate.

`ci:local` is an alias of `verify:ci`, kept for muscle memory across templates.

**Pre-commit is repo-scoped, not staged-scoped.** `lint-staged` fixes and re-stages what you are
committing, but for a partially staged file it restores the unstaged hunks _after_ fixing — so
formatting drift used to survive a commit and only fail at push, leaving "already fixed but never
committed" files in the tree. The hook now also runs `lint:oxlint` and `format:check` over the whole
repo and refuses the commit, naming the remedy: `npm run fix && git add -u`.

**Bootstrap after clone**: `npm run prepare` (once) — `.npmrc` disables lifecycle
scripts as a supply-chain guard, so husky hooks don't install themselves; the
verify gate fails loudly if hooks are missing. Dependency cooldown is also on
(`.npmrc` `min-release-age=3`, DAYS): a brand-new package or urgent patch needs
`npm install <pkg> --min-release-age=0`.

The gate is **zero-warnings**: `eslint --max-warnings 0`, `oxlint --deny-warnings`. If it fails, fix the cause — do **not** downgrade rules, silence warnings, or sprinkle `eslint-disable`. If a rule is genuinely wrong for a class of files, add a documented file-scoped override in `eslint.config.js` stating why (see the shadcn/ui and `*.queries.ts` overrides for the pattern).

**Complexity ratchet** — `complexity` 10 / `max-depth` 3 / `max-params` 4 / `max-lines-per-function` 120 / `max-lines` 200 over `src/**`, tests exempt. Thresholds sit above the measured ceiling (see `DECISIONS.md`), so a hit means new drift: split the function first; raising a number needs a fresh measurement and a `DECISIONS.md` line.

**Mutation testing** — `npm run test:mutation` (StrykerJS, weekly `mutation.yml` CI job). Coverage proves code RUNS under tests; the mutation score proves tests would CATCH a wrong implementation — the two disagree here by design (57% coverage vs 44.5% baseline score). `thresholds.break` in `stryker.config.json` is a measured floor-of-record: raise it after a good run, never lower it to go green.

## Version holds (do not "fix" by bumping)

- **ESLint is 10.x** — the 9.x hold was lifted ahead of the 2026-08-06 end of life. Three plugins still cap their `eslint` peer below 10 (`eslint-plugin-react` at `^9.7`, `eslint-plugin-jsx-a11y` at `^9`, and `eslint-plugin-import` transitively), so each has an `overrides` entry mapping that peer to `$eslint`. Do not remove them, and do not reach for `--legacy-peer-deps`. **`settings.react.version` must stay a literal, never `'detect'`** — see `DECISIONS.md`.
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
Types: `feat` `fix` `chore` `docs` `style` `refactor` `perf` `test` `revert` `build` `ci`

## Maintaining this file

Treat it like code. Add a rule when an agent or developer makes the same mistake twice — one line tied to the observed failure. Prune stale lines; a bloated file reduces compliance. One-line digests only — depth lives in `.cursor/brain/`.
