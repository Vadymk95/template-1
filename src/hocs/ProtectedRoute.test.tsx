import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useUserStore } from '@/store/user/userStore';

import { ProtectedRoute } from './ProtectedRoute';

const buildRouter = (initialPath: string) =>
    createMemoryRouter(
        [
            { path: '/login', element: <div>Login page</div> },
            {
                element: <ProtectedRoute />,
                children: [
                    { path: '/', element: <div>Protected content</div> },
                    { path: '/dashboard', element: <div>Dashboard</div> }
                ]
            }
        ],
        { initialEntries: [initialPath] }
    );

describe('ProtectedRoute', () => {
    beforeEach(() => {
        useUserStore.getState().logout();
    });

    afterEach(() => {
        useUserStore.getState().logout();
    });

    it('redirects to /login when not authenticated', () => {
        render(<RouterProvider router={buildRouter('/')} />);
        expect(screen.getByText('Login page')).toBeInTheDocument();
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('renders protected content when authenticated', () => {
        useUserStore.getState().setUser('alice', 'mock-token');
        render(<RouterProvider router={buildRouter('/')} />);
        expect(screen.getByText('Protected content')).toBeInTheDocument();
        expect(screen.queryByText('Login page')).not.toBeInTheDocument();
    });

    it('redirects deep-link to nested protected path when unauthenticated', () => {
        render(<RouterProvider router={buildRouter('/dashboard')} />);
        expect(screen.getByText('Login page')).toBeInTheDocument();
        expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });

    it('renders nested protected path when authenticated on deep-link', () => {
        useUserStore.getState().setUser('alice', 'mock-token');
        render(<RouterProvider router={buildRouter('/dashboard')} />);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.queryByText('Login page')).not.toBeInTheDocument();
    });
});
