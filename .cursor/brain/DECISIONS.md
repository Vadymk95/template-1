# Architectural Decisions

History lives in `git log -p -- .cursor/brain/DECISIONS.md` and the linked PRs. This file holds only
decisions that are true today: an entry that stops being true is edited or deleted, never kept as a
log. Each entry is at most 30 lines and ends with an evidence link. A fork starts its own file and
points here (README § fork checklist).

| Entry                                                              | Date    | Status         |
| ------------------------------------------------------------------ | ------- | -------------- |
| vitest 5 and the Stryker runner                                    | 2026-10 | held           |
| `msw` stays 2.x                                                    | 2026-10 | held           |
| TypeScript 6.0.x, held below 6.1                                   | 2026-04 | held           |
| ESLint 10 and `settings.react.version`                             | 2026-07 | in force, held |
| Advisories close with capped override floors                       | 2026-10 | in force       |
| The gate is `verify`; `verify` is a superset of CI                 | 2026-07 | in force       |
| Guard audit: what each new guard watches                           | 2026-10 | in force       |
| zizmor audits the workflow files                                   | 2026-10 | in force       |
| Every GitHub Action is SHA-pinned; workflow tokens start read-only | 2026-10 | in force       |
| A test that passes only on retry fails the CI run                  | 2026-10 | in force       |
| Playwright `maxFailures: 10` on the gate run and in CI             | 2026-10 | in force       |
| axe-core scans the rendered pages inside the existing specs        | 2026-10 | in force       |
| Agent limits in a committed `.claude/settings.json`                | 2026-09 | in force       |
| Gate hygiene: fail-open shapes closed                              | 2026-08 | in force       |
| Cross-engine coverage is opt-in and scoped                         | 2026-08 | in force       |
| Complexity ratchet                                                 | 2026-08 | in force       |
| Mutation testing: weekly strength gate, outside `verify`           | 2026-08 | in force       |
| Content variance is measured in a browser, not asserted in jsdom   | 2026-08 | in force       |
| The 44px touch floor is a ratchet                                  | 2026-08 | in force       |
| `outline-hidden`, never `outline-none`                             | 2026-08 | in force       |
| Tailwind class hygiene                                             | 2026-08 | in force       |
| Magic strings → constants (Zustand keys + devtools labels)         | 2026-05 | in force       |
| Boundary validation via Zod safeFetch wrapper                      | 2026-05 | in force       |
| size-limit brotli budgets                                          | 2026-05 | in force       |
| REJECT list: explicit non-adoption                                 | 2026-05 | rejected       |
| MSW browser worker and its dev opt-out                             | 2026-04 | in force       |
| i18n init failure falls back to English-only                       | 2026-04 | in force       |
| Web Vitals chunk split is checked after the build                  | 2026-04 | in force       |
| `eslint-import-resolver-typescript` reads one solution `tsconfig`  | 2026-04 | in force       |
| Component pattern: arrow function plus `FunctionComponent`         | 2026-04 | in force       |
| Build stack: Tailwind v4, Vite 8 with Rolldown, `plugin-react` v6  | 2026-03 | in force       |
| No FSD; Zustand for client state, TanStack Query for server state  | 2026-03 | in force       |

## [2026-10] vitest 5 and the Stryker runner

**Status:** held. The range, reason and lift live in `scripts/version-holds.json`; Dependabot
ignores `vitest` and `@vitest/coverage-v8` `>=5`.

**Context:** the weekly `mutation.yml` job (cold: fresh checkout, no incremental cache) went red
three weeks running. Under vitest 5 with `@stryker-mutator/vitest-runner` 10.0.0 the full gate
scored 9.59 against `thresholds.break: 40`; held at 4.1.11 on the same tree it scored 43.49. Unit
tests and coverage pass under both, so the fault is the runner pairing, not test coverage.

**Decision:** hold `vitest` and `@vitest/coverage-v8` at `>=4.1.11 <5` together.

**Lift:** a `@stryker-mutator/vitest-runner` release newer than 10.0.0 (published 2026-08-14) that
passes the one-file probe. Delete `reports/` and `.stryker-tmp/`, then run
`npx stryker run --mutate src/lib/api/safeFetch.ts` under vitest 5. It must score near its 4.1.11
baseline (88.24 against 5.88 on 5.0.3 when measured 2026-10-07), not near zero. Lift in the same
commit that drops the Dependabot ignore and the `version-holds.json` entries.

**Trap:** `stryker.config.json` sets `incremental: true`, so a local A/B that keeps
`reports/stryker-incremental.json` replays cached results and reports the same score for both
versions (an early run read 38.48 for both). CI never has that file, so always delete `reports/` and
`.stryker-tmp/` before comparing.

**Evidence:** https://github.com/Vadymk95/template-1/commit/e332981b4941ee4a851b57dc01a0af558d293881

## [2026-10] `msw` stays 2.x

**Status:** held (`scripts/version-holds.json`; Dependabot ignores `msw` `>=3`).

