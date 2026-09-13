import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/server';
import { renderWithProviders } from '@/test/test-utils';

import { HomePage } from './HomePage';

describe('HomePage', () => {
    it('renders the title as the only h1 and one heading per section', () => {
        renderWithProviders(<HomePage />);

        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
            /a react foundation with the gate already wired/i
        );
        for (const name of [
            /stack check/i,
            /what's inside/i,
            /how work flows/i,
            /agent flow/i,
            /where to read/i,
            /first steps/i
        ]) {
            expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
        }
    });

    it('names every agent command, the one file every tool reads and the first commands to run', () => {
        renderWithProviders(<HomePage />);

        for (const command of ['/onboard', '/feat', '/test', '/review', '/docs']) {
            expect(screen.getByText(command)).toBeInTheDocument();
        }
        expect(screen.getByText('AGENTS.md')).toBeInTheDocument();
        expect(screen.getByText('npm run verify:iter')).toBeInTheDocument();
    });

    it('lists the four moments in order', () => {
        renderWithProviders(<HomePage />);

        expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
            'Iterate',
            'Commit',
            'Push',
            'CI'
        ]);
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
