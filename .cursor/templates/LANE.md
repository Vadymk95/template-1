# Lane rules: briefs, reports and scratch

How an implementer lane is briefed, what it hands back and where its scratch lives. The roles and the
tier law stay in `AGENTS.md`. The numbers below were measured in a fork: starting points, not law.

## Brief

- Quote the plan rows the lane implements with their line numbers, and give every fact with its file
  and line as read at the base commit.
- Name the one heading or line of any other file the lane may open. A plan or spec is opened at a
  named place, never whole.
- State the write boundary: a lane writes only inside its worktree and its scratch folder. A change to
  a planner file or a gate file goes in the report as exact lines; the lead applies it with the
  operator.
- Change no package. If one looks necessary, stop that item and report the package and version.
- An item that tightens a page-level check names who fixes what it turns red.

## While the lane runs

- Batch independent reads, 3 to 5 per turn. Read no file over 300 lines whole: find the heading or
  the symbol with a search, then read that range.
- Send command output to a log and print only the exit code and a tail.
- A lane never waits on a prompt, because nobody answers it: read with Read and Grep, run
  `npm run --prefix <dir>` and `git -C <dir>` instead of `cd`, and use no shell variable and no `;`
  chain.
- A permission ask, a deny or a hook block is a stop for that one action. Report it with the path and
  the rule, never reach the same file another way (a shell redirect, a script, another tool), and
  continue with the rest.
- Mutation checks are mental: if reverting the change would leave the suite green, the test is
  worthless. Break code on disk only to prove a NEW gate.
- Keep short working notes in the scratch folder, so that a compaction costs one short re-read. The
  brief is self-contained: never read the lead's files.
- Stop polishing at about 200 tool calls. A fix of a few lines on a lane past about 200K tokens of
  context goes to a fresh small agent with the plan row and the file, not to the long one.

## Report

- Per item: done, partial or blocked. Then the files changed, the tests added with their red-before
  output, the commands run with exit codes, the deviations from the brief and why, and anything
  blocked with its path and rule.
- A lane that reports docs instead of editing them gives each line as file, section and exact text.
- When the lead decides against a proposal in a report, put a line `superseded by <block>` directly
  under it; the proposal text stays.
- Scratch (notes, logs, copies) stays outside the repository. List it with sizes at the end, so the
  lead can delete it.
