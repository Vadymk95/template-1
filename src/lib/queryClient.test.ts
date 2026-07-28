import { describe, expect, it } from 'vitest';

import { createQueryClient } from './queryClient';

const MINUTE_MS = 60 * 1000;

// The retry predicate is not exported; read it back off the client the same way
// TanStack Query does, so the test goes through the public interface.
const retryPredicateOf = (
    client: ReturnType<typeof createQueryClient>
): ((failureCount: number, error: unknown) => boolean) => {
    const { retry } = client.getDefaultOptions().queries ?? {};
    if (typeof retry !== 'function') {
        throw new Error('Expected the default query retry to be a predicate function.');
    }
    return retry as (failureCount: number, error: unknown) => boolean;
};

const withStatus = (status: number): unknown => ({ status });

describe('createQueryClient retry policy', () => {
    it('does not retry the status immediately below the server-error floor', () => {
        // 499 is the boundary case: still a client error, so retrying cannot help.
        expect(retryPredicateOf(createQueryClient())(0, withStatus(499))).toBe(false);
    });

    it('retries the status exactly at the server-error floor', () => {
        expect(retryPredicateOf(createQueryClient())(0, withStatus(500))).toBe(true);
    });

    it('does not retry a plain client error', () => {
        expect(retryPredicateOf(createQueryClient())(0, withStatus(400))).toBe(false);
    });

    it('stops retrying server errors once the failure cap is reached', () => {
        const retry = retryPredicateOf(createQueryClient());

        expect(retry(1, withStatus(503))).toBe(true);
        expect(retry(2, withStatus(503))).toBe(false);
    });

    it('retries an error that carries no numeric status', () => {
        // A network failure has no status; treat it as retryable rather than final.
        expect(retryPredicateOf(createQueryClient())(0, new Error('offline'))).toBe(true);
    });
});

describe('createQueryClient defaults', () => {
    it('keeps gcTime well above staleTime so cached data survives a refetch', () => {
        const { queries } = createQueryClient().getDefaultOptions();

        expect(queries?.staleTime).toBe(5 * MINUTE_MS);
        expect(queries?.gcTime).toBe(30 * MINUTE_MS);
        expect(queries?.gcTime).toBeGreaterThan(queries?.staleTime as number);
    });

    it('lets callers override the cache windows and the retry policy', () => {
        const { queries } = createQueryClient({
            staleTime: 0,
            gcTime: MINUTE_MS,
            retry: false,
            refetchOnWindowFocus: false
        }).getDefaultOptions();

        expect(queries?.staleTime).toBe(0);
        expect(queries?.gcTime).toBe(MINUTE_MS);
        expect(queries?.retry).toBe(false);
        expect(queries?.refetchOnWindowFocus).toBe(false);
    });

    it('never retries mutations by default', () => {
        expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(0);
    });
});