**Context:** `@vitest/mocker` (4.1.11 and 5.0.3) peers `msw ^2.4.9`, and its browser entry imports
`msw/core/http`, an export `msw` 3 removed. npm accepts `msw` 3 only through an override of the
mocker's peer, which would hide a real break in vitest browser mode.

**Decision:** stay on `msw` `^2.15.0` and add no override.

**Lift:** a vitest release whose `@vitest/mocker` peer admits `msw` 3. The migration then needs:
handlers imported from `msw/http`; `onUnhandledRequest` renamed `onUnhandledFrame`;
`public/mockServiceWorker.js` regenerated with `npx msw init public/ --no-save`; and the MSW server
paused in the two tests that probe real sockets (`scripts/run-on-free-port.test.mjs`,
`scripts/check-gate-env.test.mjs`), because `msw` 3 intercepts raw `net.connect` and reports every
port as taken.

**Evidence:** https://github.com/Vadymk95/template-1/pull/95

## [2026-04] TypeScript 6.0.x, held below 6.1

**Status:** held (`scripts/version-holds.json`; Dependabot ignores `typescript` `>=6.1`).

**Context:** `typescript-eslint` 8 peers `typescript >=4.8.4 <6.1.0`, so a bump to 6.1 or 7 fails
both `npm install` and `npm ci` with ERESOLVE and the whole tree stops resolving. TypeScript 6
deprecated `baseUrl`; it was removed from `tsconfig.json` and `tsconfig.app.json` because `paths`
works without it.

**Decision:** stay on `~6.0.x`.

**Lift:** a `typescript-eslint` release whose `typescript` peer admits the next minor or major.

**Evidence:** https://github.com/Vadymk95/template-1/commit/937333a

## [2026-07] ESLint 10 and `settings.react.version`

**Status:** in force; `eslint` and `@eslint/js` held to 10.x (`scripts/version-holds.json`;
Dependabot ignores `>=11`).

**Context:** `eslint-plugin-react` peers `eslint` up to `^9.7` and `eslint-plugin-jsx-a11y` up to
`^9`, so each gets a `package.json` `overrides` entry mapping its `eslint` peer to `$eslint`. The
9.x line reached end of life on 2026-08-06.

**Decision:** run ESLint 10 with those two overrides. Do not use `--legacy-peer-deps`: a blanket
flag is not a posture for a repo with a hardened `.npmrc`. Do not remove an override until the
plugin's own peer admits the installed `eslint`.

**Rule:** `settings.react.version` is a literal that matches the `react` major.minor in
`package.json`, never `'detect'`. `eslint-plugin-react` resolves `'detect'` through
`context.getFilename()`, which ESLint 10 removed, so every rule needing the version throws at load.
A trailing config object with no `files` key repeats the literal so no shared config can reintroduce
`'detect'`.

**Lift (the eslint hold):** the plugins (and `typescript-eslint`) declare an `eslint` peer that
includes 11 without the override.

**Evidence:** https://github.com/Vadymk95/template-1/commit/fb36cde

## [2026-10] Advisories close with capped override floors

**Status:** in force. Floors live in `package.json` `overrides`; exceptions in
`scripts/audit-allowlist.json`.

**Decision:**

- A high or critical advisory is closed by a root `overrides` floor with a major cap,
  `">=fixed <next-major"`. An uncapped floor ages into the next vulnerable range and becomes the
  reason the gate is red (`brace-expansion >=5.0.8` and `fast-uri >=3.1.4` both did).
- When a later advisory lands on a floored package, raise that floor in place (`brace-expansion`
  went `5.0.9` to `5.0.12` for three advisories); do not add a second line.
- An allowance in `audit-allowlist.json` (advisory id, reason, expiry) is the last resort. Read the
  advisory's fixed range directly instead of trusting `npm audit`'s `fixAvailable`: it proposed a
  semver-major downgrade of `eslint-plugin-react` for an advisory that a transitive override closed.
- Adding the override and removing the allowance are one commit: once the override lands the
  advisory disappears, the allowance goes stale, and a stale allowance fails the gate by design.

**Consequences:** `audit:gate` (in `verify:ci`) fails on any high or critical advisory, an expired
or stale allowance, and its own inability to complete; lowering `--audit-level` is not available.
`scripts/audit-gate.test.mjs` covers the fail-closed paths. The Stryker runner's dependency tree is
inside the gate. Open and below the threshold: two moderate `qs` advisories on the dev-only chain
`@stryker-mutator/core` 10.0.0 to `typed-rest-client` 2.3.1; they close with a Stryker release that
moves `typed-rest-client` to 3.1.1 or later.

**Evidence:** https://github.com/Vadymk95/template-1/commit/07e5fff and
https://github.com/Vadymk95/template-1/commit/8b982b1

## [2026-07] The gate is `verify`; `verify` is a superset of CI

**Status:** in force. The tier law is `AGENTS.md` § Commands / the gate; the phase table is
`scripts/gate-tiers.json`.

