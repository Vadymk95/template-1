import { describe, expect, it } from 'vitest';

import '@/env';
import { z } from '@/lib/zod';

describe('env', () => {
    it('runs zod without its JIT, so the shipped CSP needs no unsafe-eval', () => {
        expect(z.core.globalConfig.jitless).toBe(true);
    });
});
