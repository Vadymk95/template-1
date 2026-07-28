---
description: Become fully oriented in this repo — read, verify against the code, then report and stop
---

Make yourself genuinely oriented in this repo, then report. Reading the docs is step one, not the whole
job: the docs can be stale, and finding that out now is cheaper than finding it out mid-task.

## 1. Read

In this order, in full:

1. `AGENTS.md` — invariants, the gate, what is out of scope.
2. `.cursor/brain/PROJECT_CONTEXT.md` — purpose, stack, layout.
3. `.cursor/brain/SKELETONS.md` — danger zones. Before touching anything, not after.
4. `.cursor/brain/MAP.md` — routes, files, responsibilities.
5. `.cursor/brain/TEMPLATE_SEEDS.md` — what looks like dead code and must stay.
6. `.cursor/brain/DECISIONS.md` — why things are the way they are. Skim; read in full any entry whose
   subject the current task touches.

The process is already in your context through the always-applied rules — the six phases and the
verification-integrity checks in `.cursor/rules/agent-pipeline.mdc`, the Approval Law and the commit
format in `.cursor/rules/workflow.mdc`. There is no separate playbook to find.

Read the conditional `.cursor/rules/*.mdc` only when a task tells you which files it touches. Reading
all of them up front is a context tax with no gain.

## 2. Verify the docs against the code — code wins

Do not take the reading at face value. Check, cheaply:

- **The command list**: every `npm run` named in `AGENTS.md` exists in `package.json`, and every script
  that gates something is documented. Check both directions.
- **The gate**: read `package.json` `verify` / `verify:ci` and `.github/workflows/*.yml`. Is `verify`
  still a superset of what CI runs? A check that lives only in the workflow is the defect this repo has
  a written decision about.
- **The stack table**: versions in `AGENTS.md` against `package.json`. Stack tables rot first.
- **The layout**: `ls src/` against `MAP.md`. A directory in one and not the other is a finding.

Report any drift you find. Do not silently work around a stale line — that is how a wrong doc survives
another five sessions.

## 3. Read the tree

```bash
git log --oneline -15
git status --short
git branch --show-current
gh pr list --state all --limit 8
```

A dirty tree usually means work is waiting for review. Recent commit subjects tell you what the repo has
been doing lately, which is often more current than any doc.

## 4. Say exactly three things and stop

1. **Where the repo is** — branch, whether the tree is clean, what landed recently, and any doc drift you
   found in step 2.
2. **The immediate next step.**
3. **Any decision you need from the operator.**

No plan dump. Do not restate the docs back. Do not start work before the answer.

If `$ARGUMENTS` names a task, treat it as the immediate next step, and say which danger zones and which
conditional rules it will pull in.

## 5. Close with the command menu

After the three things, print this verbatim as a single block. It is a footer, not a fourth item — the
operator asks for work in prose rather than typing commands, so the moment right after orientation is the
only place this list is useful.

```
Next: /feat <task> · /test · /review · /docs
```

Nothing else after it. Do not explain the commands, do not recommend one — the three things above
already said what the next step is.
