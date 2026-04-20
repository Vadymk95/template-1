import { describe, expect, it } from 'vitest';

import { router } from '@/router';

describe('router', () => {
    it('creates a browser router with route state', () => {
        expect(router).toBeDefined();
        expect(router.state).toBeDefined();
    });
});
