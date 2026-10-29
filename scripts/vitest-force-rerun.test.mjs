// Guards the files that must make `vitest run --changed` run the WHOLE suite: the manifest and the
// runner's own config. `verify:iter` leans on this (`.cursor/brain/VERIFICATION.md` § The four rungs):
// a dirty `package.json` or vitest config can change what every test does, and `--changed` otherwise
// follows the import graph only, which neither file is part of.
//
// The runner's defaults (`**/package.json/**`, `**/{vitest,vite}.config.*/**`) cannot be relied on: the
// config pattern never matches the config file itself, and a `**` never crosses a dot-directory, so a
// checkout under `.worktrees/` matched nothing at all. Measured: with the vitest config dirty,
// `vitest run --changed` ran only the few test files that import it.
import { createRequire } from 'node:module';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The matcher vitest builds its triggers into is picomatch (`pm(forceRerunTriggers)` over absolute
// paths). It is vitest's own dependency, not ours, so it is resolved through vitest: this suite
// judges the implementation the runner uses, and a runner that stopped using it fails loudly here.
const requireFromRoot = createRequire(path.resolve('package.json'));
const requireFromVitest = createRequire(requireFromRoot.resolve('vitest/package.json'));
const picomatch = requireFromVitest('picomatch');

const { default: config, forceRerunTriggersFor } = await import('../vitest.config.ts');

const matcherFor = (root) => picomatch(forceRerunTriggersFor(root));

describe('vitest force-rerun triggers', () => {
    it.each([
        ['a plain checkout', '/home/dev/app'],
        ['a checkout under a dot directory', '/home/dev/.worktrees/app'],
        ['a checkout inside a dot directory two levels down', '/home/.cache/.wt/app'],
        ['a path with glob syntax in it', '/home/dev/my (old) [app] {v2}/app'],
        ['a path with extglob prefixes in it', '/home/dev/a+b@c!d/app'],
        ['a path with wildcards in it', '/home/dev/a*b?c/app']
    ])('fires on package.json and the vitest config in %s', (_label, root) => {
        const matches = matcherFor(root);

        expect(matches(`${root}/package.json`), 'package.json').toBe(true);
        expect(matches(`${root}/vitest.config.ts`), 'vitest.config.ts').toBe(true);
    });

    it('has no entry that matches nothing', () => {
        const root = '/home/dev/.worktrees/app';
        const files = [
            `${root}/package.json`,
            `${root}/vitest.config.ts`,
            `${root}/vite.config.ts`
        ];

        for (const entry of forceRerunTriggersFor(root)) {
            expect(
                files.some((file) => picomatch(entry)(file)),
                entry
            ).toBe(true);
        }
    });

    it('also fires on a vite config and on other extensions of the vitest config', () => {
        const matches = matcherFor('/home/dev/.worktrees/app');

        expect(matches('/home/dev/.worktrees/app/vite.config.ts')).toBe(true);
        expect(matches('/home/dev/.worktrees/app/vitest.config.mts')).toBe(true);
    });

    it('stays anchored at the checkout: no other folder or file name fires it', () => {
        const matches = matcherFor('/home/dev/.worktrees/app');

        expect(matches('/home/dev/.worktrees/other/package.json')).toBe(false);
        expect(matches('/home/dev/.worktrees/app/e2e/package.json')).toBe(false);
        expect(matches('/home/dev/.worktrees/app/package-lock.json')).toBe(false);
        expect(matches('/home/dev/.worktrees/app/src/lib/format.ts')).toBe(false);
    });

    it('is what this repository actually configures, and covers this checkout wherever it lives', () => {
        const matches = picomatch(config.test.forceRerunTriggers ?? []);

        expect(matches(path.resolve('package.json')), 'package.json').toBe(true);
        expect(matches(path.resolve('vitest.config.ts')), 'vitest.config.ts').toBe(true);
    });
});
