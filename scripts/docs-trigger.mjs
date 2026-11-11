#!/usr/bin/env node
/**
 * docs-trigger - runs `npm run docs:check` when the changed files can change what it judges.
 *
 * `docs:check` takes seconds and reads the whole repository, so it runs only when the change touches
 * docs, rules, commands, brain files, workflows, hooks, the tier data, the checker itself or
 * `package.json` (the scripts the docs name). This file is the ONE place that condition lives: the
 * pre-commit hook runs it with `--staged` and the iterate chain runs it on the working tree, so the
 * two cannot disagree. The decision and the run are one script on purpose: a crash here exits
 * non-zero, where a hook's `if grep` would read it as "not needed".
 *
 * Usage (from the repository root):
 *   node scripts/docs-trigger.mjs            # files that differ from HEAD, deleted ones included, plus untracked
 *   node scripts/docs-trigger.mjs --staged   # the staged files (the commit hook)
 */
import { execFileSync, spawnSync } from 'node:child_process';

import { isEntryPoint } from './is-entry-point.mjs';
import { changedFiles } from './lint-changed.mjs';

export const DOCS_TRIGGER =
    /\.(?:md|mdc)$|^\.cursor\/|^\.github\/|^\.husky\/|^scripts\/gate-tiers\.json$|^scripts\/docs-check\.|^package\.json$/;

export const touchesDocs = (files) => files.some((file) => DOCS_TRIGGER.test(file));

// A hook chain can export these, and a child git that inherits them answers for the repository they
// name instead of the one at `cwd`. GIT_INDEX_FILE stays: a partial commit hands the hook the
// temporary index that holds what will land.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'];

const stagedFiles = (cwd) =>
    execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
        cwd,
        env: Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !GIT_LOCATION_VARIABLES.includes(key))
        ),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    })
        .split('\0')
        .filter(Boolean);

const main = () => {
    const args = process.argv.slice(2);
    const unknown = args.find((argument) => argument !== '--staged');
    if (unknown) {
        console.error(`docs-trigger: unknown argument ${unknown}`);
        process.exit(1);
    }

    const cwd = process.cwd();
    const files = args.includes('--staged')
        ? stagedFiles(cwd)
        : changedFiles({ cwd, deleted: true });
    if (!touchesDocs(files)) {
        console.log('docs-trigger: no docs-class file changed, docs:check skipped');
        return;
    }

    console.log('docs-trigger: a docs-class file changed, running docs:check');
    const result = spawnSync('npm', ['run', 'docs:check'], { cwd, stdio: 'inherit' });
    process.exit(result.status ?? 1);
};

// Guarded so importing this module for a test does not run the check.
if (isEntryPoint(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