**Context:** CI once listed its own steps. Two checks (`npm audit`, `verify:web-vitals-chunks`) were
absent from `verify`, and `size:check` ran in no pipeline at all, so a green local gate did not
predict a green CI.

**Decision:** every check lives in `package.json`, never only in a workflow file. `verify` holds the
offline checks; `verify:ci` is `audit:gate && lock:age && verify` and is the only thing CI runs besides what CI
alone can do (install, browser cache, artifact upload). `audit:gate` and `lock:age` stay out of `verify` because
they need the network. `.husky/pre-push` runs the phase-aware `verify:push`.

**Consequences:** `verify` is slower and can go red on a dependency bump rather than on your own
code; that is the cost of a gate that does not lie. If a check becomes intolerable it leaves BOTH
the script and CI, so the superset survives. If `verify` crosses roughly five minutes locally, move
e2e into its own CI job and out of the pre-push hook together with the workflow, never one alone.
`docs:check` (`ciSteps`) fails a PR-triggered workflow step that bypasses the gate.

**Pre-commit is repo-scoped.** `lint-staged` restores a partially staged file's unstaged hunks after
fixing, so formatting drift survived the commit and failed at push. The hook therefore also runs
`lint:oxlint`, `format:check` and `typecheck` over the whole repo and names the remedy
(`npm run fix && git add -u`). ESLint stays on pre-push (type-aware, slow). A hook that commits for
you is not adopted: it sweeps whatever else is dirty into the commit.

**Evidence:** https://github.com/Vadymk95/template-1/commit/fb36cde

## [2026-10] Guard audit: what each new guard watches

**Status:** in force. An audit sabotaged 73 guards and 53 caught the injected defect; these close
the holes that reproduced and sit on a path a fork or a real incident would hit.

- **CI step bypass (`docs:check` `ciSteps`).** Every `run:` step in a PR-triggered workflow,
  including each line of a `run: |` block, must appear in `gate-tiers.json` `ci.allowedRunSteps`, or
  it moves into `verify`. A multi-line step is the common way to hide one.
- **Ruleset context with no producer (`docs:check` `rulesetContexts`).** Each
  `required_status_checks` context in `.github/ruleset.json` must be produced by a workflow job
  (`name:` or id, plus matrix values). A context GitHub renders only at runtime prints one
  non-failing line. A renamed job otherwise leaves every PR Pending forever.
- **Total-JS budget (`.size-limit.json`).** A `dist/assets/*.js` total entry catches a dynamically
  imported chunk under an unbudgeted name; dropping the `import.meta.env.DEV` gate on MSW in
  `main.tsx` turns it red.
- **Tests that pin a wiring:** `scrollbar-gutter: stable` inside `e2e/layout-geometry.spec.ts`; the
  `App` error boundary in `src/App.test.tsx`; the `safeFetch` contract in
  `src/lib/api/safeFetch.test.ts`.
- **`no-empty`** is an ESLint error with `allowEmptyCatch: false`, so a `catch {}` fails lint.
- **Pre-commit `docs:check` trigger.** The `grep -qE` in `.husky/pre-commit` also matches
  `scripts/docs-check.*` and `package.json`, so a broken checker or a renamed npm script cannot
  commit clean.

**Evidence:** https://github.com/Vadymk95/template-1/commit/cb92490 and
https://github.com/Vadymk95/template-1/commit/ce22788

## [2026-10] zizmor audits the workflow files

**Status:** in force. The `zizmor` job in `security.yml` ("Workflow audit (zizmor)") runs on every
pull request, every push to the default branch and the weekly cron, and fails at Medium severity or
above.

**Decision:** one step, `zizmorcore/zizmor-action` (SHA-pinned like every action) with
`version: 1.30.1`, `inputs: .github/workflows` and `config: .github/zizmor.yml`. `version` is the
zizmor pin; Dependabot moves the action's SHA, and a newer zizmor is a deliberate edit of `version`.

**Why the remap:** the action audits online by default, and online zizmor grades a checkout that
leaves its token in `.git` (`artipacked`) one level lower than offline, so the Medium gate let it
through. `rules.artipacked.remap.severity: medium` in `.github/zizmor.yml` makes the job and the
local command (`uvx zizmor@1.30.1 .github/workflows`) give one verdict with no second offline pass.

