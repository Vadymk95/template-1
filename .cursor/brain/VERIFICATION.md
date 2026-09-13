# Verification — when to run what (agents & humans)

**Goal:** match checks to the MOMENT. The tier law itself lives in `AGENTS.md` § the gate — one place,
everything else points. This file holds the mechanics, the phase table, and the tracer.

## Phases — what a push proves, and the trigger that adds more

`scripts/gate-tiers.json` `"phase"` decides; `scripts/verify-push.mjs` dispatches; the skip is printed
on every phase-0 push. `GATE_PHASE=full` overrides per run (how gate machinery itself is pushed). CI
always runs the full chain — the phase gates only the LOCAL hook.

| Check | Runs at phase 0 (scaffold) | Added when (the trigger) |
| --- | --- | --- |
| audit, hooks-check, oxlint, format, tsc, lint, coverage | yes — every push, seconds | day one |
| production build in the gate | no | the FIRST DEPLOY: flip `"phase": 1` in its own commit |
| web-vitals chunks, `size:check` | no | same flip — they measure a built artefact |
| prod-mode e2e (`vite preview`) | no | same flip — a prod boundary now exists |
| dev-server smoke (content variance) | CI `dev-smoke` job, every PR | unchanged by phases |
| mutation score | weekly CI | unchanged by phases |

Measured here (`.gate-trace.log`, 2026-09-06 / 2026-09-11): a phase-0 push 16-26 s; the full chain
(`GATE_PHASE=full`, or phase 1) 73.7 / 77.6 s — which is why the `push` budget in `gate-tiers.json` is 90 s;
`verify:iter` 4.6-12.6 s; `verify:measure` 5.0 s; the mutation run 3m25s (`mutation.yml`).

## The tracer — how it works (the RULES it enforces are the tier law)

Every `verify*` and `test:e2e` run appends one TSV row to `.gate-trace.log` (gitignored);
`npm run trace:report` turns rows into findings — a forbidden stage run standalone, a run over its
moment's budget, a code check against a docs-only change, a push from a linked worktree. Moments,
budgets and classes are DATA in `scripts/gate-tiers.json`; the analyser names no stage, so the
discipline changes by editing that JSON.

## Ports — the mechanics

`e2e:one` and `verify:measure` route through `scripts/run-on-free-port.mjs`, which probes up from the
base port and exports `PORT` + `PLAYWRIGHT_BASE_URL`; the Playwright config passes that port into its
webServer command, because Vite reads neither variable. Playwright tears down the server it started.
The push gate's preflight takes `--kill-port` (SIGTERM, re-probe, refuse if it will not die).

## The four rungs

- **`npm run verify:iter`** — the iteration rung: `lint:oxlint` → `typecheck` (incremental via `tsc -b`)
  → `vitest run --changed --passWithNoTests` (only tests reachable from the uncommitted diff). Seconds;
  run it after every change. Two deliberate properties: while `package.json` or a vite/vitest config is
  dirty, `--changed` runs the FULL suite (those files are force-rerun triggers); and `--changed` follows
  the import graph only, so cross-cutting suites surface at the full-gate run, not during iteration.
- **`npm run verify`** — every **offline** check. Stage order: the `verify:inner` script; the superset
  rule and the push/CI split: `AGENTS.md` § the gate; why: `DECISIONS.md` [2026-07].
- **`npm run verify:ci`** — `audit:gate && verify`. The audit gate needs the network, which is why it
  is not inside `verify`: an offline implementer can still run the complete offline gate.
- **`npm run verify:full`** — `verify:ci && smoke:dev`. `smoke:dev` measures the content-variance
  fixture, which is mounted only under `import.meta.env.DEV` and therefore unreachable from the
  `vite preview` run inside `verify`. It needs a second server on its own port, so it is not in
  `verify`; CI runs it as its own `dev-smoke` job, mandatory on every PR. Run `verify:full` locally
  before a PR that touched a shared UI primitive, the layout shell, or `src/index.css`.

`npm run bench:verify` runs the same steps with per-step timings when the gate feels slow.

`npm run test:mutation` (StrykerJS) sits outside every rung on purpose: it rides the weekly
`mutation.yml` cron and is never part of `verify` — see AGENTS.md § Mutation testing.

---

## Minimal check by task type

Targeted checks are for the iteration loop. The gate is what says "done".

- **Docs only** (`*.md`, brain markdown) — `npm run format:check`
- **Styling only** (`*.css`) — `npm run format:check`
- **i18n copy only** (value edits in `public/locales/**/*.json`) — `npm run format:check`; wrapping and
  overflow for new copy lengths belong to the content-variance tier, not to a per-edit run
