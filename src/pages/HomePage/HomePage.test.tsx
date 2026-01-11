import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { HomePage } from './index';

describe('HomePage', () => {
    it('renders heading', () => {
        renderWithProviders(<HomePage />);

        expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
    });

    it('displays loading state and then fetched data', async () => {
        renderWithProviders(<HomePage />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading...');

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('Fetched via React Query');
        });
    });
});
