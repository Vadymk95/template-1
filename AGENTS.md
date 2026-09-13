# react-enterprise-foundation — agent guide

Production-ready React 19 + Vite 8 (Rolldown) + TypeScript 6.0 SPA template — routing, Zustand + TanStack Query, i18next, Tailwind v4, Vitest + Playwright pre-configured.

## Start here

1. Read `.cursor/brain/PROJECT_CONTEXT.md` before any task. Architecture map: `.cursor/brain/MAP.md`. Danger zones: `.cursor/brain/SKELETONS.md`. What to run per change: `.cursor/brain/VERIFICATION.md`. Template seeds (do NOT remove as "dead code"): `.cursor/brain/TEMPLATE_SEEDS.md`.
2. `.cursor/rules/*.mdc` are **binding for the files they cover** — read the rules relevant to the area you touch before the first edit.

## Source of truth (tiebreaker)

- **This file is the canonical guide for every tool.** Cursor and Codex load it natively; Claude Code loads it through the one-line `@AGENTS.md` import in `CLAUDE.md`. Edit THIS file; never grow the shim.
- **Code is ground truth; this file is a verifiable pointer.** If a line here conflicts with the code, follow the CODE and fix or flag the stale line in the same session.

## Stack

React 19 · TypeScript 6.0 strict · Vite 8 (Rolldown) · Tailwind **v4** · shadcn/ui · Zustand 5 · TanStack Query 5 · React Router 7 · i18next · Vitest 5 · Playwright

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

## Entering this repo cheaply (read this before sweeping the source)

Measured on a sibling project 2026-08-30: an agent's entry is ~93% READING SOURCE to find where
things are and whether the task is still needed, and ~7% the documents that load automatically. So
the levers are pointing and looking, in this order:

