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
const hookCommands = readFileSync('.husky/pre-commit', 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .flatMap((line) => [
        ...line.matchAll(
            /(?:^|[\s!|;&]|if )(node scripts\/[\w.-]+\.mjs|npm run [\w:-]+|npx --no-install [\w-]+)/g
        )
    ])
    .map((match) => match[1]);

// Every check the commit hook runs, and the step of the iterate chain that finds the same refusal first.
// A hook command with no row here fails the last case: add its iterate counterpart, or say why it has none.
const HOOK_COUNTERPART = {
    'npx --no-install lint-staged': null,
    'node scripts/check-test-siblings.mjs': 'node scripts/check-test-siblings.mjs --changed',
    'npm run lint:oxlint': 'npm run lint:oxlint',
    'npm run format:check': 'node scripts/format-changed.mjs',
    'npm run typecheck': 'npm run typecheck',
    'node scripts/docs-trigger.mjs': 'node scripts/docs-trigger.mjs',
    // Only named in the hook's remedy message.
    'npm run fix': null
};

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

    it('checks the siblings of the changed files, the format of the changed files and the docs drift', () => {
        for (const step of [
            'node scripts/check-test-siblings.mjs --changed',
            'node scripts/format-changed.mjs',
            'node scripts/docs-trigger.mjs'
        ]) {
            expect(iterateSteps, step).toContain(step);
            expect(existsSync(step.split(' ')[1]), step).toBe(true);
        }
    });

    it('runs every check the commit hook runs (lint-staged is its autofix, not a check)', () => {
        expect(hookCommands.length).toBeGreaterThan(0);
        for (const command of hookCommands) {
            expect(HOOK_COUNTERPART, `the hook runs "${command}"`).toHaveProperty(command);
            const counterpart = HOOK_COUNTERPART[command];
            if (counterpart !== null) {
                expect(iterateSteps, `counterpart of "${command}"`).toContain(counterpart);
            }
        }
    });
});
