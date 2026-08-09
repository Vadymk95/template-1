// Guards the mirror invariant between the coverage excludes in vitest.config.ts and the "!"
// negations in stryker.config.json "mutate". The two lists describe ONE scope — the production
// code the gate measures — and nothing else keeps them equal: a coverage exclude added without
// its "!" twin makes Stryker mutate code the suite never measures (minutes wasted, score
// misleading), while an orphaned "!" silently shrinks the mutation scope below what coverage
// claims to cover.
//
// Unlike the other tests in scripts/, this one reads the LIVE configs on purpose: the repo
// state itself is the subject under test, not the logic around it.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import vitestConfig from '../vitest.config.ts';

// Resolved from the repo root: vitest always runs with cwd at the config root, and inside its
// module runner `import.meta.url` is not a file: URL, so URL-relative resolution cannot work.
const strykerConfig = JSON.parse(readFileSync('stryker.config.json', 'utf8'));

// Classifies one glob into the shared production scope, or null when the pattern is
// test/declaration/config noise that only one of the two tools needs to name (test files,
// *.d.ts declarations, repo-level config globs). Accepts both the plain coverage form and the
// "!"-negated stryker form so the two lists normalise to comparable keys.
const productionScope = (pattern) => {
    const scope = pattern.replace(/^!/, '');
    if (!scope.startsWith('src/')) return null;
    if (/(^|\/)(test|tests|__tests__)\//.test(scope)) return null;
    if (/\.(test|spec)\./.test(scope)) return null;
    if (scope.endsWith('.d.ts')) return null;
    return scope;
};

const coverageScope = vitestConfig.test.coverage.exclude
    .map(productionScope)
    .filter((scope) => scope !== null)
    .sort();

const mutateScope = strykerConfig.mutate
    .filter((pattern) => pattern.startsWith('!'))
    .map(productionScope)
    .filter((scope) => scope !== null)
    .sort();

describe('mutation scope mirrors coverage excludes', () => {
    it('still recognises production entries in the live configs', () => {
        // If normalisation ever classifies everything away, both sets go empty and the two
        // drift tests below stay green forever — fail here instead.
        expect(coverageScope.length).toBeGreaterThan(0);
        expect(mutateScope.length).toBeGreaterThan(0);
    });

    it('negates every production coverage exclude in stryker mutate', () => {
        const missing = coverageScope.filter((scope) => !mutateScope.includes(scope));

        expect(
            missing,
            `vitest coverage excludes production scope(s) [${missing.join(', ')}] that ` +
                `stryker.config.json does not negate — add the matching "!<pattern>" to ` +
                `"mutate", or drop the coverage exclusion`
        ).toEqual([]);
    });

    it('justifies every production stryker negation by a coverage exclude', () => {
        const orphaned = mutateScope.filter((scope) => !coverageScope.includes(scope));

        expect(
            orphaned,
            `stryker.config.json "mutate" negates production scope(s) [${orphaned.join(', ')}] ` +
                `that vitest coverage does not exclude — remove the "!" entry, or add the ` +
                `coverage exclusion`
        ).toEqual([]);
    });
});

describe('productionScope', () => {
    it('keeps src-scoped production files and directories, negated or not', () => {
        expect(productionScope('src/main.tsx')).toBe('src/main.tsx');
        expect(productionScope('!src/components/ui/**')).toBe('src/components/ui/**');
    });

    it('discards test, declaration, config and non-src patterns', () => {
        expect(productionScope('src/test/**')).toBeNull();
        expect(productionScope('!src/**/*.test.*')).toBeNull();
        expect(productionScope('!src/**/*.d.ts')).toBeNull();
        expect(productionScope('**/*.config.{ts,js}')).toBeNull();
    });
});
