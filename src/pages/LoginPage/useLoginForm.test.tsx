import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { FunctionComponent } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/server';
import { renderWithProviders } from '@/test/test-utils';

import { useLoginForm } from './useLoginForm';

// A probe keeps the assertions on the hook's own contract — its validation
// messages and its error mapping — instead of on the LoginPage markup, which
// has its own test.
const Probe: FunctionComponent = () => {
    const { form, onSubmit } = useLoginForm();

    return (
        <form onSubmit={onSubmit}>
            <input aria-label="email" {...form.register('email')} />
            <input aria-label="password" type="password" {...form.register('password')} />
            <p data-testid="email-error">{form.formState.errors.email?.message}</p>
            <p data-testid="password-error">{form.formState.errors.password?.message}</p>
            <p data-testid="root-error">{form.formState.errors.root?.message}</p>
            <button type="submit">go</button>
        </form>
    );
};

const submitCredentials = async (password: string, email = 'nobody@example.com') => {
    const user = userEvent.setup();
    renderWithProviders(
        <MemoryRouter>
            <Probe />
        </MemoryRouter>
    );

    await user.type(screen.getByLabelText('email'), email);
    await user.type(screen.getByLabelText('password'), password);
    await user.click(screen.getByRole('button', { name: 'go' }));
};

describe('useLoginForm validation', () => {
    // These two pin the minimum from both sides. A change to PASSWORD_MIN_LENGTH
    // that forgets the advertised message — the drift this constant exists to
    // prevent — fails the first one.
    it('rejects a password one character below the minimum and names that minimum', async () => {
        await submitCredentials('1234567');

        await waitFor(() => {
            expect(screen.getByTestId('password-error')).toHaveTextContent('At least 8 characters');
        });
    });

    it('accepts a password exactly at the minimum', async () => {
        await submitCredentials('12345678');

        // The request goes out and the API rejects the credentials, which proves
        // validation let it through; the field itself must carry no error.
        await waitFor(() => {
            expect(screen.getByTestId('root-error')).toHaveTextContent(
                'Invalid email or password. Please try again.'
            );
        });
        expect(screen.getByTestId('password-error')).toBeEmptyDOMElement();
    });

    it('rejects a malformed email without calling the API', async () => {
        await submitCredentials('password123', 'not-an-email');

        await waitFor(() => {
            expect(screen.getByTestId('email-error')).toHaveTextContent(
                'Enter a valid email address'
            );
        });
        // No request was made, so no server-side error can have been mapped.
        expect(screen.getByTestId('root-error')).toBeEmptyDOMElement();
    });
});

describe('useLoginForm error mapping', () => {
    it('maps 401 to the invalid-credentials message', async () => {
        // The default MSW handler answers 401 for any unknown credentials.
        await submitCredentials('wrong-password');

        await waitFor(() => {
            expect(screen.getByTestId('root-error')).toHaveTextContent(
                'Invalid email or password. Please try again.'
            );
        });
    });

    it('maps a non-401 failure to the generic api error', async () => {
        server.use(
            http.post('**/api/auth/login', () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 })
            )
        );

        await submitCredentials('wrong-password');

        await waitFor(() => {
            expect(screen.getByTestId('root-error')).toHaveTextContent(
                'An unexpected error occurred.'
            );
        });
    });
});
