import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isCrossBrowserEnabled, LAYOUT_SPEC_PATTERN, LAYOUT_SPECS } from './cross-browser';

/**
 * A `testMatch` that matches nothing does not fail — it collects zero tests and reports success. So
 * the pattern is pinned against the real filenames, in BOTH directions: it must match every spec that
 * is meant to run cross-engine, and it must refuse one that is not.
 */
describe('cross-browser spec selection', () => {
    it('matches every spec that is meant to run on all engines', () => {
        for (const spec of LAYOUT_SPECS) {
            expect(LAYOUT_SPEC_PATTERN.test(spec), `${spec} is not selected`).toBe(true);
        }
    });

    it('refuses a spec that is not a layout spec', () => {
        // The accepting direction alone would pass with a pattern of `/\.spec\.ts$/`, which would drag
        // the whole suite onto three engines.
        for (const spec of ['smoke.spec.ts', 'routes.spec.ts', 'content-stress.test.ts']) {
            expect(LAYOUT_SPEC_PATTERN.test(spec), `${spec} should not be selected`).toBe(false);
        }
    });

    it('points at files that exist, so a rename cannot silently empty the selection', () => {
        const candidates = (spec: string) => [
            join(process.cwd(), 'e2e', spec),
            join(process.cwd(), 'e2e', 'dev', spec)
        ];

        for (const spec of LAYOUT_SPECS) {
            expect(
                candidates(spec).some((path) => existsSync(path)),
                `${spec} is listed as a layout spec but no such file exists`
            ).toBe(true);
        }
    });

    it('stays off unless explicitly enabled', () => {
        expect(isCrossBrowserEnabled({})).toBe(false);
        expect(isCrossBrowserEnabled({ CROSS_BROWSER: '' })).toBe(false);
        expect(isCrossBrowserEnabled({ CROSS_BROWSER: '0' })).toBe(false);
        expect(isCrossBrowserEnabled({ CROSS_BROWSER: 'true' })).toBe(false);
        expect(isCrossBrowserEnabled({ CROSS_BROWSER: '1' })).toBe(true);
    });
});
