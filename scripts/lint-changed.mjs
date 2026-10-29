#!/usr/bin/env node
/**
 * lint-changed - ESLint, type-aware, on the files the working tree changed: the iterate chain's leg.
 *
 * The iterate chain used to run oxlint only, which has no type information, so the findings that need
 * it (max-params, explicit-function-return-type, no-unnecessary-condition, dot-notation) surfaced first
 * at the commit hook. This leg lints what differs from HEAD, staged or not, plus untracked files, with
 * the same flags and the same cache as `npm run lint`, so the push finds those files warm. A deleted
 * file is dropped (ESLint would fail on a path that is gone), and so is anything ESLint has no config
 * for. Paths ESLint ignores are skipped quietly (`--no-warn-ignored`): the warning it would print
 * otherwise counts under `--max-warnings 0`. With nothing to lint the leg ends before ESLint loads.
 *
 * Usage (from the repository root): node scripts/lint-changed.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { isEntryPoint } from './is-entry-point.mjs';

// The extensions ESLint lints in this repository (the default patterns plus the TypeScript and JSX ones).
const LINTABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const CACHE_LOCATION = '.eslintcache';

// The environment a git hook hands down names the hook's repository; a child `git` that inherited it
// would answer for that repository instead of the working directory.
const gitEnv = () =>
    Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));

const git = (cwd, args) =>
    execFileSync('git', args, {
        cwd,
        env: gitEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

const nulSeparated = (output) => output.split('\0').filter((name) => name !== '');

/** The files that differ from HEAD (staged or not, deleted ones left out) and the untracked ones, sorted, relative to `cwd`. */
export const changedFiles = ({ cwd }) => {
    try {
        git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
    } catch (error) {
        // Exit status 1 is `--quiet` saying HEAD does not resolve; anything else (no git, no repository) is its own failure.
        if (error.status !== 1) throw error;
        throw new Error(
            'lint-changed: this repository has no commit yet, so there is nothing to compare against',
            { cause: error }
        );
    }
    const tracked = nulSeparated(
        git(cwd, ['diff', '--name-only', '--diff-filter=d', '--relative', '-z', 'HEAD', '--'])
    );
    const untracked = nulSeparated(git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']));

    return [...new Set([...tracked, ...untracked])].sort();
};

/** The files ESLint has a config for here. */
export const lintableFiles = (files) => files.filter((file) => LINTABLE.test(file));

/** The ESLint arguments: what `npm run lint` passes, plus the quiet skip of ignored paths. Paths come after `--`. */
export const eslintArgs = (files) => [
    '--max-warnings',
    '0',
    '--cache',
    '--cache-location',
    CACHE_LOCATION,
    '--no-warn-ignored',
    '--',
    ...files
];

const nodeRequire = createRequire(import.meta.url);

const eslintBin = () => {
    const manifest = nodeRequire.resolve('eslint/package.json');

    return path.join(path.dirname(manifest), nodeRequire(manifest).bin.eslint);
};

const main = () => {
    const cwd = process.cwd();
    const files = lintableFiles(changedFiles({ cwd }));
    if (files.length === 0) {
        console.log('lint-changed: no changed file for ESLint');
        return;
    }

    console.log(`lint-changed: ESLint on ${files.length} changed file(s)`);
    const result = spawnSync(process.execPath, [eslintBin(), ...eslintArgs(files)], {
        cwd,
        stdio: 'inherit'
    });
    if (result.status === 0) return;

    console.error(
        '\n✖ lint-changed: fix the findings above. `npm run fix` applies the autofixable ones.\n'
    );
    process.exit(result.status ?? 1);
};

// Guarded so importing this module for a test does not lint the working tree.
if (isEntryPoint(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
