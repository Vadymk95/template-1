---
description: Bring the repo's own docs back in line with the code, read-safe
---

Refresh this repo's documentation so it describes the code as it is now. **Propose diffs; do not write
until the operator approves them.**

## Scope — these files only

- `AGENTS.md` — invariants, stack table, the command list, version holds, out-of-scope list.
- `.cursor/brain/PROJECT_CONTEXT.md` — purpose, stack, layout, the gate.
- `.cursor/brain/MAP.md` — routes, files, responsibilities.
- `.cursor/brain/SKELETONS.md` — danger zones, with the risk AND the mitigation.
- `.cursor/brain/DECISIONS.md` — append an entry when a decision was made and has a rationale that
  git history does not capture.
- `.cursor/brain/TEMPLATE_SEEDS.md` — what must not be deleted as dead code.
- `README.md` — only when the setup or the commands changed.

Nothing else. Source files are not in scope for this command.

## Method, part 1 — find what shipped and was never written down

Start from history, not from the docs. The docs cannot tell you what they are missing.

```bash
git log --oneline -40 origin/master
git log --oneline -20 -- AGENTS.md .cursor/brain/    # when were the docs last touched?
git diff --stat <last-docs-commit>..origin/master    # what landed since
```

Read the subjects of everything that landed after the docs were last updated, and for each ask whether it
changed something a doc claims. A new script, a new gate step, a new danger zone, a new dependency with a
version hold, a decision with a trade-off — each of those has a home in the list above and is usually the
thing that is missing.

Then check the reverse: a doc that describes something the log shows was removed.

## Method, part 2 — code is ground truth

For every claim already in those files, verify it against the repo before keeping it:

- A named script must exist in `package.json`. Diff the documented command list against the real one
  in both directions: documented-but-missing, and existing-but-undocumented.
- A named file, directory, rule or config key must exist. Grep or read it.
- A version must match `package.json`. Stack tables rot first.
- A claim about what CI enforces must match `.github/workflows/`.

When the code and a doc disagree, **the code wins**: fix the doc. Do not silently work around a stale
line — that is how a wrong doc survives another five sessions.

## What NOT to write

- No invented rationale. If you cannot find why something is the way it is, write what it does and
  say the reason is unrecorded.
- No trivia. A decision with a trade-off earns a `DECISIONS.md` entry; a rename does not.
- No dates, ticket ids, or provenance ("as discussed", "per the chat"). State the constraint itself.
- No absolute local paths in committed files.

## Output

A per-file diff, then a one-line summary of what was stale and what you deliberately left alone. If
nothing was stale, say that — it is a real result, not a failure to find work.
