---
feature: <feature-slug>
status: draft # draft | in_review | approved | superseded
created: YYYY-MM-DD
---

# Spec: <feature name>

WHAT and WHY only. No implementation choices here; those belong in `PLAN.md`. Fill every line from
evidence (the code, the ticket, a document, a measurement) and park every unknown in Open questions:
an unknown is never resolved by inventing a behaviour.

## Summary

<!-- One paragraph: the user-visible outcome, and why now. -->

## Current behaviour

<!-- What the product does today. Source of truth: the code. Cite paths. -->

## Desired behaviour

<!-- Observable outcomes only. If unknown, add an Open question instead of guessing. -->

## Evidence

| Claim | Kind                                   | Reference                          |
| ----- | -------------------------------------- | ---------------------------------- |
|       | ticket / document / code / measurement | path, page id, URL or command line |

## Acceptance criteria

<!-- Each one testable without naming an implementation. -->

1. **Given** …, **When** …, **Then** …
2. **Given** …, **When** …, **Then** …

## Out of scope

<!-- Explicit non-goals, from evidence. -->

## Danger zones

<!-- Lines from `.cursor/brain/SKELETONS.md` this change touches, or "none". -->

## Open questions

<!-- A blocking question prevents approval. `Evidence tried` names where the answer was looked for. -->

| Id   | Question | Blocking | Evidence tried               | Resolution |
| ---- | -------- | -------- | ---------------------------- | ---------- |
| OQ-1 |          | yes / no | code / docs / ticket / asked |            |

## Approval

<!-- The pull request that adds or changes this file. A non-author reviewer approves it there; a chat reply is not an approval. -->