**Consequences:** every checkout that never pushes sets `persist-credentials: false`. The only
exception is `adhoc-packages` for the `npm install -g npm@^11.14.0` steps in `ci.yml`, one rule and
one whole file with the reason written in `zizmor.yml`; there is no blanket ignore. The job's
context is in `required_status_checks` in `.github/ruleset.json` (`docs:check` verifies a job
produces it), so an unpinned action or a credential-persisting checkout cannot merge. The ruleset
file changes the live ruleset only when the owner re-posts it (README § "What your fork does not
inherit").

**Evidence:** https://github.com/Vadymk95/template-1/commit/dd6c487

## [2026-10] Every GitHub Action is SHA-pinned; workflow tokens start read-only

**Status:** in force; zizmor reports an unpinned action (see the previous entry).

**Decision:** every `uses:` in `.github/workflows/*.yml` is a full 40-hex commit SHA with the
version as a trailing comment (`uses: actions/checkout@<sha> # v7.0.1`). A new action is added
pinned the same way, never as `@vN`. `.github/dependabot.yml` keeps its `github-actions` ecosystem,
which updates a SHA and its version comment together. `release.yml` and `security.yml` declare
`permissions: contents: read` at the workflow level and give each job its own write scopes, so a job
added later starts read-only.

**Why:** a floating `@vN` tag stays movable unless the publisher opted in to immutable releases (at
the time `actions/setup-node` had, `actions/checkout` and `release-please-action` had not), so
exempting the official actions protected nothing.

**Evidence:** https://github.com/Vadymk95/template-1/commit/717fce9

## [2026-10] A test that passes only on retry fails the CI run

**Status:** in force.

**Decision:** `failOnFlakyTests` is on whenever `CI` is set, in `playwright.config.ts` and
`playwright.dev.config.ts`. CI keeps `retries: 2`; local runs have none. By default a test that
fails then passes is reported as "1 flaky" and the run is green, so the flake is never fixed or
counted.

**Consequences:** a red caused by this is fixed, or quarantined with a date (`docs:check` tracks
quarantines). A retry count is never raised to make it pass.
`scripts/check-playwright-gate-config.test.mjs` pins both configs (retries and `failOnFlakyTests` on
in CI, both off on the desk run).

**Evidence:** https://github.com/Vadymk95/template-1/commit/dd6c487

## [2026-10] Playwright `maxFailures: 10` on the gate run and in CI

**Status:** in force.

**Decision:** `playwright.config.ts` caps `maxFailures` at 10 when `usePreview` is true (CI or
`PLAYWRIGHT_USE_PREVIEW=1`); the desk run against the dev server stays uncapped. Each config writes
to its own `outputDir` (`test-results/e2e`, `test-results/dev`) so `--last-failed` never reads the
other suite's record.

**Why:** in a product forked from this template, a red push ran up to 21 minutes against about 5 for
a green one, because every failing test waited out its own timeout. One measured break of a shared
invariant (630 tests, six workers): uncapped 7.5 min and 55 failures reported; capped at 10, 21 s;
capped at 5, 15 s with half the failing neighbours reported. 10 is the value that measurement
settled on.

**Evidence:** https://github.com/Vadymk95/template-1/commit/fd5c8ab

## [2026-10] axe-core scans the rendered pages inside the existing specs

**Status:** in force.

**Decision:** `e2e/support/a11y.ts` runs an axe-core scan (`@axe-core/playwright`) at the end of the
home, login and not-found specs, after each page's own heading is visible. A `serious` or `critical`
violation fails the spec and prints the rule id and selectors; `minor` and `moderate` stay advisory.
`target-size` (WCAG 2.2 SC 2.5.8) is switched on because axe ships it disabled. No `test()` was
added, so the browser suite did not grow.

**Why:** `eslint-plugin-jsx-a11y` reads JSX; it cannot see a missing accessible name, a contrast
failure or an undersized target that exists only in the rendered page. Proved in both directions: an
`<img>` without `alt` fails with `image-alt`, two 10 px buttons fail with `target-size`, and
removing the override makes the same buttons pass.

**Evidence:** https://github.com/Vadymk95/template-1/commit/dd6c487

## [2026-09] Agent limits in a committed `.claude/settings.json`

**Status:** in force. The rule text is `AGENTS.md` § Lanes.

**Decision:** `.claude/settings.json` is tracked. It denies, in every permission mode, reading
`.env` files other than the example, editing itself, force pushes, `--no-verify`, `git reset --hard`
and `git clean -f`, and it asks before edits of the gate files. Two public guides name a deny list
as the baseline of a professional agent setup; the earlier "wait until an agent is seen editing a
listed file" deferral was dropped.

**It is not a security boundary.** A Bash rule matches the command as written, so `sh -c`, a full
binary path or a `git -C` prefix walks past it, and Read/Edit denies cover the built-in file tools,
not a script that opens the file itself. `git push -f*`, `git push *+*` and `git commit -n*`
replaced space-anchored forms after a `+branch` refspec and a bundled `-fu` got through; `-uf` and a
trailing `-n` still do, and more wildcards would start catching commit messages. The boundary stays
the required CI check. Cursor and Codex do not read the file.

**Also decided that day:** one Dependabot group, `minor-and-patch`, carries every non-major update
(two groups both rewrote `package-lock.json` and conflicted); a major opens its own PR.
`release.yml` passes `secrets.RELEASE_PLEASE_TOKEN || github.token`; without the secret release PRs
wait in `action_required` for one approval, with a fine-grained PAT they get CI like any PR.

**Evidence:** https://github.com/Vadymk95/template-1/commit/96e3abb

## [2026-08] Gate hygiene: fail-open shapes closed

**Status:** in force. Each shape is a gate that reported success while checking less than it
claimed.

- **Coverage dropout.** An unparseable file in the coverage scope makes vitest print
  `Failed to parse <file>. Excluding it from coverage.` and exit 0, so the percentage describes a
  smaller set. `scripts/check-coverage.mjs` wraps the run and refuses on that marker (a marker, not
  a file-count baseline: a baseline in a template records an empty scaffold).
- **A second list of the gate's steps drifts narrower.** `bench:verify` derives its steps from the
  `verify` script and throws on a segment it cannot parse, so a step cannot silently leave the
  benchmark.
- **`npx` without `--no-install`** in `ensure-playwright.mjs` fetches the newest Playwright and
  installs browsers for a version this repo does not pin.
- **A tool's temp directory belongs in every ignore list the gate reads.** `.stryker-tmp` is in
  `.gitignore`, `.prettierignore` and ESLint's global ignores; a crashed Stryker run left a sandbox
  copy that reddened the next push with errors from inside the copy.
- **A test budget is set by what the test does.** The `verify-push` CLI cases boot node, npm, node,
  so the describe block carries a 20 s budget with the measurement next to it. A quarantine (`skip`)
  was rejected: the cases prove the dispatcher's phase routing and exit-code passthrough, which a
  silent pass would hide.

**Evidence:** https://github.com/Vadymk95/template-1/commit/8a394b5,
https://github.com/Vadymk95/template-1/commit/15f3752 and
https://github.com/Vadymk95/template-1/commit/6d72451

## [2026-08] Cross-engine coverage is opt-in and scoped

**Status:** in force.

**Decision:** `CROSS_BROWSER=1` adds Firefox and WebKit projects, `testMatch`-scoped to the geometry
specs. Not in the default run: three engines on every spec triple the local e2e time, and a WebKit
font-metric difference in an unrelated spec would fail a push for a reason unconnected to the
change.

**Why it exists:** Firefox reports `clientWidth: 0` for an inline `<label>` (CSSOM defines an inline
non-replaced element's client box as zero) while Chromium reports a box, so every label read as
overflow in one engine only. The defect was in the rule, which now exempts exactly `display: inline`
and is tested in both directions.

**Consequences:** a `testMatch` that matches nothing collects zero tests and reports success, so
`scripts/check-cross-browser-selection.mjs` asks Playwright whether every configured project has
work and fails closed on a report it cannot read. The Firefox test browser runs with
`browser.tabs.remote.useCrossOriginOpenerPolicy` off: `vite preview` sends
`Cross-Origin-Opener-Policy: same-origin`, after which Firefox swaps processes on a test's first
navigation and Playwright intermittently loses it (12 of 210 Firefox tests failed with COOP on, 0 of
210 on master). The header stays sent, Chromium and WebKit enforce it, and the smoke spec asserts
it.

**Evidence:** https://github.com/Vadymk95/template-1/commit/8a394b5

## [2026-08] Complexity ratchet

**Status:** in force. Rules and numbers: `eslint.config.js` (the block over `src/**/*.{ts,tsx}`);
summary in `AGENTS.md`.

**Decision:** five core rules gate production code only: `complexity` 10, `max-depth` 3,
`max-params` 4, `max-lines-per-function` 120, `max-lines` 200. The thresholds sit above the tree's
measured ceiling (complexity 9, depth 2, params 3, 89 lines per function, 142 per file on
2026-08-09), so the gate is clean on day one and fires only on drift.

**Consequences:** tests are exempt on purpose: a `describe` block is one function to these rules and
table-driven suites are long by design, and indexing the ratchet on test style killed this rule set
in a sibling repo. When a threshold fires, split the function; raising a number needs a fresh
measurement, recorded in the comment above the block. Probe:
`new ESLint({ overrideConfig: [{ rules: { complexity: ['warn', 0], ... } }] })`, take the max per
rule from the report messages.

**Evidence:** https://github.com/Vadymk95/template-1/commit/07e5fff

## [2026-08] Mutation testing: weekly strength gate, outside `verify`

**Status:** in force. The vitest pairing is held (first entry).

**Decision:** `npm run test:mutation` (StrykerJS with the vitest runner) measures whether the tests
would catch a wrong implementation, which coverage cannot. `thresholds.break: 40` in
`stryker.config.json` is a floor-of-record set from the first baseline (44.5% against a green
coverage gate): the weekly `mutation.yml` job fails only when strength regresses below it. Raise the
floor after a good run; never lower it to go green or fit a tool (Stryker 10 moved the same tree
from 44.43 to 41.95 and the floor stayed).

**Consequences:** not in `verify` or pre-push: a full run costs minutes and a per-push gate at that
price teaches `--no-verify`. Scope mirrors the coverage excludes. `.env*` stays out of the sandbox
copy through `ignorePatterns` (Stryker does not read `.gitignore`). Limits: the vitest runner
mutates what unit and RTL tests see, so a defect only Playwright would catch is invisible; and it
measures only the kill side, so an over-strict test that rejects a legitimate implementation stays
with review (see the near-miss tests in `control-targets.test.ts`). `jsdom` 30 requires Node
`^24.15.0` on the 24 line; a machine on an older 24.x fails `engine-strict` at install, which is the
intended signal.

**Evidence:** https://github.com/Vadymk95/template-1/commit/07e5fff and
https://github.com/Vadymk95/template-1/commit/bde48c9

## [2026-08] Content variance is measured in a browser, not asserted in jsdom

**Status:** in force. The rule: `AGENTS.md` § Critical rules › Content variance.

**Decision:** every content-bearing primitive is rendered once per content state on the dev-only
route `/dev/ui/content-stress` and measured by Playwright at 390 / 640 / 768 / 1024 / 1440. The
invariants are pure predicates in `e2e/support/geometry.ts`, shared by that spec and by
`e2e/layout-geometry.spec.ts` (which measures assembled pages): two consumers, one definition. jsdom
has no layout, so a unit test can pin a class string and nothing more; the first run found 172 px of
overflow from an unbroken 40-character token and 28 px of document scroll from the header on every
route at 390.

**Consequences:**

- The fixture is dev-only, so it is unreachable from the `vite preview` run inside `verify`; it runs
  in `verify:full` and the mandatory `dev-smoke` CI job. `playwright.config.ts` MUST keep `dev/**`
  in `testIgnore`, or the production project collects the dev spec, the route 404s and the coverage
  becomes an illusion that still passes.
- Counts are derived: the fixture publishes `data-stress-total` and `data-stress-components` and the
  spec compares what it found, never a literal `toHaveCount(32)`.
- States are `minimal` (one character, not empty) / `typical` / `long` / `unbroken` for text and
  `none` / `one` / `many` for collections. `unbroken` is the load-bearing one: a long sentence wraps
  on its spaces and hides a missing wrap guard. No RTL state, because no RTL locale ships here.

**Evidence:** https://github.com/Vadymk95/template-1/commit/8a394b5

## [2026-08] The 44px touch floor is a ratchet

**Status:** in force. Guard: `e2e/support/control-targets.ts` with `control-targets.test.ts`.

**Decision:** exactly two rendered sizes sit below the floor across every route and state: 40
(`Button`, from `h-10` and `size-10`) and 36 (`Input`, from `h-9`), both shadcn's default scale. The
guard accepts those two exact sizes with a stated reason and exit condition; every other size below
44 fails. Raising the kit to 44 would change the visual scale of every app scaffolded from here,
which is the consuming app's design call.

**Consequences:** keying on exact size is what keeps it a ratchet (a 38 px control matches nothing).
An acceptance list fails by wrongly accepting, which sabotage never shows, so the test is
near-misses: 37/38/39/41/42 refused, and an icon-only control refused at an accepted height but a
narrow width.

**Evidence:** https://github.com/Vadymk95/template-1/commit/8a394b5

## [2026-08] `outline-hidden`, never `outline-none`

**Status:** in force.

**Decision:** use `outline-hidden`. Compiled from the installed Tailwind: `.outline-hidden` emits
`outline-style: none` plus
`@media (forced-colors: active) { outline: 2px solid transparent; outline-offset: 2px }`;
`.outline-none` emits only the first. Every focusable control here pairs the reset with a `ring-*`
(a `box-shadow`), and forced-colors suppresses box-shadows, so with `outline-none` a Windows
high-contrast user has no focus indicator (WCAG 2.4.7).

**Consequences:** pinned three ways, because no single one is enough: class-string tests
(`focus-indicator.test.tsx`, `SkipLink.test.tsx`), the browser test that emulates the mode
(`e2e/forced-colors.spec.ts`), and `better-tailwindcss/no-deprecated-classes`. On every Tailwind
minor bump read the release notes for renamed utilities; the build emits no warning and only the
lint rule catches a rename that is already known.

**Evidence:** https://github.com/Vadymk95/template-1/commit/8a394b5

## [2026-08] Tailwind class hygiene

**Status:** in force.

**Decision:** `better-tailwindcss` rules `no-deprecated-classes` and `enforce-canonical-classes` are
enabled (2 genuine findings and 0 on adoption). `no-unknown-classes` is NOT enabled, despite scoring
zero: in a template its failure mode is a false positive on the first hand-written CSS class a
consumer adds, and this repo applies `i18n-loading` imperatively, outside any `className` the rule
can see. Zero findings today is not evidence it is safe for whatever gets scaffolded from here.

**Evidence:** https://github.com/Vadymk95/template-1/commit/8a394b5

## [2026-05] Magic strings → constants (Zustand keys + devtools labels)

**Status:** in force. Rule: `.cursor/rules/constants.mdc`.

**Decision:** extract a magic string used in 2+ places, or carrying an external contract, to a named
constant. Single-use strings stay inline (logger source tags, one-off event names, test selectors,
self-documenting `aria-label`s, i18n keys, constants that already live in their module's
`constants.ts`).

**Pattern:** `as const` objects, not `enum` (no runtime cost, tree-shakeable, structural typing,
`const enum` is known-broken in bundlers); type via `typeof OBJ[keyof typeof OBJ]`.
`src/store/keys.ts` holds `STORAGE_KEYS` (persisted keys are an external contract: renaming breaks
stored user data), `DEVTOOLS_NAMES` and per-store action constants such as `USER_STORE_ACTIONS`.
Keep per-store action objects separate; do not roll them into one mega-object.

**TanStack Query keys are deliberately not centralized.** `greetingKeys` / `exampleKeys` stay
colocated with their `queryOptions()` factories in `src/lib/api/<domain>.queries.ts`: one file owns
one feature's cache surface, deleting a feature deletes its keys, and there is no central import
hotspot (TkDodo, "Effective React Query Keys"). A central `queryKeys.ts` would be a regression here.

**Evidence:** https://github.com/Vadymk95/template-1/commit/43a08eb

## [2026-05] Boundary validation via Zod safeFetch wrapper

**Status:** in force. Reference example: `src/lib/api/greeting.queries.ts`; pattern is opt-in for
forks (copy and extend per endpoint).

**Decision:** validate API responses at the boundary with Zod through `src/lib/api/safeFetch.ts`:
`safeFetchQueryFn(url, schema)` for TanStack Query, `safeFetch(url, schema)` for direct calls,
`Schema.safeParse(JSON.parse(raw))` for localStorage and sessionStorage reads. It catches backend
shape drift at receive time instead of as "undefined, NaN, blank UI" in render, and `z.infer` gives
the types for free.

**Consequences:** no bundle cost (Zod is already a dependency for forms) and about 50 to 200
microseconds per parse. Schemas duplicate backend types, which is acceptable at solo or small-team
scale; at multi-team scale consider codegen (openapi-zod-client, @ts-rest). Skip it for tRPC or
GraphQL with codegen, throwaway prototypes and high-frequency polling. `safeFetchQueryFn` re-throws
`AbortError` unchanged so TanStack Query treats it as cancellation; `src/lib/devGuards.ts`
`installDevGuards()` prevents leaked `AbortError` unhandled rejections in dev. A 4xx throws an
`ApiError` carrying the status so the default retry skips it. Covered by
`src/lib/api/safeFetch.test.ts`.

**Evidence:** https://github.com/Vadymk95/template-1/commit/98abf4b

## [2026-05] size-limit brotli budgets

**Status:** in force. The numbers live in `.size-limit.json`; `npm run size:check` runs inside
`verify`.

**Decision:** `size-limit` with `@size-limit/file` budgets each vendor chunk (`react-vendor`,
`i18n-vendor`, `state-vendor`, `ui-vendor`), the `index` entry and the total JS, all brotli. Budgets
sit at the measured size plus roughly 10 to 20% headroom, in a standalone `.size-limit.json` rather
than a `package.json` key, to keep budget changes out of dependency-bump diffs.
`scripts/check-web-vitals-chunks.mjs` asserts chunk composition and `size-limit` asserts size; the
axes do not overlap. `vite-plugin-bundlesize` was rejected as a second, single-vendor gate.

**Consequences:** a budget moves once, with the cause named, never to fit drift: the `index` budget
went 25 to 27 KB after `zod` 4.5 to 4.6 alone grew the entry chunk by about 1.5 KB (bisected by
pinning each updated package back). The total entry exists because five named chunks let a
dynamically imported chunk under another name ship unseen. Recalibrate if a fork hits repeated false
positives from legitimate feature work.

**Evidence:** https://github.com/Vadymk95/template-1/commit/c016070

## [2026-05] REJECT list: explicit non-adoption

**Status:** rejected. Listed so agents and forks do not re-litigate; revisit only on the stated
condition.

| Item                                  | Why not                                                                                                                                                                            | Revisit only if                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| React Compiler                        | Reverses the Oxc-without-Babel choice (build-speed regression: Vite's own Vite 8 post warns Babel erases most Oxc gains) and open silent-bailout bugs facebook/react#35105, #35644 | Both bugs close, a named >100K-MAU Vite app publishes a "ruled out" retro and the Vite team blesses the path     |
| Lighthouse CI                         | Enterprise SPA with no PWA contract: CI cost without proportional signal (the PWA sibling template ships it)                                                                       | A fork has a perf SLA and asks for the gate (lift the PWA template's `lighthouserc`)                             |
| React Doctor as a lint-staged PR gate | Project-level scan, not a staged-file linter; Windows path issues (typicode/husky#1462)                                                                                            | React Doctor 1.0 ships and a fork shows a bug it would have caught (then ad hoc or a PR comment, never blocking) |
| memlab                                | No published GitHub releases, none of the leaderboard flagship repos run it in CI                                                                                                  | v2.0 ships with formal releases and a named app publishes a CI case study                                        |
| why-did-you-render                    | Template stays minimal; consumer choice (incompatible with React Compiler, which is not shipped here)                                                                              | Never needed; a fork may add it                                                                                  |
| Zstd compression plugin               | Safari Zstd landed only in 26.3, global support is far from universal, Brotli stays mandatory and `vite-plugin-compression` already emits it                                       | caniuse global Zstd passes 80% and the CDN negotiates encoding automatically                                     |
| `vite-plugin-bundlesize`              | `size-limit` already adopted; a second single-vendor size gate                                                                                                                     | `size-limit` is deprecated or unmaintained                                                                       |

**Evidence:** https://github.com/Vadymk95/template-1/commit/c016070

## [2026-04] MSW browser worker and its dev opt-out

**Status:** in force.

**Decision:** dev-only MSW uses `setupWorker` in `src/mocks/browser.ts`, with handlers shared with
Vitest (`test/handlers`). `main.tsx` starts the worker when `import.meta.env.DEV` and
`VITE_ENABLE_MSW !== 'false'` (default on in dev). This keeps worker setup out of the root file,
reuses one handler list for Node and browser, and lets mocks be turned off without removing code.
The `import.meta.env.DEV` guard and the dynamic import must stay: dropping them ships the MSW chunk
to production (the total-JS budget turns red).

**Evidence:** https://github.com/Vadymk95/template-1/commit/b6be82f

## [2026-04] i18n init failure falls back to English-only

**Status:** in force.

**Decision:** if `i18nInitPromise` rejects, `main.tsx` removes `html.i18n-loading`, logs through
`logger.error('[i18n] ...')` and renders `I18nInitErrorFallback` in fixed English (`t()` is
unavailable on this branch). Before this, a locale JSON failure left the app on an empty tree
forever.

**Evidence:** https://github.com/Vadymk95/template-1/commit/01bb446

## [2026-04] Web Vitals chunk split is checked after the build

**Status:** in force. Guard: `scripts/check-web-vitals-chunks.mjs`, run inside `verify`.

**Decision:** after a build, `dist/assets` must contain only `subscribeStandard` and the standard
`web-vitals` chunk by default; `npm run verify:web-vitals-chunks:full` also builds the attribution
variant and asserts it. Branching on `env` from `@/env` pulled both dynamic imports into the graph;
only `import.meta.env.VITE_WEB_VITALS_ATTRIBUTION` allows dead-code elimination.

**Evidence:** https://github.com/Vadymk95/template-1/commit/01bb446

## [2026-04] `eslint-import-resolver-typescript` reads one solution `tsconfig`

**Status:** in force.

**Decision:** `createTypeScriptImportResolver` is given `./tsconfig.json` only (the solution file
with `references`), not an array of `tsconfig.*.json`. The resolver warns on multiple `project`
entries; with one file it sets `references: 'auto'` and follows `tsconfig.app`, `tsconfig.node` and
`tsconfig.vitest` like `tsc -b`.

**Evidence:** https://github.com/Vadymk95/template-1/commit/2838737

## [2026-04] Component pattern: arrow function plus `FunctionComponent`

**Status:** in force; ESLint enforces it.

**Decision:** components are `const X: FunctionComponent<Props> = () => {}`, never `FC` and never
function declarations. `FC` is an alias, so `FunctionComponent` makes the type relationship
explicit, and arrows match the hooks and utilities style. `no-restricted-imports` bans `FC` and
`func-style: expression` bans declarations; `src/components/ui/` (shadcn-generated) is the
exception.

**Evidence:** https://github.com/Vadymk95/template-1/commit/937333a

## [2026-03] Build stack: Tailwind v4, Vite 8 with Rolldown, `plugin-react` v6

**Status:** in force.

**Decision:**

- **Tailwind v4:** config lives in `src/index.css` (`@theme inline`), through the Vite-native
  `@tailwindcss/vite` plugin with no PostCSS dependency. The `container` utility has no JS
  `center`/`padding` option, so apply utilities directly; `tw-animate-css` (a CSS import) replaces
  `tailwindcss-animate`.
- **Vite 8:** the official `vite@^8` package, which ships Rolldown; no `rolldown-vite` alias or
  `overrides`. Vendor chunks use `build.rolldownOptions.output.codeSplitting.groups`; the
  `state-vendor` group includes `zustand`, `@tanstack/react-query` and `@tanstack/query-core` (the
  analyzer showed `query-core` splitting out when only `react-query` matched).
- **`@vitejs/plugin-react` v6:** Oxc-based refresh, Babel not required. React Compiler would need
  `reactCompilerPreset` plus `@rolldown/plugin-babel`; see the REJECT list.

**Evidence:** https://github.com/Vadymk95/template-1/commit/4299fce

## [2026-03] No FSD; Zustand for client state, TanStack Query for server state

**Status:** in force.

**Decision:** a plain folder structure (`components/`, `hooks/`, `store/`, `lib/`, `pages/`), not
FSD layers: FSD adds onboarding friction to a template meant to be cloned, and a consumer can layer
it on. State has a hard boundary: no Zustand for server data and no TanStack Query for pure UI
state. Mixing them causes cache inconsistency and double-refetch bugs; Zustand with devtools gives
observable client state, and TanStack Query owns the whole async lifecycle (loading, error, stale,
refetch).

**Evidence:** https://github.com/Vadymk95/template-1/commit/4299fce