- **TS/TSX / tests** (logic, components, hooks, stores) — `npm run verify:iter`
- **Docs, rules, commands, brain, tier data** (`*.md`, `*.mdc`, `scripts/gate-tiers.json`) — `npm run docs:check` (the pre-commit hook runs it when such files are staged; `--weekly` adds past revisit dates; it also refuses a focused test and an unconditional skip without `quarantine until YYYY-MM-DD` + reason)
- **E2E / Playwright** (`e2e/**`, `playwright.config.ts`, routing) — `npm run e2e:one -- <spec>`
- **A shared UI primitive, the layout shell, or `src/index.css`** — the MEASURE moment:
  `npm run verify:measure -- e2e/layout-geometry.spec.ts`, or `npm run smoke:dev` for the dev-only
  content-stress fixture. Content-bearing work has to be measured against content it has not seen;
  the unit suite cannot do it because jsdom has no layout. See "Content variance" below.
- **A geometry invariant, a wrap guard, or anything about how text lays out** — additionally
  `CROSS_BROWSER=1 npm run smoke:dev` and `CROSS_BROWSER=1 npm run test:e2e:prod`. Engines disagree
  here in ways reasoning does not predict (measured: `DECISIONS.md` § Cross-engine coverage).
- **Touches `src/env.ts`, `vite.config.ts`, `src/lib/vitals.ts`, `src/lib/webVitals/`** — above, plus
  `npm run build && npm run verify:web-vitals-chunks`
- **Added or bumped a dependency** — `npm run audit:gate` (fails closed on high/critical, on an expired
  or stale allowance, and on its own inability to run) plus `npm run build && npm run size:check`
- **MSW** (`src/mocks/**`, `src/test/handlers.ts`, MSW wiring in `main.tsx`) — `npm run verify:iter`
- **Touched `eslint.config.js`** — `npm run lint`, then confirm the run is not silently a no-op:
  `npx eslint --print-config <a real source file>` should report a plausible active-rule count. A config
  that crashes on load and a config that lints nothing look identical from the exit code alone.
- **Suspected bundle size / duplicate deps** — `npm run build:analyze` → `dist/bundle-analysis.html`
  (do not commit the HTML)
- **Standard vs attribution web-vitals regression** — `npm run verify:web-vitals-chunks:full` (two full
  builds — use sparingly)

---

## Fixing what the checks report

`npm run fix` is the one remedy command: `oxlint --fix` → `eslint --fix` → `prettier --write`,
repo-wide. After it, re-run `npm run lint` and `npm run format:check` to see the residual autofix could
not handle — that residual needs a decision, not another `--fix`.

Never resolve a finding by lowering a severity, adding an `eslint-disable`, moving a coverage threshold,
or extending an ignore list. A rule that is genuinely wrong for a whole class of files gets a documented
file-scoped override in `eslint.config.js`.

---

## Capturing results honestly

The checklist (exit code without a pipe, prove the gate can go red, name the condition under which a
green would have been red): `.cursor/rules/agent-pipeline.mdc` § 4.1a — one home.

---

## Content variance

The rule: `AGENTS.md` § Critical rules › Content variance. Why and what it found: `DECISIONS.md`
§ Content variance is measured in a browser.

---

## Pre-commit vs the gate

Pre-commit is **repo-scoped**, not staged-scoped: `lint-staged` fixes and re-stages the staged set, then
the hook runs `lint:oxlint`, `format:check` and `typecheck` over the whole repo and refuses the commit if
any fails. Why the repo-wide pass exists: `DECISIONS.md` [2026-07] § Pre-commit is repo-scoped. Remedy on
refusal: `npm run fix && git add -u`.

The same hook blocks a staged `src` logic file with no co-located `*.test.*`
(`scripts/check-test-siblings.mjs`). It inspects only staged files, so it ratchets forward rather than
demanding a retroactive sweep. It proves a test EXISTS, never that it is any good — that is what the
mutation check in `.cursor/rules/agent-pipeline.mdc` §4.1a is for.

Its barrel exemption is spelled `index.ts`, never `index.tsx`, and the difference is load-bearing: in
this template `index.ts` is a `lazy()` re-export while `index.tsx` IS the component. The looser spelling
exempted all 11 components under `src/components/**` from the gate, six of which had no test anywhere. A
component written as `Dir/index.tsx` is satisfied by `Dir/Dir.test.tsx`, matching the convention the
existing components already follow — and only by that name, so a test for a different module in the same
folder does not count.

---

## Brain sync

If you add or change a script, a hook or a CI step: the `AGENTS.md` command table (the home) and, for
mechanics or timings, this file.
