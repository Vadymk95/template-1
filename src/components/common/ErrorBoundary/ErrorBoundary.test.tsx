import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { ErrorBoundary } from './index';

const Bomb = () => {
    throw new Error('Boom');
};

describe('ErrorBoundary', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('renders fallback UI when child throws', () => {
        renderWithProviders(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
        expect(screen.getByText(/we encountered an unexpected error/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument();
    });

    it('calls window.location.reload when "Reload page" is clicked', async () => {
        const user = userEvent.setup();
        const reloadMock = vi.fn();

        // jsdom marks location.reload as non-configurable — vi.stubGlobal is the correct escape hatch
        vi.stubGlobal('location', { reload: reloadMock });

        renderWithProviders(
            <ErrorBoundary>
                <Bomb />
            </ErrorBoundary>
        );

        await user.click(screen.getByRole('button', { name: /reload page/i }));

        expect(reloadMock).toHaveBeenCalledOnce();
        vi.unstubAllGlobals();
    });
});
