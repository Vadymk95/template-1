import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseVerifySteps } from './bench-verify.mjs';

// `process.cwd()` rather than `import.meta.url`: under Vitest the module URL is not a `file:` URL, so
// resolving relative to it throws. The script itself runs under plain node and uses the URL form.
const verifyScript = () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return manifest.scripts.verify;
};

/**
 * The point of these is that the benchmark's step list cannot drift from the gate. The previous
 * hand-written list had already lost two steps while its own header claimed they matched.
 */
describe('parseVerifySteps', () => {
    it('covers every step of the real verify script', () => {
        const script = verifyScript();
        const steps = parseVerifySteps(script);

        // One step per `&&` segment: nothing dropped, nothing invented.
        expect(steps).toHaveLength(script.split('&&').length);
        for (const step of steps) {
            expect(step.label).not.toBe('');
        }
    });

    it('includes the steps the hand-written list used to omit', () => {
        const labels = parseVerifySteps(verifyScript()).map((step) => step.label);

        expect(labels).toContain('check-hooks');
        expect(labels).toContain('ensure-playwright');
    });

    it('labels an npm step by its script name and a node step by its file', () => {
        expect(parseVerifySteps('npm run typecheck && node scripts/check-hooks.mjs')).toEqual([
            { label: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
            { label: 'check-hooks', command: 'node', args: ['scripts/check-hooks.mjs'] }
        ]);
    });

    it('throws on a shape it does not know, rather than skipping the step', () => {
        // Skipping is the failure that produced this file: a step absent from the benchmark is a step
        // nobody knows is slow, and the run still reports success.
        expect(() => parseVerifySteps('npm run lint && VITE_X=1 vitest run')).toThrow(
            /cannot parse verify step/
        );
        expect(() => parseVerifySteps('npm run')).toThrow(/cannot parse verify step/);
    });

    it('ignores empty segments from a trailing separator', () => {
        expect(parseVerifySteps('npm run lint &&  ')).toHaveLength(1);
    });
});
