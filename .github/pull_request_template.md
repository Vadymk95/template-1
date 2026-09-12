## What changed

<!-- One or two sentences. What behaviour is different now? -->

## Why

<!-- The problem this solves. Link the issue if there is one. -->

## How it was verified

<!-- Not "the gate is green" — what did you actually run and observe?
     Include the failure you reproduced first, if this is a fix. -->

- [ ] The push gate ran and printed its stages (`verify:push`; silence is a failure) — exit code read without a pipe
- [ ] New behaviour is covered by a test that FAILS when the change is reverted
- [ ] Visual check at 390 / 768 / 1440 in both themes, if any UI changed

## Deliberately not touched

<!-- Scope discipline. Anything you noticed and left alone, and why.
     Discovered debt belongs in its own issue, not in this diff. -->

## Risks

<!-- What could this break that the gate would not catch?
     Say "none that I can see" if that is the honest answer. -->
