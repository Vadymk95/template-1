# Verification — when to run what (agents & humans)

**Goal:** match checks to the MOMENT. The tier law itself lives in `AGENTS.md` § the gate — one place,
everything else points. This file holds the mechanics, the phase table, and the tracer. The stages each gate script runs:
`scripts/gate-tiers.json` (`checks.<name>.chain`), not repeated here.

## Phases — what a push proves, and the trigger that adds more

`scripts/gate-tiers.json` `"phase"` decides; `scripts/verify-push.mjs` dispatches; the skip is printed
on every phase-0 push. `GATE_PHASE=full` overrides per run (how gate machinery itself is pushed). CI
always runs the full chain — the phase gates only the LOCAL hook.

| Check | Runs at phase 0 (scaffold) | Added when (the trigger) |
| --- | --- | --- |
| the phase-0 push gate (`verify:scaffold:push`) | yes — every push, seconds | day one |
| production build in the gate | no | the FIRST DEPLOY: flip `"phase": 1` in its own commit |
| the checks that read the built artefact | no | same flip — they measure a built artefact |
| prod-mode e2e (`vite preview`) | no | same flip — a prod boundary now exists |
| dev-server smoke (content variance) | CI `dev-smoke` job, every PR | unchanged by phases |
| mutation score | weekly CI | unchanged by phases |

Measured here (`.gate-trace.log`, 2026-09-06 / 2026-09-11): a phase-0 push 16-26 s; the full chain
(`GATE_PHASE=full`, or phase 1) 73.7 / 77.6 s — which is why the `push` budget in `gate-tiers.json` is 90 s;
`verify:measure` 5.0 s; the mutation run 3m25s (`mutation.yml`).

`verify:iter` with the ESLint leg and the mutation-scope test (2026-10-29, a copy of the repository on 12 cores shared
with other work; five runs per case, the load noted): an unchanged tree 5.6-7.1 s (median 5.7, load 3 to 5) and a
docs-only change 6.1-7.7 s (median 6.2, same load). Against the chain before this leg, run alternately on the same
edit at a load of 17 to 26: one changed component 8.1-30.9 s (median 11.3) against 5.6-10.6 s (median 5.9), ten
changed files 8.6-14.9 s (median 9.3) against 6.1-9.1 s (median 6.4). The leg adds 1.5 to 3.5 s to a warm run; the
first run pays for a cold ESLint (14.9 s with ten files, 6.5 s more than the old chain), and the slowest single run
was a load spike (30.9 s). With `package.json` or the vitest config dirty the whole suite runs: 19.2 s of test time
at a load of 3.5 (79 files), 26-34 s through the whole chain at a load of 10 to 30 (84 files). The iterate budget
stays 15 s (`scripts/gate-tiers.json`): a cold first run, a spike or a dirty config can pass it on a loaded machine,
and `trace:report` lists that as a finding.

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
The push gate's preflight takes `--kill-port` (SIGTERM, re-probe, refuse if it will not die). It calls a port busy only when two looks 150 ms apart both find it busy
(`isPortBusy` in `scripts/check-gate-env.mjs`): one look cannot tell a server from a socket another process holds
for a millisecond, and `scripts/run-on-free-port.mjs` binds every port it walks.

Tests that bind sockets take their ports from `scripts/quiet-ports.mjs`: 10000-19999, below both ephemeral ranges,
one window per checkout and one lane per test file, never `listen(0)` or a fixed number.

`npm run probe` starts its own server the same way: the first free port from `PORT` (3000 for `--dev`, 4273 for the
build) with `--strictPort`, in a process group of its own, and it stops that whole group on every way out, signals
included. A probe killed outright (SIGKILL, a power cut) leaves the group behind: the record in `.probe/server.json`
lets the next run stop it, but only when the recorded start time and command prove it is the same server
(`scripts/server-group.mjs`). A busy port still means MOVE: the probe never signals a server it did not start.

## The four rungs

- **`npm run verify:iter`** — the iteration rung: the hooks check first (a clone without git hooks fails here, not at a push that
  runs no gate), the cheap static checks (the type check is incremental;
  the push tiers run it forced),
  then ESLint, type-aware, on the files the
  working tree changed (tracked changes against HEAD and untracked files, deleted ones left out;
  `scripts/lint-changed.mjs`), then only the tests reachable from the uncommitted diff, then the mutation-scope test by
  name (stages: `scripts/gate-tiers.json`). Seconds; run it after every change. Deliberate properties:
    - while `package.json` or a vite/vitest config is dirty, `--changed` runs the FULL suite. The force-rerun triggers
      are literal paths anchored at the repository root (`forceRerunTriggersFor` in `vitest.config.ts`): the runner's
      defaults never match a config file, and a `**` stops at a dot-directory such as `.worktrees/`, where not even
      `package.json` fired. That edit alone costs the whole suite, over the 15 s iterate budget by design;
    - `--changed` follows the import graph only, so cross-cutting suites surface at the full-gate run, not during
      iteration. The one exception is `scripts/mutation-scope.test.mjs`: it reads `stryker.config.json` as text, nothing
      imports that file, so the chain runs it by name;
    - the ESLint cache follows the Tailwind stylesheet. Both Tailwind rule families open `src/index.css` themselves and
      the cache keys on the file and the resolved config only, so `eslint.config.js` puts a fingerprint of that
      stylesheet, the local files it `@import`s and the installed version of each package it imports (`tailwindcss`,
      `tw-animate-css`) into `settings` for `**/*.tsx` (`scripts/css-fingerprint.mjs`). A stylesheet edit or a package
      upgrade re-lints those files and nothing else, so there is no `.eslintcache` to delete by hand. The package's
      files are not hashed: a patched copy with the same version is not seen;
    - `.cursor/` is ignored by both linters: it is tracked for the brain, rules, commands and templates, and an agent's
      scratch script there would otherwise red the chain.
