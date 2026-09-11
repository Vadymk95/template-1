---
feature: <feature-slug>
spec: SPEC.md
status: draft # draft | in_review | approved | superseded
---

# Plan: <feature name>

HOW only. Implements the approved `SPEC.md`; a conflict with the spec goes back to the spec, it is
never resolved here. Read the code you name before naming it.

## Approach

<!-- The technical strategy in a few lines. No new behaviour. -->

## Reusing

<!-- Existing functions, hooks, components, constants this reuses (the reuse gate in `/feat`). An empty list on a non-greenfield task means the check was not done. -->

## Changes per file

| File | Change | Code read before deciding |
| ---- | ------ | ------------------------- |
|      |        |                           |

## Sequencing

<!-- 2-7 slices in order, each under ~400 changed lines and green on the gate on its own. Name what each slice proves. -->

1.
2.

## Test strategy

<!-- Strict TDD or hybrid, per part. Bug fixes: the regression test that fails without the fix, written first. Which single spec runs at iterate. -->

| Acceptance criterion | Test that proves it |
| -------------------- | ------------------- |
| AC-1                 |                     |

## Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
|      |        |            |

## Danger zones touched

<!-- From `SPEC.md`; say what the plan does about each, or "none". -->

## Open questions (implementation only)

<!-- Behaviour unknowns belong in `SPEC.md`, not here. -->

| Id   | Question | Blocking | Evidence tried | Resolution |
| ---- | -------- | -------- | -------------- | ---------- |
| PQ-1 |          | yes / no |                |            |

## Verification

<!-- What the gate proves at push; what only a measure or probe can show; what a human checks by hand. -->

## Approval

<!-- The pull request that adds or changes this file. A non-author reviewer approves it there; a chat reply is not an approval. -->
