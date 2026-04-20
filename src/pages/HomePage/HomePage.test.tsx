import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/server';
import { renderWithProviders } from '@/test/test-utils';

import { HomePage } from './HomePage';

describe('HomePage', () => {
    it('renders heading', () => {
        renderWithProviders(<HomePage />);

        expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
    });

    it('displays loading state and then the greeting fetched via TanStack Query + MSW', async () => {
        renderWithProviders(<HomePage />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading...');

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('Hello from MSW');
        });
    });

    it('shows translated error copy when the greeting request fails', async () => {
        server.use(
            http.get('**/api/greeting', () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 })
            )
        );

        renderWithProviders(<HomePage />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(/could not load greeting/i);
        });
    });
});
