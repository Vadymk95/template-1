import { screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { App } from './App';

const Bomb = () => {
    throw new Error('Boom');
};

describe('App', () => {
    beforeEach(() => {
        // ThemeToggle (rendered inside Header) reads useTheme, which reads matchMedia; jsdom lacks it.
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                matches: false,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn()
            }))
        );
        // useI18nReload's HMR wiring only exists under the real Vite dev server; Vitest exposes a
        // partial `import.meta.hot` (has `on`, lacks `off`) — see useI18nReload.test.ts. Forcing
        // DEV false keeps this test about the error boundary, not that unrelated, already-documented gap.
        vi.stubEnv('DEV', false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('shows the error-boundary fallback when a routed child throws', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // The real App, wired the way the production router wires it: App is the root route
        // element and the throwing page sits behind its own <Outlet/>, exactly where a real page
        // would throw.
        const router = createMemoryRouter(
            [
                {
                    path: '/',
                    element: <App />,
                    children: [{ index: true, element: <Bomb /> }]
                }
            ],
            { initialEntries: ['/'] }
        );

        renderWithProviders(<RouterProvider router={router} />);

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();

        consoleErrorSpy.mockRestore();
    });
});
