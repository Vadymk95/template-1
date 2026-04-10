import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/server';
import { renderWithProviders } from '@/test/test-utils';

import { LoginPage } from './LoginPage';

const renderLoginPage = () =>
    renderWithProviders(
        <MemoryRouter>
            <LoginPage />
        </MemoryRouter>
    );

describe('LoginPage', () => {
    it('renders the login form', () => {
        renderLoginPage();

        expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows validation errors when submitted empty', async () => {
        const user = userEvent.setup();
        renderLoginPage();

        await user.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findAllByRole('alert')).toHaveLength(2);
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });

    it('shows email format error for invalid email', async () => {
        const user = userEvent.setup();
        renderLoginPage();

        await user.type(screen.getByLabelText(/email address/i), 'notanemail');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    });

    it('shows password length error for short password', async () => {
        const user = userEvent.setup();
        renderLoginPage();

        await user.type(screen.getByLabelText(/email address/i), 'user@example.com');
        await user.type(screen.getByLabelText(/password/i), 'short');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    });

    it('shows API error on 401 response', async () => {
        const user = userEvent.setup();
        // Override default handler to return 401 for any credentials
        server.use(
            http.post('**/api/auth/login', () =>
                HttpResponse.json({ message: 'Invalid credentials' }, { status: 401 })
            )
        );

        renderLoginPage();
        await user.type(screen.getByLabelText(/email address/i), 'wrong@example.com');
        await user.type(screen.getByLabelText(/password/i), 'wrongpassword');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    });

    it('submits with valid credentials', async () => {
        const user = userEvent.setup();
        renderLoginPage();

        await user.type(screen.getByLabelText(/email address/i), 'test@example.com');
        await user.type(screen.getByLabelText(/password/i), 'password123');
        await user.click(screen.getByRole('button', { name: /sign in/i }));

        // No error alerts after successful submission
        await waitFor(() => {
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });
    });
});
