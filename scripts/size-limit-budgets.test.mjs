// @vitest-environment node
//
// A chunk the bundler is told to emit by name gets a budget of its own. The total budget only sees the
// sum, so a vendor chunk with no entry here can grow to any size while the sum stays under its cap,
// and the entry chunk's budget is the one that looks wrong afterwards. The group list is read from the
// real build config, not from its text, so a renamed or added group is judged as the bundler sees it.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import viteConfigFn from '../vite.config.ts';

const chunkGroupNames = () => {
    const config =
        typeof viteConfigFn === 'function'
            ? viteConfigFn({ command: 'build', mode: 'production' })
            : viteConfigFn;
    return config.build.rolldownOptions.output.codeSplitting.groups.map(({ name }) => name);
};

const budgetEntries = () => JSON.parse(readFileSync('.size-limit.json', 'utf8'));

const budgetedPaths = () => budgetEntries().map(({ path }) => path);

// size-limit enforces an entry only `if (check.limit)`: an entry with no limit measures and passes for
// ever, and a limit it cannot read as bytes is an error at run time, or a time limit that needs a
// plugin this repo does not install. So the form is pinned: a positive number and a byte unit.
const BYTE_LIMIT = /^\d+(?:\.\d+)? ?(?:[kmg]i?)?B$/i;
const isByteLimit = (limit) =>
    typeof limit === 'string' && BYTE_LIMIT.test(limit) && Number.parseFloat(limit) > 0;

describe('.size-limit.json', () => {
    it('holds a budget for every chunk group vite.config.ts names', () => {
        const paths = budgetedPaths();
        const names = chunkGroupNames();

        // The list must be the real one: an empty list would pass for the wrong reason.
        expect(names).toContain('react-vendor');
        for (const name of names) {
            expect(paths, `chunk group "${name}" has no budget`).toContain(
                `dist/assets/${name}.*.js`
            );
        }
    });

    it('gives every entry a byte limit and measures it in brotli', () => {
        const entries = budgetEntries();

        // An empty file would pass for the wrong reason.
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
            expect(isByteLimit(entry.limit), `"${entry.path}" has no usable limit`).toBe(true);
            expect(entry.brotli, `"${entry.path}" is not measured in brotli`).toBe(true);
        }
    });

    it('reads a limit the way size-limit does, and refuses what it would not enforce', () => {
        for (const limit of ['90 KB', '22 kB', '1.5 MB', '800 B', '90KB', '2 KiB']) {
            expect(isByteLimit(limit), limit).toBe(true);
        }
        for (const limit of [
            undefined,
            null,
            '',
            '0 KB',
            '0',
            '90',
            90,
            '1 s',
            '300 ms',
            'big',
            '-5 KB'
        ]) {
            expect(isByteLimit(limit), String(limit)).toBe(false);
        }
    });
});
