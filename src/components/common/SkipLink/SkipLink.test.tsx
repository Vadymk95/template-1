import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { SkipLink } from './index';

describe('SkipLink', () => {
    it('points at the main landmark and stays reachable by keyboard only', () => {
        renderWithProviders(<SkipLink />);
        const link = screen.getByRole('link', { name: /skip to main content/i });

        expect(link).toHaveAttribute('href', '#main');
        // `sr-only` until focused: visible to a keyboard user, out of the way for everyone else.
        expect(link.className).toContain('sr-only');
        expect(link.className).toContain('focus:not-sr-only');
    });

    it('keeps a focus indicator under forced colours', () => {
        // The skip link is the FIRST thing a keyboard user reaches. Its ring is a box-shadow, which
        // `forced-colors: active` suppresses, so `outline-none` would leave it with no visible focus.
        // See `src/components/ui/focus-indicator.test.tsx` for the compiled evidence.
        renderWithProviders(<SkipLink />);
        const className = screen.getByRole('link', { name: /skip to main content/i }).className;

        expect(className).toContain('focus:outline-hidden');
        expect(className).not.toContain('focus:outline-none');
        expect(className).toContain('focus:ring-2');
    });
});
