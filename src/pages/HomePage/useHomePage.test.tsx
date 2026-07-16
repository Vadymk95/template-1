import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/server';

import { useHomePage } from './useHomePage';

const createWrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }): ReactElement => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return Wrapper;
};

describe('useHomePage', () => {
    it('exposes the greeting once the query resolves', async () => {
        const { result } = renderHook(() => useHomePage(), { wrapper: createWrapper() });

        expect(result.current.isLoading).toBe(true);

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.data).toBe('Hello from MSW');
        expect(result.current.isError).toBe(false);
    });

    it('reports isError when the API fails', async () => {
        server.use(
            http.get('**/api/greeting', () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 })
            )
        );

        const { result } = renderHook(() => useHomePage(), { wrapper: createWrapper() });

        await waitFor(() => {
            expect(result.current.isError).toBe(true);
        });

        expect(result.current.data).toBeUndefined();
    });
});
