import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { logger } from '@/lib/logger';

import { RouteErrorBoundary } from './index';

describe('RouteErrorBoundary', () => {
    it('renders recoverable UI when a route loader throws a Response', async () => {
        const logSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

        const router = createMemoryRouter(
            [
                {
                    path: '/',
                    loader: () => {
                        // eslint-disable-next-line @typescript-eslint/only-throw-error -- route loaders throw Response for HTTP errors
                        throw new Response('Bad', { status: 502, statusText: 'Bad Gateway' });
                    },
                    element: <div>Home</div>,
                    errorElement: <RouteErrorBoundary />
                }
            ],
            { initialEntries: ['/'] }
        );

        render(<RouterProvider router={router} />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
        expect(screen.getByText(/502/)).toBeInTheDocument();

        logSpy.mockRestore();
    });
});
