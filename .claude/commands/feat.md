---
description: Implement a feature in this repo — scope, reuse check, plan, TDD, gate
---

Implement `$ARGUMENTS` in this repo. The process below is the repo-local version: it names this repo's
actual gate, its actual reuse locations and its actual danger zones, so nothing has to be guessed.

## 0. Before reading anything: is this still needed, and where does it live?

Two questions, both cheap; both measured as the largest recoverable waste in a lane's entry
(`AGENTS.md` § Entering this repo cheaply):

1. **Is the work still needed?** `git log --oneline -15` and one grep for the thing the task names.
   Say what you checked.
2. **Where does it live?** `.cursor/brain/READING_INDEX.md` maps the situation to the two or three
   files that answer it. Open that before sweeping a directory.

## 1. Discovery

1. `.cursor/brain/SKELETONS.md` — does the task touch a danger zone? If yes, that section governs the
   task and you flag the risk before planning.
2. `.cursor/brain/MAP.md` for wiring, `.cursor/brain/TEMPLATE_SEEDS.md` for what must not be deleted.
3. The `.cursor/rules/*.mdc` whose `globs` match the files you will touch. Only those. State which you
   loaded.
4. **Reuse check — a hard gate, not advice.** Before planning any new function, hook, component or
   constant, search for an existing equivalent by name AND by synonym in the places this repo keeps
   them: `src/lib/` (utils, api, logger, queryClient), `src/hooks/`, `src/components/ui/` (shadcn
   primitives — never hand-roll one that exists), `src/components/common/`, `src/store/`. Shipping a
   parallel implementation of something that exists is a violation, not a style choice.

## 2. Scope, out loud, before any edit

Two lists: **in scope** and **explicitly out of scope**. Name the danger zones touched, or say "none".
Name what you are reusing (`Reusing: …`) — an empty reuse list on a non-greenfield task means step 1.4
was not really done.

If a blocking requirement is unclear, ask **one** question at a time and propose your recommended
answer with it. Resolve from the codebase or the brain instead of asking whenever the answer is
discoverable there.

Wait for approval by risk (the risk list: `.cursor/rules/workflow.mdc` § The Approval Law). Trivial leaf
edits proceed with a brief note.

**Bigger than a one-sentence diff?** Then the scope lives in `.cursor/<feature-slug>/SPEC.md` and
`PLAN.md` (templates in `.cursor/templates/`, law in `AGENTS.md` § Before code). Create or update them
before §3; a plan is approved as a pull-request review, never as a chat reply.

## 3. Build

- **Logic first, test-first**: for stores, hooks and `src/lib` modules, write the failing test, then the
  code. Say what the test asserted while it was red.
- **UI**: implement, then cover it through `renderWithProviders` from `src/test/test-utils.tsx`.
- Batch rule: `.cursor/rules/agent-pipeline.mdc` § Iteration Protocol; the check is `npm run verify:iter`
  (seconds), plus `npm run e2e:one -- e2e/<file>.spec.ts` when the surface has a spec (free port,
  traced). Need to LOOK at a built result: `npm run verify:measure` — legal at any time. The full
  chain is never run by hand (tier law: `AGENTS.md` § the gate).
- Every `src` logic file needs a co-located `*.test.*` — the pre-commit hook refuses otherwise. Write
  the test because it is worth having, not to satisfy the hook.
- Match the surrounding file exactly: 4-space indent, arrow functions, `FunctionComponent`, `@/`
  imports, named constants, design tokens, `t()` for every user-visible string, `logger` never
  `console`.

## 4. Verify

Hand-over runs the ITERATION tier plus the touched specs — the full chain belongs to the push hook
and CI:

```bash
npm run verify:iter > /tmp/verify.log 2>&1; echo $?
npm run e2e:one -- e2e/<touched>.spec.ts
```

Exit code **without a pipe**; the rest of the checklist: `.cursor/rules/agent-pipeline.mdc` § 4.1a.

If the gate fails, fix the cause. Do not lower a severity, add an `eslint-disable`, move a threshold, or
extend an ignore list to get green.

## 5. Report and stop

- Files changed, and what each does.
- **What you deliberately did not touch**, and why. This is the auditable half.
- Which brain file needs an update (`MAP.md` for new wiring, `DECISIONS.md` for a trade-off,
  `SKELETONS.md` for a new risk), or `Brain sync: none needed`.
- Anything you flagged instead of forcing.
- `Confidence: HIGH | MEDIUM | LOW — reason`.

Hand over for review; the push runs the gate (`AGENTS.md` › Lanes).
