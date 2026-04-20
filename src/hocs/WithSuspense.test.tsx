import { render, screen, waitFor } from '@testing-library/react';
import { lazy } from 'react';
import { describe, expect, it } from 'vitest';

import { WithSuspense } from './WithSuspense';

const LazyChild = lazy(() =>
    Promise.resolve({
        default: () => <div>Lazy loaded</div>
    })
);

describe('WithSuspense', () => {
    it('shows fallback until the lazy child resolves', async () => {
        render(
            <WithSuspense fallback={<div data-testid="fb">Fallback</div>}>
                <LazyChild />
            </WithSuspense>
        );

        expect(screen.getByTestId('fb')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText('Lazy loaded')).toBeInTheDocument();
        });
    });

    it('matches Suspense behavior for synchronous children', () => {
        render(
            <WithSuspense fallback={<div>Never shown</div>}>
                <span>Sync</span>
            </WithSuspense>
        );
        expect(screen.getByText('Sync')).toBeInTheDocument();
    });
});
