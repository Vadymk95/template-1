import { describe, expect, it } from 'vitest';

import { buildMeasurePlan } from './verify-measure.mjs';

describe('buildMeasurePlan', () => {
    it('with no specs: build only — measuring is not verifying', () => {
        const steps = buildMeasurePlan([]);
        expect(steps.map((s) => s.label)).toEqual(['build']);
        const commands = steps.map((s) => `${s.command} ${s.args.join(' ')}`).join('\n');
        expect(commands).not.toMatch(/lint|coverage|vitest|typecheck|size/);
    });

    it('with specs: appends ONE preview-mode Playwright run on a free port, carrying the spec names', () => {
        const steps = buildMeasurePlan(['e2e/app.spec.ts']);
        const last = steps[steps.length - 1];
        expect(last?.label).toBe('measure e2e');
        expect(last?.env).toEqual({
            PLAYWRIGHT_USE_PREVIEW: '1',
            PORT: process.env.PORT ?? '4173'
        });
        expect(last?.args.join(' ')).toContain('run-on-free-port.mjs');
        expect(last?.args.join(' ')).toContain('npx --no-install playwright test e2e/app.spec.ts');
    });

    it('passes every given spec through, not just the first', () => {
        const steps = buildMeasurePlan(['a.spec.ts', 'b.spec.ts']);
        const last = steps[steps.length - 1];
        expect(last?.args).toContain('a.spec.ts');
        expect(last?.args).toContain('b.spec.ts');
    });
});
