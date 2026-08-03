import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import commonTranslations from '@locales/en/common.json';

import { Header } from './index';

/**
 * jsdom cannot measure a box, so the real guard for this component is
 * `e2e/layout-geometry.spec.ts`, which measures the header on every route at five widths. What these
 * pin is the class contract that guard depends on, so a regression fails in a second instead of in a
 * full production e2e run.
 */
const renderHeader = () =>
    renderWithProviders(
        <MemoryRouter>
            <Header />
        </MemoryRouter>
    );

describe('Header', () => {
    beforeEach(() => {
        // `ThemeToggle` reads `useTheme`, which reads `matchMedia`; jsdom does not implement it.
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }))
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the brand, the navigation and the auth control', () => {
        renderHeader();

        expect(screen.getByRole('link', { name: commonTranslations.appName })).toBeVisible();
        expect(screen.getByRole('link', { name: /^home$/i })).toBeVisible();
        expect(screen.getByRole('link', { name: /dashboard/i })).toBeVisible();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeVisible();
    });

    it('lets the chrome row wrap, because a row that cannot wrap can only overflow', () => {
        // Measured before `flex-wrap` existed: at a 390px viewport the three groups summed wider than
        // the row and the DOCUMENT scrolled horizontally by 28px, on every route.
        const { container } = renderHeader();
        const row = container.querySelector('header > div');

        expect(row).toHaveClass('flex-wrap');
    });

    it('gives every navigation link the touch height', () => {
        renderHeader();

        for (const name of [/^home$/i, /dashboard/i]) {
            const link = screen.getByRole('link', { name });
            expect(link.className, `${link.textContent} lost its touch row`).toContain('min-h-11');
            // `min-h-11` is ignored on an inline box; the display mode is half the guard.
            expect(link.className).toContain('inline-flex');
        }
    });

    it('truncates a long brand name on an inner element, not on the flex container', () => {
        renderHeader();

        const brand = screen.getByRole('link', { name: commonTranslations.appName });
        expect(brand.className).toContain('min-w-0');
        expect(brand.className).not.toContain('truncate');
        expect(brand.firstElementChild).toHaveClass('truncate');
    });
});
