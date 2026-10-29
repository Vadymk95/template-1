import { describe, expect, it, vi } from 'vitest';

// `mockReset` in `vitest.config.ts` returns every mock to the implementation it was created with, and
// clears its calls, before each test. Both runs below start from that state and then dirty it, so the
// later run fails whenever the reset is missing, whichever order the runner uses.
const shared = vi.fn(() => 'original');

describe('a mock between tests', () => {
    it.each([1, 2])('starts from its own implementation with no calls (run %i)', () => {
        expect(shared).not.toHaveBeenCalled();
        expect(shared()).toBe('original');

        shared.mockReturnValue('changed');

        expect(shared()).toBe('changed');
    });
});
