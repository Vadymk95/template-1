# Verification — when to run what (agents & humans)

**Goal:** match checks to the change. Do **not** run the full gate for every tiny edit — but never
declare a task done on a targeted check alone.

## The two gates

- **`npm run verify`** — every **offline** check, in order: `check-hooks` → `typecheck` → `lint:oxlint`
  → `lint` → `format:check` → `test:coverage` → `build` → `verify:web-vitals-chunks` → `size:check` →
  `ensure-playwright` → `test:e2e:prod` (Playwright against `vite preview`).
- **`npm run verify:ci`** — `audit:gate && verify`. The audit gate needs the network, which is why it
  is not inside `verify`: an offline implementer can still run the complete offline gate.

**`verify` is a strict superset of the offline checks CI runs**, so a green `verify` predicts a green
CI. Husky **pre-push** runs `verify:ci`; the GitHub `validate` job is a single step over the same
script. `ci:local` is an alias of `verify:ci`.

The rule that keeps this true: **a new check goes into the script, never only into the workflow file.**
Adding it to CI alone is how the gate stopped predicting CI once already — see `DECISIONS.md`.

`npm run bench:verify` runs the same steps with per-step timings when the gate feels slow.

---

## Minimal check by task type

Targeted checks are for the iteration loop. The gate is what says "done".

- **Docs only** (`*.md`, brain markdown) — `npm run format:check`
- **Styling only** (`*.css`) — `npm run format:check`
- **TS/TSX / tests** (logic, components, hooks, stores) — `npm run lint && npm run typecheck && npm test`
- **E2E / Playwright** (`e2e/**`, `playwright.config.ts`, routing) — `npm run test:e2e:prod`
- **Touches `src/env.ts`, `vite.config.ts`, `src/lib/vitals.ts`, `src/lib/webVitals/`** — above, plus
  `npm run build && npm run verify:web-vitals-chunks`
- **Added or bumped a dependency** — `npm run audit:gate` (fails closed on high/critical, on an expired
  or stale allowance, and on its own inability to run) plus `npm run build && npm run size:check`
- **MSW** (`src/mocks/**`, `src/test/handlers.ts`, MSW wiring in `main.tsx`) —
  `npm run lint && npm run typecheck && npm test`
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

```bash
npm run verify > /tmp/verify.log 2>&1; echo $?
```

**Without a pipe.** Piping to `tail` returns the pipe's exit status, so a failed build reads as a pass.
This has bitten this project's own tooling work.

Green also means nothing until you have seen the gate go red. When you add or change a check, break it
once on purpose — an expired entry in `scripts/audit-allowlist.json`, a raw hex in a component, a staged
`src` logic file with no test sibling — confirm it refuses, then revert the sabotage.

---

## Pre-commit vs the gate

Pre-commit is **repo-scoped**, not staged-scoped: `lint-staged` fixes and re-stages the staged set, then
the hook runs `lint:oxlint` and `format:check` over the whole repo and refuses the commit if either
fails. Reason: for a partially staged file `lint-staged` restores the unstaged hunks *after* fixing, so
formatting drift used to survive the commit and fail at push, leaving files that were already fixed and
never committed.

The same hook blocks a staged `src` logic file with no co-located `*.test.*`
(`scripts/check-test-siblings.mjs`). It inspects only staged files, so it ratchets forward rather than
demanding a retroactive sweep. It proves a test EXISTS, never that it is any good — that is what the
mutation check in `.cursor/rules/agent-pipeline.mdc` §4.1a is for.

---

## Brain sync

If you add or change a script, a CI step or a hook, update this file **and** `PROJECT_CONTEXT.md`
(Dev Tooling) **and** the `AGENTS.md` command list in the same change. Three places describe the gate,
and all three have been stale at the same time before.
