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

const budgetedPaths = () =>
    JSON.parse(readFileSync('.size-limit.json', 'utf8')).map(({ path }) => path);

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
});