- **`npm run verify`** — every **offline** check. Stage order: `scripts/gate-tiers.json`; the superset
  rule and the push/CI split: `AGENTS.md` § the gate; why: `DECISIONS.md` § The gate is `verify`.
- **`npm run verify:ci`** — the CI gate, and the push from phase 1. Its network-bound checks need
  the network, which is why they are not inside `verify`: an offline implementer can still run the complete offline gate.
- **`npm run verify:full`** — predicts the whole CI pipeline, the dev-smoke job included. `smoke:dev` measures the content-variance
  fixture, which is mounted only under `import.meta.env.DEV` and therefore unreachable from the
  `vite preview` run inside `verify`. It needs a second server on its own port, so it is not in
  `verify`; CI runs it as its own `dev-smoke` job, mandatory on every PR. Run `verify:full` locally
  before a PR that touched a shared UI primitive, the layout shell, or `src/index.css`.

## After a red push: re-run only what failed

Both Playwright configs cap failures (`maxFailures`) on the gate run and in CI, and each writes
`.last-run.json` to its own `outputDir` — see `AGENTS.md` § the gate and `DECISIONS.md` § Playwright `maxFailures: 10`.
The re-run after a fix, production-mode suite (`npm run build` first in both cases):

- **The red stopped at the cap**: `PLAYWRIGHT_USE_PREVIEW=1 npx playwright test <failed spec files from the red output>`
- **The red finished under the cap**: `PLAYWRIGHT_USE_PREVIEW=1 npx playwright test --last-failed`

Name the files rather than reaching for `--last-failed` by default: after a capped stop,
`.last-run.json` also lists every test the run never reached, so `--last-failed` re-runs most of
the suite instead of only what failed.

- **Dev smoke**: `npx playwright test --config playwright.dev.config.ts --last-failed`

`npm run bench:verify` runs the same steps with per-step timings when the gate feels slow.

`npm run test:mutation` (StrykerJS) sits outside every rung on purpose: it rides the weekly
`mutation.yml` cron and is never part of `verify` — see `DECISIONS.md` § Mutation testing.

---

## Minimal check by task type

Targeted checks are for the iteration loop. The gate is what says "done".

- **Docs only** (`*.md`, brain markdown) — `npm run format:check`
- **Styling only** (`*.css`) — `npm run format:check`
- **i18n copy only** (value edits in `public/locales/**/*.json`) — `npm run format:check`; wrapping and
  overflow for new copy lengths belong to the content-variance tier, not to a per-edit run
- **TS/TSX / tests** (logic, components, hooks, stores) — `npm run verify:iter`
- **A type error the editor does not show, or a `tsconfig*.json` edit** — `npm run typecheck`. It is incremental: each of the four projects (app, node, vitest and the browser specs) keeps its state in a file under `.tsbuild/` (git-ignored, outside `node_modules`), so an unchanged run takes about 0.1 s and a one-file change 0.9 to 2.2 s. A plain `tsc -b` follows the project's own files only and does not see a dependency that changed in `node_modules` (measured: a changed dependency type file left it at exit 0, `tsc -b --force` at exit 2),
  so the push tiers run it forced (`npm run typecheck:force`), and an iterate run after `npm ci` or a lockfile change wants `npx tsc -b --force` once
