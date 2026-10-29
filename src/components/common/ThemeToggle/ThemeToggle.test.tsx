import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import commonTranslations from '@locales/en/common.json';

import { ThemeToggle } from './index';

const { theme: names } = commonTranslations;

const labelFor = (theme: 'light' | 'dark' | 'system'): string => `${names.label}: ${names[theme]}`;

describe('ThemeToggle', () => {
    beforeEach(() => {
        localStorage.clear();
        // `useTheme` reads `matchMedia`; jsdom does not implement it.
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
        document.documentElement.classList.remove('dark');
    });

    it('names the current theme in its accessible label', () => {
        renderWithProviders(<ThemeToggle />);

        expect(screen.getByRole('button', { name: labelFor('system') })).toBeInTheDocument();
    });

    it('steps through light, dark and system, then wraps around to light', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ThemeToggle />);

        const expectedAfterEachClick = ['light', 'dark', 'system', 'light'] as const;
        for (const theme of expectedAfterEachClick) {
            await user.click(screen.getByRole('button'));
            expect(screen.getByRole('button', { name: labelFor(theme) })).toBeInTheDocument();
        }
    });
});
