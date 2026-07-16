import { describe, expect, it } from 'vitest';

import { cn } from './utils';

describe('cn', () => {
    it('joins values and drops falsy conditionals', () => {
        expect(cn('base', undefined, false, 'extra')).toBe('base extra');
    });

    it('lets the last conflicting Tailwind utility win', () => {
        expect(cn('p-2', 'p-4')).toBe('p-4');
    });

    it('keeps non-conflicting utilities intact', () => {
        expect(cn('p-2', 'text-sm')).toBe('p-2 text-sm');
    });
});
