import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import commonTranslations from '@locales/en/common.json';

import { Footer } from './index';

describe('Footer', () => {
    it('is the page contentinfo landmark', () => {
        renderWithProviders(<Footer />);

        expect(screen.getByRole('contentinfo')).toBeVisible();
    });

    it('states the copyright for the current year next to the app name', () => {
        renderWithProviders(<Footer />);
        // Computed from the clock: a literal year would pass today and fail on 1 January.
        const year = String(new Date().getFullYear());

        expect(screen.getByText(`© ${year} ${commonTranslations.appName}`)).toBeVisible();
    });

    it('shows the build version that Vite injects as __APP_VERSION__', () => {
        renderWithProviders(<Footer />);

        // The `define` is the contract: without it the render throws a ReferenceError, and an empty
        // value would print a bare "v".
        expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
        expect(screen.getByText(`v${__APP_VERSION__}`)).toBeVisible();
    });
});
