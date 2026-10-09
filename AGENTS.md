# react-enterprise-foundation — agent guide

Production-ready React 19 SPA template. Stack and versions: the table in `.cursor/brain/PROJECT_CONTEXT.md`.

## Start here

1. Read `.cursor/brain/PROJECT_CONTEXT.md`, then `READING_INDEX.md` beside it: it maps a situation to the two or three files that answer it. Also there: `MAP.md` (architecture), `SKELETONS.md` (danger zones), `VERIFICATION.md` (what to run per change), `TEMPLATE_SEEDS.md` (seeds, NOT dead code), `EXTENSIONS.md` (backend, auth, monitoring, analytics, flags, languages, hosting).
2. `.cursor/rules/*.mdc` are **binding for the files they cover**: read the ones for the area you touch before the first edit (`global.mdc` § 0.1 lists which).
3. Before sweeping the source, confirm the work is still needed (`git log --oneline -15` plus one grep) and LOOK instead of inferring (`npm run probe`). Name the files when you dispatch work to another agent.

## Source of truth

- **This file is canonical for every tool** (Claude Code loads it through the import in `CLAUDE.md`). Edit THIS file; never grow the shim.
- **Code is ground truth; this file is a verifiable pointer.** A line that conflicts with the code is stale: follow the code, fix or flag the line in the same session.
- **One canonical place per fact:** versions → `package.json`, commands → the table below, holds → `scripts/version-holds.json`, size budgets → `.size-limit.json`, why → `.cursor/brain/DECISIONS.md`. Everything else points.

## Critical rules

- **Tailwind v4**: no `tailwind.config.ts`; theme in `src/index.css` (`@theme inline {}`), dark mode via `.dark`.
- **Components**: logic in `useComponentName.ts` beside the component; explicit in/out (`const X: FunctionComponent<Props> = () => …` or an explicit return type); interface callbacks in property style. ESLint enforces both.
- **Pages** are lazy (`PageName.tsx` + `index.ts` with `lazy()`) under `WithSuspense`. **Stores**: Zustand with `createSelectors` in `src/store/<domain>/`, tests alongside.
- **i18n**: every user-visible string goes through `t()`. **Imports**: `@/` alias only, never `../../`.
- **Reuse first**: search for an existing function, util, component or constant before creating one; match the surrounding file.
- **Content variance**: UI that renders authored copy is proven against content it has NOT seen (`minimal` / `typical` / `long` / `unbroken` text, `none` / `one` / `many` collections) on `/dev/ui/content-stress` (`e2e/dev/content-stress.spec.ts`; widths in `DECISIONS.md`); assembled pages by `e2e/layout-geometry.spec.ts`. Add a case with every content-bearing component. A wrap class with no red-to-green proof is deleted.
- **Rendering differences are measured, not predicted**: `CROSS_BROWSER=1` adds Firefox and WebKit to the geometry specs.

## Commands / the gate

Five agent commands in `.claude/commands/` (`/onboard` `/feat` `/test` `/review` `/docs`), each mirrored by a thin shim in `.cursor/commands/`: edit the `.claude/` file, never the shim. The tier law is the shared block below; this table is the repo's command list.

