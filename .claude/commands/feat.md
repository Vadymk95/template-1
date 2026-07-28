---
description: Implement a feature in this repo — scope, reuse check, plan, TDD, gate
---

Implement `$ARGUMENTS` in this repo. The process below is the repo-local version: it names this repo's
actual gate, its actual reuse locations and its actual danger zones, so nothing has to be guessed.

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

Wait for approval when the task touches a danger zone, a Zustand store or TanStack Query contract, an
API payload shape, or the router. Trivial leaf edits proceed with a brief note.

## 3. Build

- **Logic first, test-first**: for stores, hooks and `src/lib` modules, write the failing test, then the
  code. Say what the test asserted while it was red.
- **UI**: implement, then cover it through `renderWithProviders` from `src/test/test-utils.tsx`.
- Max two files per iteration without an intermediate check.
- Every `src` logic file needs a co-located `*.test.*` — the pre-commit hook refuses otherwise. Write
  the test because it is worth having, not to satisfy the hook.
- Match the surrounding file exactly: 4-space indent, arrow functions, `FunctionComponent`, `@/`
  imports, named constants, design tokens, `t()` for every user-visible string, `logger` never
  `console`.

## 4. Verify

```bash
npm run verify > /tmp/verify.log 2>&1; echo $?
```

Exit code **without a pipe**. Then: revert your change mentally and ask which of your new tests would
still pass. Any that would is worthless — fix it before reporting.

If the gate fails, fix the cause. Do not lower a severity, add an `eslint-disable`, move a threshold, or
extend an ignore list to get green.

## 5. Report and stop

- Files changed, and what each does.
- **What you deliberately did not touch**, and why. This is the auditable half.
- Which brain file needs an update (`MAP.md` for new wiring, `DECISIONS.md` for a trade-off,
  `SKELETONS.md` for a new risk), or `Brain sync: none needed`.
- Anything you flagged instead of forcing.
- `Confidence: HIGH | MEDIUM | LOW — reason`.

Do not commit. Do not push.
