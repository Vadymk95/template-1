import { describe, expect, it } from 'vitest';

import { z } from '@/lib/zod';

describe('zod', () => {
    it('runs without its JIT, so the shipped CSP needs no unsafe-eval', () => {
        expect(z.core.globalConfig.jitless).toBe(true);
    });

    it('still validates: the interpreted parser is the same contract', () => {
        const Schema = z.object({ value: z.number() });

        expect(Schema.safeParse({ value: 1 }).success).toBe(true);
        expect(Schema.safeParse({ value: '1' }).success).toBe(false);
    });
});
