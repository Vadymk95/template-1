---
description: Write tests for the change that hunt corner cases at integration seams, not the happy path
---

Write or strengthen tests for what changed. The default failure mode this command exists to prevent is
**characterisation**: tests that describe what the code currently does, pass immediately, and would keep
passing if the behaviour were reverted. Those cement the flow instead of guarding it.

## 1. Scope to the change

```bash
git diff --name-only origin/master...HEAD
git status --short
```

Testable: `src/**` logic, hooks, stores, components, `src/lib/api`. Skip: styles, types-only files,
constants, config, i18n JSON. If nothing testable changed, say "no testable changes" and stop.

List what the branch **already** tests for these files — update the existing spec rather than adding a
parallel one.

## 2. Reuse this repo's test infrastructure — do not invent

- `src/test/test-utils.tsx` — `renderWithProviders` (QueryClient + i18n with real translation files).
- `src/test/server.ts` + `src/test/handlers.ts` — MSW. Override per test with `server.use(...)`; the
  setup fails on an unhandled request, so a missing handler is a test bug not a flake.
- `src/test/setup.ts` — jest-dom matchers and MSW lifecycle, already wired.
- A recent nearby spec is the reference for imports, wrapper and assertion style.

Hardcoding a literal where a handler or helper already provides it is a violation.

## 3. Decide the coverage LEVEL before writing

Grep each changed module's consumers. If it is used in more than one place, or its behaviour depends on
what a parent wires into it (store, provider, context, props), unit tests alone are **not** enough —
render it through the real parent path as well. A component whose unit tests are green and which breaks
when mounted somewhere else is the exact failure this rule exists for.

Single-consumer leaf with pure props: unit coverage is enough. Say so explicitly.

## 4. Enumerate corner cases at the seams

This is the substance of the command. For every changed unit, walk these axes and write down which
apply — then test those, not the happy path:

- **Async transitions.** loading → loaded, loading → error, error → retry → loaded. The intermediate
  state is where stale data and double-fetches live. A test that only asserts the settled state cannot
  see them.
- **Identity switches.** A → B while a request for A is still in flight. Does B render A's data? Does
  the store keep A's entry? This is the classic stale-state bug and it never shows on a single-entity
  test.
- **Boundaries, from both sides.** For a rule at N, assert N and N-1. Empty, one, many. First and last.
  Zero results versus a failed request — they are different and often collapse into the same branch by
  accident.
- **Content extremes, for anything that renders copy.** The shortest string the schema allows, a typical
  one, a long one, and ONE UNBROKEN TOKEN with nothing to wrap on — plus zero, one and many for a
  collection. A long sentence wraps on its spaces and hides the defect that the unbroken token finds.
  jsdom has no layout, so a unit test can pin a class string and no more: the measurement is
  `npm run verify:full` (`/dev/ui/content-stress` at 390 / 640 / 768 / 1024 / 1440). Add a case to
  `src/pages/DevPlayground/stressMatrix.ts` when you add a content-bearing component. And name the RANGE
  a guard must cover, never a single example — a guard proven at one width usually just moves the defect
  to another.
- **Contract seams between modules.** Where your change crosses a boundary — component to hook, hook to
  api function, api to MSW, store to selector — assert the shape that crosses it. A response validated
  by type assertion instead of a Zod parse is trusted on faith; test what happens when the shape is
  wrong.
- **Error mapping.** Each distinct status or error code that maps to a distinct user-visible message
  needs its own case. One test for "it shows an error" hides the mapping entirely.
- **A number that appears twice.** If a limit lives in a rule and also in the copy advertising it, one
  test must pin both, or they drift.
- **Cleanup.** Unmount mid-flight, an aborted request, a listener or timer that outlives the component.

For anything in `.cursor/brain/SKELETONS.md`, at least one case beyond the happy path is mandatory.

## 5. Prove each test can fail

For every test written: revert the behaviour it guards and confirm it goes red. Report what you
reverted and what failed. A test you did not see fail is a test you are guessing about.

Every test needs a meaningful assertion. `expect(true).toBe(true)`, `expect(x).toBeTruthy()` on a value
the test just built, and `toHaveTextContent('')` where `toBeEmptyDOMElement()` was meant all count as no
assertion at all.

For guards and acceptance lists — anything whose job is to REFUSE values — also prove the accepting
direction: a legitimate near-variant must stay green. A guard you have only ever seen refuse may be
refusing too much, and a revert-style proof cannot see that side; an over-strict test rejects valid
implementations as readily as a weak one admits broken ones.

## 6. Run them the way the gate does

```bash
npm run test:coverage > /tmp/test.log 2>&1; echo $?
```

Coverage thresholds only enforce with `--coverage`, so bare `npm test` proves less than it looks like.
If a threshold fails, name the file that dragged it down and propose tests — never lower the threshold
or extend the coverage `exclude` list.

## 7. Report

Written / updated / skipped, with the reason for each skip. Then: which corner-case axes from step 4
applied and are now covered, which applied and are **not** covered and why, and what you reverted to
prove the tests fail. End with `Confidence: HIGH | MEDIUM | LOW — reason`.
