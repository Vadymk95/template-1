# Reading index — what to open, by SITUATION

Two maps already exist and this is neither. `AGENTS.md` says what the RULES are; `MAP.md` says what
each file IS. Neither answers "I am about to do X — what do I open first", which is this file's only
job: the trigger, not the content. **It points and never restates** — a line summarising a doc rots
the moment that doc changes; a line naming the doc and its section does not. Where two files could
answer, the entry says which one WINS.

Why it exists, measured on a sibling project (2026-08-30): an agent's entry is dominated by READING
SOURCE to find out where things are — roughly 93% of a lane's spend before it writes anything, while
the auto-loaded docs are ~7%. The lever is precision of pointing, not smaller documents. The single
biggest observed difference between a 33-tool lane and a 191-tool lane was how exactly the task
named its files.

## 1. Picking this repo up cold

- `AGENTS.md` — WINS: the operating contract, the invariants, the tier law (§ the gate).
- `.cursor/brain/PROJECT_CONTEXT.md` — stack, architecture, what CI runs.
- `.cursor/brain/MAP.md` — entry points, how to add a page or a feature; read it INSTEAD of sweeping
  `src/`.

## 2. About to change a shared UI primitive or the chrome

- `.cursor/brain/MAP.md` "Adding a shadcn Component" / "CSS / Theming" — WINS: where primitives live
  and which tokens govern them.
- `npm run probe -- <route>` — LOOK at the result at three widths before reasoning about it; one
  measurement replaces a round of inference.
- `.cursor/brain/SKELETONS.md` "Tailwind v4 — NO tailwind.config.ts" — the theme lives in CSS; a JS
  config is the wrong instinct here.

## 3. About to add or change a page or a route

- `.cursor/brain/MAP.md` "Adding a New Page" / "Routing" — WINS: the lazy-by-default contract and the
  router assembly.
- `.cursor/brain/SKELETONS.md` "Lazy Pages + Suspense", "Main landmark + route focus" — the two
  places a new route silently breaks a11y or loading.
- `.cursor/brain/SKELETONS.md` "`playwright.config.ts` must keep `dev/**` in `testIgnore`" — a new
  dev-only route is invisible to the production e2e project on purpose.


## 4. About to touch state, auth-gated routes, or persistence

- `.cursor/brain/SKELETONS.md` "userStore — persist middleware" — WINS: rehydration ordering is the trap.
- `.cursor/brain/MAP.md` "State Boundaries" — Zustand versus server state versus local.
- `.cursor/brain/SKELETONS.md` "createSelectors — no direct store subscription in tests".

## 5. About to touch a gate, a hook, or CI

- `AGENTS.md` § the gate — WINS: the tier law itself (what runs at which moment, the prohibitions).
- `.cursor/brain/VERIFICATION.md` — the mechanics: the phase table, the tracer, the port rules.
- `scripts/gate-tiers.json` — the moments/budgets as DATA; the discipline changes by editing this.

## 6. About to add a dependency, or an advisory went red

- `.cursor/brain/DECISIONS.md` + `AGENTS.md` § Version holds — WINS: a floor carries a major cap, and
  an allowance is the last resort and needs an expiry.
- `scripts/audit-allowlist.json` — the current allowances and their reasons.

## 7. Wondering whether the work is still needed

Before reading anything else: `git log --oneline -15`, then grep for the thing the task names. On the
sibling project two of five dispatched lanes returned "already done" after ~430k tokens between them,
and both were answerable by five minutes of grep. **This entry is first in cost order even though it
is last in the list.**

## Keeping this honest

Add a situation only after an agent was actually sent to the wrong file over it. When two files could
answer, name which one WINS — never list both and leave the reader to guess.
