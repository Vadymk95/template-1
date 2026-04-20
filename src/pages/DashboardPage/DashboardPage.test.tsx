import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useUserStore } from '@/store/user/userStore';
import { renderWithProviders } from '@/test/test-utils';

import { DashboardPage } from './DashboardPage';

describe('DashboardPage', () => {
    beforeEach(() => {
        useUserStore.getState().logout();
    });

    afterEach(() => {
        useUserStore.getState().logout();
    });

    it('renders dashboard copy when user is authenticated', () => {
        useUserStore.getState().setUser('alice', 'mock-token');
        renderWithProviders(
            <MemoryRouter>
                <DashboardPage />
            </MemoryRouter>
        );

        expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    });
});