```bash
npm run dev                # Vite dev server
npm run fix                # oxlint --fix → eslint --fix → prettier --write: the one remedy command
npm test                   # vitest run (the gate runs test:coverage)
npm run verify:iter        # iterate: oxlint → tsc → vitest --changed (seconds; per change)
npm run verify:measure     # MEASURE: build + look; `-- e2e/<f>.spec.ts` for one preview-mode spec
npm run e2e:one -- <spec>  # one Playwright spec, free port, through the tracer
npm run test:one -- <file> # one unit test file, through the tracer
npm run probe -- <route> [widths] # LOOK: render, screenshot per width, print measured quantities
npm run verify:push        # what pre-push runs; phase-aware (gate-tiers.json)
npm run verify             # THE gate: hooks → version holds → preflight → oxlint → format → typecheck → eslint
                           # → coverage → build → web-vitals chunks → size-limit → playwright browsers → e2e
npm run verify:ci          # verify + audit:gate, the CI chain (alias: ci:local)
npm run verify:full        # verify:ci + smoke:dev; before a PR touching a shared UI primitive, the shell or index.css
npm run smoke:dev          # the content-stress fixture alone, against `vite dev`
npm run test:e2e:prod      # Playwright against `vite preview` (same mode as the gate)
npm run bench:verify       # the gate step by step with timings
npm run trace:report       # findings from .gate-trace.log
npm run docs:check         # docs drift (paths, scripts, versions, command table, dead docs); weekly CI adds --weekly
npm run test:mutation      # StrykerJS strength gate: weekly mutation.yml, NOT in verify
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

**A red push costs one fix, not another round of the whole gate.** Where the repo has a browser suite, it
stops after a capped number of failures on the gate run and in CI (`maxFailures`) instead of running every
remaining test into its timeouts. After a red push, whoever pushes fixes the cause, rebuilds only when the
failing stage runs against a build, re-runs only the tests that failed until they pass, then pushes again;
the push still runs the whole gate and reaches whatever the cap stopped short of. Name the failed spec files
from the red output: Playwright's `--last-failed` also re-runs every test a capped run never reached, which
is most of the suite, so it fits only a red that finished under the cap (Jest's `--onlyFailures` has no such
catch). That re-run is a drill-down on a known failure, so it is the one sanctioned hand-run of a build or of
browser tests, and it never replaces the push. Each browser config writes to its own output folder, so the
last-failed record always belongs to the suite that failed.

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
- **What an agent may not do.** `.claude/settings.json` holds the agent-side limits; they bind Claude Code
  only (Cursor, Copilot and Codex do not read that file). Denied in every permission mode, bypass
  included: reading .env files other than the example, editing `.claude/settings.json` itself, a force
  push (a `+branch` refspec too), `--no-verify` or `-n` on a commit, `--no-verify` on a push,
  `git reset --hard`, `git clean -f`. Asked before every edit of the gate files, the documented edits
  included (the phase flip, a raised mutation threshold): `.husky/`, `.github/workflows/`,
  `.github/ruleset.json`, `scripts/gate-tiers.json`, `stryker.config.json`, `.npmrc`. A rule matches the
  command or path as an agent usually writes it and is not a security boundary: `sh -c`, a full binary
  path, a `git -C` or `git -c` prefix, a bundled flag such as `-uf`, or a command that reads a file
  without naming it (`grep -r`) walks past it. The boundary is the required CI check on the default
  branch. To change a guarded file, edit it yourself or change the rule in a reviewed commit.

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

## Working agreements

- **Bootstrap after clone**: `npm run prepare` once (`.npmrc` disables lifecycle scripts, so husky does not self-install; `verify` fails loudly without hooks). `.npmrc` `min-release-age=3` (days): a brand-new package or an urgent patch needs `npm install <pkg> --min-release-age=0`.
- **Zero warnings** (`eslint --max-warnings 0`, `oxlint --deny-warnings`): fix the cause, never downgrade a rule or sprinkle `eslint-disable`. A directive that must stay names its rule and carries its reason (`-- why`). A rule wrong for a class of files gets a documented file-scoped override in `eslint.config.js`.
- **Complexity ratchet**: `complexity` 10 / `max-depth` 3 / `max-params` 4 / `max-lines-per-function` 120 / `max-lines` 200 over `src/**`, tests exempt. A hit means new drift: split the function. Raising a number needs a fresh measurement (`DECISIONS.md`).
- **Mutation score** shows whether tests would CATCH a wrong implementation; coverage only shows they RUN it. `thresholds.break` in `stryker.config.json` is a measured floor: raise it after a good run, never lower it to go green.
- **Machine-agnostic configs**: no absolute local paths (the VS Code i18next extension rewrites `i18next.i18nPaths`: keep them relative), and no DURATION measured on one machine. `gate-tiers.json` holds a ratio and a sample size; the gate calibrates its own baseline into the gitignored `.gate-budget.json`.

## Version holds (do not "fix" by bumping)

`scripts/version-holds.json` is the list (range, reason, lift condition, evidence). `scripts/check-version-holds.mjs`, inside `verify`, fails a manifest or lockfile outside a range and a missing Dependabot `ignore`. Why: `DECISIONS.md`.

- **`vitest` + `@vitest/coverage-v8` stay 4.x** (vitest 5 collapses the Stryker gate). **`msw` stays 2.x**: no `overrides` entry to paper over msw 3.
- **TypeScript stays `~6.0.x`** (typescript-eslint peer). **`@types/node` stays 24.x** (matches `engines.node`).
- **ESLint + `@eslint/js` stay 10.x**: keep the `$eslint` `overrides` for `eslint-plugin-react` and `eslint-plugin-jsx-a11y`, never `--legacy-peer-deps`; `settings.react.version` stays a literal, never `'detect'`.
- **`oxlint` tilde-tracks `eslint-plugin-oxlint`** (lockstep releases).

## Out of scope (ask before touching)

Weakening the verify gate, lint severities or coverage thresholds to get green · removing scaffolding listed in `.cursor/brain/TEMPLATE_SEEDS.md` · a Node engine bump (`engines.node`).

## Changes reach master through a pull request

Branch, run the gate, push the branch, open a PR, merge when CI is green. Here `master` has a ruleset requiring the `validate` check, and the owner role can bypass it with a direct push: don't. **A fork inherits files, not settings:** it arrives with the whole gate and none of the enforcement until you switch it on (`README.md` § "What your fork does not inherit").

**Commit format**: `type(scope): description`, max 96 chars. Types: `feat` `fix` `chore` `docs` `style` `refactor` `perf` `test` `revert` `build` `ci`.

## Maintaining this file

Keep it under 200 lines. Add a rule when an agent or developer makes the same mistake twice: one line tied to the observed failure. Prune stale lines; a bloated file reduces compliance. Depth lives in `.cursor/brain/`.
