#!/usr/bin/env node
/**
 * format-changed - Prettier's check on the files the working tree changed: the iterate chain's format leg.
 *
 * The commit hook runs `format:check` over the whole repository, so a formatting drift used to surface
 * only when a commit was attempted. This leg checks what differs from HEAD, staged or not, plus
 * untracked files (the set `changedFiles` in lint-changed.mjs selects, deleted files left out), with
 * the cache of `npm run format:check`. Files Prettier ignores (`.prettierignore`) pass, and so do files
 * of a type it cannot parse: the repo-wide run skips both as well. With nothing changed the leg ends
 * before Prettier loads.
 *
 * Usage (from the repository root): node scripts/format-changed.mjs
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

import { isEntryPoint } from './is-entry-point.mjs';
import { changedFiles } from './lint-changed.mjs';

const CACHE_LOCATION = '.prettiercache';

/** The Prettier arguments: what `npm run format:check` passes, plus the quiet skip of unknown types. Paths come after `--`. */
export const prettierArgs = (files) => [
    '--check',
    '--cache',
    '--cache-location',
    CACHE_LOCATION,
    '--ignore-unknown',
    '--no-error-on-unmatched-pattern',
    '--',
    ...files
];

const nodeRequire = createRequire(import.meta.url);

const prettierBin = () => {
    const manifest = nodeRequire.resolve('prettier/package.json');
    const { bin } = nodeRequire(manifest);

    return path.join(path.dirname(manifest), typeof bin === 'string' ? bin : bin.prettier);
};

const main = () => {
    const cwd = process.cwd();
    const files = changedFiles({ cwd });
    if (files.length === 0) {
        console.log('format-changed: no changed file for Prettier');
        return;
    }

    console.log(`format-changed: Prettier on ${files.length} changed file(s)`);
    const result = spawnSync(process.execPath, [prettierBin(), ...prettierArgs(files)], {
        cwd,
        stdio: 'inherit'
    });
    if (result.status === 0) return;

    console.error(
        '\n✖ format-changed: the files above are not formatted. `npm run fix` formats them (and fixes lint).\n'
    );
    process.exit(result.status ?? 1);
};

// Guarded so importing this module for a test does not check the working tree.
if (isEntryPoint(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
