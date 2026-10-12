// @vitest-environment node
//
// Guards one property of the unit-test config: a focused test (`.only`) must fail the run on a
// developer machine too, not only in CI. Vitest's own default is `allowOnly: !isCI`, so without an
// explicit `false` a stray `.only` skips every other test in its file and the local gate, the
// pre-commit hook and the push gate all stay green; only the first CI run would object.
//
// The config reads `process.env` at import time through the shared Vite config, so each case takes a
// fresh module instance (`vi.resetModules()` plus a re-import), as the Playwright config guard does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCi = process.env.CI;

beforeEach(() => {
    delete process.env.CI;
});

afterEach(() => {
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
});

const importConfig = async () => {
    vi.resetModules();
    const mod = await import('../vitest.config.ts');
    return mod.default;
};

describe('vitest.config.ts allowOnly', () => {
    it('forbids a focused test when CI is unset', async () => {
        const config = await importConfig();

        expect(config.test.allowOnly).toBe(false);
    });

    it('forbids a focused test when CI is set', async () => {
        process.env.CI = 'true';

        const config = await importConfig();

        expect(config.test.allowOnly).toBe(false);
    });
});
