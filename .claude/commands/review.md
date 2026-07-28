---
description: Act as a senior reviewer on the working diff — leaks, security, bug hunt, tests
---

You are the reviewer on this diff. Not the author, not a linter. Your job is to find what the gate
cannot: leaks, unsafe paths, wrong behaviour under conditions nobody ran, and tests that only look like
tests. Report; do not fix unless asked.

## 0. Establish the diff

```bash
git status --short
git diff                       # unstaged
git diff --cached              # staged
git diff origin/master...HEAD  # committed on a branch
```

Every finding must sit on a line this diff touches. Whole-file context tempts you toward legacy code;
that temptation is how a one-file fix becomes a refactor. Pre-existing problems get named separately as
"pre-existing, not this diff" — never mixed into the findings.

Load `.cursor/brain/SKELETONS.md`. If the diff enters a danger zone, that section IS the review.

## 1. Mechanical pass first, judgement second

Read every changed line before forming an opinion. Judgement-first review allocates attention, and
allocating means skipping — a uniform pass has no earlier verdict of its own to defend.

Then run the gate yourself, never on the author's word:

```bash
npm run verify > /tmp/verify.log 2>&1; echo $?
```

Exit code **without a pipe**: piping to `tail` returns the pipe's status, so a failed build reads as a
pass.

## 2. Leak hunt (React + browser)

Walk each changed component and hook against this list. Most are invisible in tests and in one manual
click-through.

- **`useEffect` with no cleanup** where one is needed: `addEventListener`, `setInterval`/`setTimeout`,
  `IntersectionObserver`/`ResizeObserver`/`MutationObserver`, a store or query subscription, a
  `MediaQueryList` listener, an `AbortController` for an in-flight fetch. Each needs its teardown in the
  returned function.
- **State set after unmount** — an async handler that resolves late and calls `setState`. Look for
  `await` followed by a setter with no abort signal and no mounted guard.
- **Stale closure**: a callback captured with an empty or incomplete dependency array that reads a value
  which changes. Check every dependency array in the diff against the identifiers in its body.
- **Identity churn**: an object, array or function literal created in render and passed as a prop or a
  dependency. It makes memoisation a no-op and can drive an effect on every render.
- **Module-scope accumulation**: a `Map`, `Set`, array or cache declared at module level that only ever
  grows. It survives every unmount for the life of the tab.
- **Retained DOM**: a `useRef` to a node, or a closure over one, kept in state or module scope after the
  node is gone.
- **Subscription without a matching unsubscribe** across the whole diff — count them; the numbers should
  match.

## 3. Security pass (this is a client bundle)

- **Everything `VITE_*` is public.** `src/env.ts` validates `import.meta.env`, and Vite inlines those
  values into the shipped JavaScript. A secret, private key or admin endpoint introduced under a `VITE_`
  name is a leak the moment it builds. Flag any new `VITE_` variable and ask what it holds.
- **The frontend is not a security boundary.** Any check the diff adds that gates access, price,
  entitlement or role must exist on the server too. Client-side gating is UX.
- **Injection**: `dangerouslySetInnerHTML` at all; a `href` or `src` built from user or URL input
  (`javascript:` and `data:` both execute); `window.open` with untrusted input; `target="_blank"`
  without `rel="noopener"`.
- **Token handling**: where the auth token is read from and written to, whether it reaches a log line, a
  query string, an error message, an analytics payload, or `localStorage` when the diff had a choice.
  `logger` calls in the diff must not carry credentials or whole request bodies.
- **Unvalidated boundaries**: a `fetch`/`response.json()` whose result is typed by assertion instead of
  parsed with Zod (`src/lib/api/safeFetch.ts` exists for this). Spreading an unvalidated object into
  state is also prototype-pollution surface.
- **Open redirect**: a navigation target taken from a query parameter or path without an allowlist.
- **New dependency** in the diff: what does it pull in, is it maintained, does it need install scripts
  (`.npmrc` disables them repo-wide — a package that needs them is a decision, not a detail).

## 4. Bug hunt — run the algorithm, do not browse

For each changed **function**: name its inputs, then walk them.

1. Boundaries from both sides: 0, 1, many; the limit and the limit minus one; empty string versus
   `undefined` versus `null`.
2. Every early return and every `catch` — is the error path correct, or does it swallow and continue with
   a half-built value?
3. Ordering and concurrency: what if it is called twice before the first finishes? What if the second
   call's response arrives first?
4. Idempotency: called twice with the same input, does it do the work twice?

For each changed **component**: mount, unmount, remount. Props changing identity but not value. A
conditional render that changes hook order. A list whose keys are indexes.

For each changed **async path**: loading → loaded, loading → error, error → retry, and switching the
subject mid-flight (A → B while A is still loading). Stale data rendered under a new identity is the
single most common bug this repo's shape can produce.

## 5. Judge the tests

The pre-commit hook only proves a `*.test.*` file exists. You judge whether it is worth anything.

- **Mutation check**: for each test covering this change, would it still pass if the change were
  reverted? Name every test that would. Those are not coverage.
- Assertions that cannot fail: `toBeTruthy()` on a value the test constructed, `toHaveTextContent('')`
  where `toBeEmptyDOMElement()` was meant, a `waitFor` whose body cannot throw.
- Fixture duplication: a literal hardcoded in a test where `src/test/handlers.ts` or
  `src/test/test-utils.tsx` already provides it.
- Missing level: a component used in more than one place, or wired by a parent, covered only by unit
  tests.

## 6. Accessibility and performance

- Visible focus, targets at least 44px, a real label associated with each control (a placeholder is not
  one), landmarks not nested, one `h1` per view, no `button` inside a link.
- `disabled` on an anchor does nothing; on a button it drops focus to the body. Expect `aria-disabled`
  plus a click guard.
- `prefers-reduced-motion` resolves to the end state, not to a faster animation.
- A list that can exceed roughly 50 rows without virtualisation; an image in the first viewport without
  `fetchpriority="high"`; a below-fold import that is not lazy.

## 7. Report

Order: **security → leaks → correctness → tests → accessibility → performance.** Style is not a finding.

Flag unrequested work the moment you see it, not in the summary.

Per finding: `path/to/file.ts:LINE`, one sentence on what is wrong, and the concrete input or sequence
that breaks it. If you cannot make it concrete, label it `suspicion` and say what you would need to
confirm it. Do not pad the list — three real findings beat twelve observations.

End with `Confidence: HIGH | MEDIUM | LOW — reason`.
