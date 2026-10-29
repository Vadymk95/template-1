// The iterate chain is data in package.json (`verify:iter:inner`), and docs:check keeps its readable view in
// gate-tiers.json equal to it. Nothing says WHICH stages it has to hold, so a stage dropped from both stays
// consistent and silent. Two were once missing, each for a reason that is easy to forget:
//   - ESLint on the changed files: oxlint has no types, so type-aware findings reached the commit hook first;
//   - the mutation-scope test by name: it reads `stryker.config.json` as text, nothing imports that file, so
//     `--changed` never selects the test for an edit of the config alone.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
const iterateSteps = scripts['verify:iter:inner'].split(/\s+&&\s+/);

describe('the iterate chain', () => {
    it('lints the changed files with ESLint, after the type check', () => {
        const lint = iterateSteps.indexOf('node scripts/lint-changed.mjs');

        expect(lint, 'node scripts/lint-changed.mjs').toBeGreaterThan(-1);
        expect(lint).toBeGreaterThan(iterateSteps.indexOf('npm run typecheck'));
        expect(existsSync('scripts/lint-changed.mjs')).toBe(true);
    });

    it('runs the mutation-scope test by name, because `--changed` never selects it', () => {
        const scope = 'scripts/mutation-scope.test.mjs';

        expect(iterateSteps).toContain(`vitest run ${scope}`);
        expect(existsSync(scope)).toBe(true);
    });
});
