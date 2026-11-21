// `docs:check` runs at two moments, the commit hook (staged files) and the iterate chain (the working
// tree against HEAD), and the condition for running it is one regular expression in docs-trigger.mjs.
// A second copy of that pattern in a hook or a package script would drift, so these cases read the
// hook and package.json as text and fail when either stops going through the script.
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('one condition, read by the hook and by the iterate chain', () => {
    const hook = readFileSync('.husky/pre-commit', 'utf8');
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    const iterate = scripts['verify:iter:inner'];

    it('the hook runs docs:check through the script, staged', () => {
        expect(hook).toMatch(/node scripts\/docs-trigger\.mjs --staged/);
    });

    it('the iterate chain runs docs:check through the same script', () => {
        expect(iterate.split(/\s+&&\s+/)).toContain('node scripts/docs-trigger.mjs');
    });

    it('neither keeps a pattern of its own', () => {
        expect(hook).not.toMatch(/grep\b[^\n]*(?:md|mdc|gate-tiers)/);
        expect(hook).not.toContain('docs-check\\.');
        expect(iterate).not.toContain('gate-tiers');
        expect(existsSync('scripts/docs-trigger.mjs')).toBe(true);
    });
});