- **A new hook or util** (`src/hooks/**`, `src/lib/**`) — after `npm run verify:iter`, a file-scoped mutation run: `npx stryker run --mutate <file>` (`npx stryker run --help`: `--mutate` selects one file or a subset, `--testFiles` limits the test files that run). Measured in a fork: one minute over a new hook found three tests that looked complete and were not, which a green unit run hides. It stays outside every rung (`DECISIONS.md` § Mutation testing)
- **Docs, rules, commands, brain, tier data** (`*.md`, `*.mdc`, `scripts/gate-tiers.json`) — `npm run docs:check` (the pre-commit hook runs it when such files are staged, and `verify` and `verify:scaffold` run it on every push; `--weekly`, the scheduled Docs workflow's flag, runs the same checks so a quarantine that expires while nobody pushes still turns it red; it also refuses a focused test, an unconditional way to switch a test off (`.skip`, `.fixme`, an expected failure such as `.fails` or `.failing`, a constant `.skipIf(true)`) without `quarantine until YYYY-MM-DD` + reason, a quarantine date more than 30 days out, a quarantine whose date has arrived (red ON the date, UTC, not the day after), a gate chain view in `scripts/gate-tiers.json` that differs from `package.json`, a gate command that lost a strict flag (the linters' `--max-warnings 0` and `--deny-warnings`, a test run that does not run once) or carries `--passWithNoTests` outside the iterate chain, a path that names an emptied folder, an ignored file or a line number, a file at the root included (cite the symbol), a `DECISIONS.md` entry without an index row, a row without an entry, or an entry over 30 lines, a hand-written retelling or composition of the chain (a line naming three or more of its stages, or two parts of one script), and an agent-memory import: an `@` pointer in `CLAUDE.md` or `AGENTS.md` that names a file, which Claude Code would load into every session; write it as a backticked path instead)
- **Proposing a new browser spec** — the suite is counted in invariants, not screens (`AGENTS.md` § the gate), by the `test(` and `it(` calls in the spec files, so a second subject of an invariant that already has a case becomes a `test.step` or an extra assertion in that case, never a new `test(`; the ceiling is raised only with a measurement and a `DECISIONS.md` line. `npm run docs:check` prints the suite's measurement and reports it against the ceiling in `scripts/gate-tiers.json` § suites
- **E2E / Playwright** (`e2e/**`, `playwright.config.ts`, routing) — `npm run e2e:one -- <spec>`. Locally a failure is a failure (no retries). In CI a test gets two retries so one flake cannot block a merge, but a test that only passed on a retry still fails the run (`failOnFlakyTests`): fix it or quarantine it (`docs:check` tracks quarantines), never let it pass quietly. Specs that run against the built app import `test` from `e2e/support/test.ts`: it fails a test on a Content-Security-Policy violation, read from the console and from the `securitypolicyviolation` event so every engine reports it, because `vite preview` sends the shipped headers (`vite-plugins/security-headers.ts`, whose unit test pins the set). A spec that visits a route also runs the axe scan (`e2e/support/a11y.ts`); a serious or critical violation, or a control under the WCAG 2.2 target-size minimum, fails it, and the failure prints the rule id and the selectors.
- **A shared UI primitive, the layout shell, or `src/index.css`** — the MEASURE moment:
  `npm run verify:measure -- e2e/layout-geometry.spec.ts`, or `npm run smoke:dev` for the dev-only
  content-stress fixture. Content-bearing work has to be measured against content it has not seen;
  the unit suite cannot do it because jsdom has no layout. See "Content variance" below.
- **A geometry invariant, a wrap guard, or anything about how text lays out** — additionally
  `CROSS_BROWSER=1 npm run smoke:dev` and `CROSS_BROWSER=1 npm run test:e2e:prod`. Engines disagree
  here in ways reasoning does not predict (measured: `DECISIONS.md` § Cross-engine coverage).
- **Touches `src/env.ts`, `vite.config.ts`, `src/lib/vitals.ts`, `src/lib/webVitals/`** — above, plus
  `npm run verify:web-vitals-chunks` (it reads `dist/`; build first)
- **Added or bumped a dependency** — `npm run audit:gate` (fails closed on high/critical, on an expired
  or stale allowance, and on its own inability to run), `npm run lock:age` (the new version must be older
  than `min-release-age` or carry an allowance), plus `npm run size:check` (it reads `dist/`; build first)
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

`npm run fix` is the one remedy command: the autofix of every linter and the formatter (the `fix` script in
`package.json`), repo-wide. After it, re-run `npm run lint` and `npm run format:check` to see the residual autofix could
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
the hook runs the cheap checks (the list is `.husky/pre-commit`) over the whole repo and refuses the commit if
any fails. Why the repo-wide pass exists: `DECISIONS.md` § The gate is `verify` ("Pre-commit is repo-scoped"). Remedy on
refusal: `npm run fix && git add -u`.

The same hook blocks a staged `src` logic file with no co-located `*.test.*`
(`scripts/check-test-siblings.mjs`). It inspects only staged files, so it ratchets forward rather than
demanding a retroactive sweep. The first commit of a repository (no HEAD yet) is not judged, as in range mode with no
base. A sibling counts only when it is in the index, never when it merely sits on disk. The
same check runs over the whole branch inside `verify` and `verify:scaffold`, so CI and the push in either phase reach it
(`--range`: `base...HEAD` against HEAD's tree; base = `HEAD~1` in CI, else the merge base with `origin/master`), so a
`--no-verify` commit is caught at the push. It proves a test EXISTS, never that it is any good — that is what the
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