1. **Open `.cursor/brain/READING_INDEX.md` first** — it maps a SITUATION ("about to change a shared
   primitive") to the two or three files that answer it. It is a pointer file: it never restates a
   rule, so it cannot go stale in the way a summary does.
2. **Check the work is still needed** — `git log --oneline -15` plus one grep for the thing the task
   names. Two of five lanes in that measurement returned "already done" after ~430k tokens; both
   were five minutes of grep.
3. **LOOK instead of inferring** - `npm run probe -- <route> [widths]` renders the route, saves a PNG per width under `.probe/` and prints the quantities the layout guards measure. One measurement replaces a round of reasoning about pixels; it is an instrument, never a gate.
4. **Name the files when you dispatch work to another agent.** The largest observed difference
   between a 33-tool-call lane and a 191-tool-call lane was how precisely the task pointed.

**Where a rule must live** (which tool reads which file, and why a rule that must reach every tool
belongs in this file): § Commands / the gate › Lanes › _Two tools, one file_. Verify what each tool
loads before moving a rule between files.

## Commands / the gate

**Five agent commands** in `.claude/commands/`, each mirrored by a thin shim in `.cursor/commands/` so
Cursor and Claude Code behave identically — edit the `.claude/` file, never the shim. Each one puts the
agent in a role, with this repo's own gate, danger zones and test infrastructure named inside it — so
nothing has to be guessed or invented.

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
npm run verify:iter   # iteration tier: oxlint → tsc → vitest --changed (seconds; run per change)
npm run verify:measure # MEASURE moment: build + look; add `-- e2e/<f>.spec.ts` for one preview-mode spec
npm run e2e:one -- <spec> # one Playwright spec, FREE port, through the tracer
npm run verify:push   # what pre-push runs: phase-aware (see gate-tiers.json / § the gate)
npm run probe -- <route> [widths] # LOOK: render, screenshot per width, print measured quantities
npm run test:one -- <file> # one unit test file, through the tracer (not around it)
npm run trace:report  # findings from .gate-trace.log (forbidden moments, budgets, worktrees)
npm run docs:check    # docs class: paths, scripts, sentinels, versions, command table, dead docs, test quarantines (pre-commit when docs are staged; weekly CI adds --weekly)
npm run verify        # THE gate: hooks → preflight → oxlint → format → typecheck → eslint (cached) → coverage → build
                      # → web-vitals chunks → size-limit → playwright browsers → e2e
npm run verify:ci     # verify + audit:gate — the CI chain; the push runs it in phase 1 (see below)
npm run verify:full   # verify:ci + smoke:dev — adds the content-variance fixture (needs a dev server)
npm run smoke:dev     # the content-stress fixture alone, against `vite dev`
npm run test:e2e:prod # Playwright against `vite preview` (same mode as the gate)
npm run bench:verify  # the gate step by step with timings, to attribute a slow run
npm run test:mutation # StrykerJS strength gate — weekly `mutation.yml` job, NOT in verify (3m+ per run)
```

<!-- shared-harness:begin -->
<!-- This block is byte-identical in all four templates (template-1, template-spa-pwa, template-next-seo, template-rn). Change it in every template in the same commit, or not at all. Stack-specific facts (which stages `verify` runs, ports, what is skipped and why, timings) live OUTSIDE this block: in the command table above and in `.cursor/brain/VERIFICATION.md`. -->

### The tier law - this section is the ONLY place it lives

Every other file (rules, commands, brain, README, Copilot instructions) points here and restates nothing.
A restated pipeline rule goes stale in place; a stale copy cost a sibling repo a day of 40-minute rounds
because five copies still demanded the full chain before the first report. `scripts/gate-tiers.json` is
the machine-readable form (expected and forbidden scripts per moment, budgets, phase); when this prose and
that file disagree, the file wins and the prose is fixed in the same commit.

**Four moments, and one that is not a gate.**

- **Iterate** - per change, seconds. Run `verify:iter`. Where the change touches a surface that has its
  own spec and the repo has a browser lane, run that ONE spec through the traced single-spec script (see
  the command table). Nothing heavier.
- **Measure** - whenever only a rendered result can answer the question: the measure script (build +
  look) or the probe, where the repo has them. Legal at any time, in any lane, never a violation.
  Measuring is not verifying: it runs no lint, no types, no tests.
- **Commit** - the pre-commit hook owns it: staged autofix, the TDD sibling gate, then the repo-wide cheap
  checks. Nothing to run by hand; on refusal the hook prints the remedy.
- **Push** - the pre-push hook runs the gate ONCE, never shortened by what the diff touched. Where the
  repo has heavy stages (build, size, e2e), the push script is phase-aware: phase 0 (scaffold, before the
  first deploy) runs the offline checks and loudly SKIPS the heavy stages; phase 1 (from the first deploy)
  runs the full `verify:ci`. A skipped stage is printed, never silent; flip the phase in one commit at the
  first deploy. A repo whose gate has no heavy stage runs the full `verify:ci` at push and records in
  `gate-tiers.json` that a phase switch would gate nothing.
- **CI** - phase-blind: always the full `verify:ci` (`audit:gate` + `verify`), plus what only CI can do
  (the security workflow, the scheduled mutation job, a mandatory dev-smoke job where the repo has one).

**Prohibitions, stated as such.** An implementer or a reviewer NEVER runs `verify`, `verify:ci`,
the fuller `verify:*` variants, `build` or the e2e suite by hand: the full chain belongs to the push hook and CI, and a
result an agent cannot act on is not worth its minutes. A review round gets the diff plus `verify:iter`;
acceptance does not re-run the gate, the push does. Parallel lanes never run heavy stages (one machine,
shared caches): heavy work serialises at the push. Individual scripts (`typecheck`, `lint`, `test`, `fix`)
are drill-downs on a specific failure; none of them is a moment.

**What earns a browser test.** The browser suite is counted in INVARIANTS, not in screens. A new route
or a new component earns a browser test only when it brings an invariant the existing specs do not
already measure: a different layout shell, an engine-dependent behaviour, the first instance of a flow
class. Everything else is a unit test against a mocked network, which runs in the iterate moment and
costs the push nothing. `gate-tiers.json` declares the suite's ceiling and `docs:check` reports a suite
that outgrew it, so that number moves on a measurement and a `DECISIONS.md` line, never on habit.

**`verify` is a strict superset of the offline checks CI runs**, so a green `verify` predicts a green CI.
Keeping that true is a rule: a new check goes into the script, never only into the workflow file.
`audit:gate` sits in `verify:ci` rather than `verify` because it needs the network, so an offline agent can
still run the whole offline gate. `bench:verify` derives its step list from the `verify` script; a
hand-written second list has already drifted once.

**Every gate run is traced** to `.gate-trace.log`; `trace:report` turns the log into findings (forbidden
moments, blown budgets, gate runs from a worktree). After a push, gate output in the terminal is part of
the contract: **silence is a failure, not a pass** - a push that printed no gate ran no gate, whatever the
exit code says.

**Ports.** A busy port means MOVE, never kill a server you did not start; the single-spec and measure
scripts take the next free port. Only the push gate clears its own port.

### Lanes - who runs what

- **Main agent, inline.** Iterate and measure while working; the push runs the chain. Never the full gate
  by hand.
- **Implementer subagent.** Works in a hand-made `git worktree` OUTSIDE the repo directory, on its own
  port, with `node_modules` symlinked from the main checkout. Iterate and measure only; the gate never
  runs from a worktree (the tracer records it as a finding). The lead removes the worktree, checks the
  branch out in the main checkout and pushes from there, so the gate runs once, at the push, for every
  writer.
- **Copilot coding agent.** Hand-over is a fully specified issue (goal as behaviour, paths in scope,
  acceptance, out of scope; use `.github/ISSUE_TEMPLATE/agent-task.yml` where the repo ships it), assigned
  to Copilot. It works on its own branch and opens a draft pull request; workflows on that PR start only
  after a human approves the run. Task class: verifiable by the gate, under ~400 changed lines, contract
  stated in the issue, nothing on the mandatory-human-review list. Its review context is
  `.github/copilot-instructions.md`, which points here for the gate.
- **Review, any lane.** The diff plus `verify:iter`, never a re-run of the gate. Findings are correctness,
  test strength, security, readability; style belongs to the linters. A non-author human approves; an
  agent's own green is not an approval.
- **Two tools, one file.** Claude Code reads `CLAUDE.md` -> `AGENTS.md` -> the brain files this guide
  points at (read on demand; nothing beyond `AGENTS.md` is `@`-imported); Cursor reads `AGENTS.md` plus
  every `alwaysApply: true` rule; Copilot reads `.github/copilot-instructions.md`. `AGENTS.md` is the only
  file all of them read, which is why the law lives here and everything else is a pointer.

### Before code - spec and plan

A task bigger than a one-sentence diff gets two tracked files under `.cursor/<feature-slug>/` before the
first edit: `SPEC.md` (WHAT and WHY: evidence per claim with its source kind, acceptance criteria as
Given / When / Then, open questions with `blocking` and `evidence tried` - an unknown is parked there,
never invented) and `PLAN.md` (HOW: changes per file with the code that was read, what is reused,
sequencing in 2-7 slices each under ~400 changed lines, a test per acceptance criterion, risks, danger
zones). Copy both from `.cursor/templates/`. Approval is a non-author review of the pull request that
adds or changes them, never a phrase in a chat recorded by an agent. `/feat` starts from the plan; a plan
that lives only in a conversation is not a plan.

<!-- shared-harness:end -->

`verify:full` is the rung to run before a PR that touched a shared UI primitive, the layout shell or
`src/index.css`. It is not inside `verify` because it needs a second server on its own port; CI runs it as
a mandatory `dev-smoke` job instead, so it cannot be forgotten.

`ci:local` is an alias of `verify:ci`, kept for muscle memory across templates.

**Pre-commit is repo-scoped, not staged-scoped.** `lint-staged` fixes and re-stages what you are
committing, but for a partially staged file it restores the unstaged hunks _after_ fixing — so
formatting drift used to survive a commit and only fail at push, leaving "already fixed but never
committed" files in the tree. The hook now also runs `lint:oxlint`, `format:check` and `typecheck` over
the whole repo and refuses the commit, naming the remedy: `npm run fix && git add -u`.

**Bootstrap after clone**: `npm run prepare` (once) — `.npmrc` disables lifecycle
scripts as a supply-chain guard, so husky hooks don't install themselves; the
verify gate fails loudly if hooks are missing. Dependency cooldown is also on
(`.npmrc` `min-release-age=3`, DAYS): a brand-new package or urgent patch needs
`npm install <pkg> --min-release-age=0`.

The gate is **zero-warnings**: `eslint --max-warnings 0`, `oxlint --deny-warnings`. If it fails, fix the cause — do **not** downgrade rules, silence warnings, or sprinkle `eslint-disable`. If a rule is genuinely wrong for a class of files, add a documented file-scoped override in `eslint.config.js` stating why (see the shadcn/ui and `*.queries.ts` overrides for the pattern).

**Complexity ratchet** — `complexity` 10 / `max-depth` 3 / `max-params` 4 / `max-lines-per-function` 120 / `max-lines` 200 over `src/**`, tests exempt. Thresholds sit above the measured ceiling (see `DECISIONS.md`), so a hit means new drift: split the function first; raising a number needs a fresh measurement and a `DECISIONS.md` line.

**Mutation testing** — `npm run test:mutation` (StrykerJS, weekly `mutation.yml` CI job). Coverage proves code RUNS under tests; the mutation score proves tests would CATCH a wrong implementation — the two disagree here by design (73% coverage vs a 41.95 score after the Stryker 10 bump, 2026-09). `thresholds.break` in `stryker.config.json` is a measured floor-of-record: raise it after a good run, never lower it to go green.

## Version holds (do not "fix" by bumping)

- **ESLint is 10.x** — the 9.x hold was lifted ahead of the 2026-08-06 end of life. Three plugins still cap their `eslint` peer below 10 (`eslint-plugin-react` at `^9.7`, `eslint-plugin-jsx-a11y` at `^9`, and `eslint-plugin-import` transitively), so each has an `overrides` entry mapping that peer to `$eslint`. Do not remove them, and do not reach for `--legacy-peer-deps`. **`settings.react.version` must stay a literal, never `'detect'`** — see `DECISIONS.md`.
- **TypeScript stays `~6.0.x`** — `typescript-eslint` peer is `<6.1.0`. TS 7 exists; do not bump until the peer widens.
- **`oxlint` tilde-tracks `eslint-plugin-oxlint`** — lockstep releases; the plugin pins `~<its version>`.
- **`@types/node` stays 24.x** — types match `engines.node >= 24`, not the newest Node.

## Machine-agnostic configs

Committed configs must never contain absolute local paths. The VS Code i18next extension rewrites `i18next.i18nPaths` with absolute paths when it can't resolve the configured ones — keep them relative and existing.

**Nor a DURATION measured on one machine.** A committed number of seconds is the same mistake in a different costume: it describes the hardware that measured it, and a fork on slower hardware inherits a ceiling it may be unable to meet. Measured spread between this workstation and a two-core CI runner, same two suites: 5.6x and 10.5x. So the push budget in `scripts/gate-tiers.json` holds a RATIO and a sample size, never seconds; the gate calibrates its own baseline from its own first runs into the gitignored `.gate-budget.json`, ratchets it down when the gate gets faster, and reports drift. A clone starts with no baseline, no red reading, and no number belonging to someone else.

## Out of scope (ask before touching)

- Weakening the verify gate, lint severities, or coverage thresholds to get green.
- Removing template scaffolding listed in `.cursor/brain/TEMPLATE_SEEDS.md`.
- Node engine bump (`engines.node`).

## Changes reach master through a pull request

Branch, run the gate, push the branch, open a PR, merge when CI is green.

In THIS repository that is not only a habit: `master` carries a ruleset requiring the `validate` check, and a direct push bypasses it, because the owner role always may. A rule bypassed on every change is worse than no rule — it reads as protection to the next person and to every agent, and protects nothing.

**In YOUR fork the habit is all there is, until you set the rest up.** Rulesets, branch protection and required checks are repository SETTINGS, and settings do not travel with a fork — only files do. So a fork arrives with the whole gate and none of the enforcement: the hooks still run locally, CI still runs on pull requests, and nothing at all stops a push straight to your default branch. `README.md` § "What your fork does not inherit" lists what to switch on and in what order.

## Commit format

`type(scope): description` — max 96 chars.
Types: `feat` `fix` `chore` `docs` `style` `refactor` `perf` `test` `revert` `build` `ci`

## Maintaining this file

Treat it like code. Add a rule when an agent or developer makes the same mistake twice — one line tied to the observed failure. Prune stale lines; a bloated file reduces compliance. One-line digests only — depth lives in `.cursor/brain/`.
