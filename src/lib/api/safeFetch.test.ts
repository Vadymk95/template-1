import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createQueryClient } from '@/lib/queryClient';
import { server } from '@/test/server';

import { ApiError } from './client';
import { safeFetch, safeFetchQueryFn, SchemaValidationError } from './safeFetch';

const URL = 'https://safe-fetch.e2e-test/probe';
const Schema = z.object({ value: z.number() });

describe('safeFetch', () => {
    it('returns the parsed data when the response matches the schema', async () => {
        server.use(http.get(URL, () => HttpResponse.json({ value: 42 })));

        await expect(safeFetch(URL, Schema)).resolves.toEqual({ value: 42 });
    });

    it('throws SchemaValidationError when the response does not match the schema', async () => {
        server.use(http.get(URL, () => HttpResponse.json({ value: 'not-a-number' })));

        const error = await safeFetch(URL, Schema).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SchemaValidationError);
        expect((error as SchemaValidationError).url).toBe(URL);
        expect((error as SchemaValidationError).issues.length).toBeGreaterThan(0);
    });

    it('throws an ApiError carrying the HTTP status on a non-2xx response', async () => {
        server.use(
            http.get(URL, () => HttpResponse.json({}, { status: 500, statusText: 'Server Error' }))
        );

        const error = await safeFetch(URL, Schema).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).not.toBeInstanceOf(SchemaValidationError);
        expect((error as ApiError).status).toBe(500);
        expect((error as ApiError).message).toBe('HTTP 500: Server Error');
    });
});

describe('safeFetchQueryFn', () => {
    it('re-throws AbortError unchanged so TanStack Query treats it as cancellation', async () => {
        const controller = new AbortController();
        controller.abort();

        const queryFn = safeFetchQueryFn(URL, Schema);
        let error: unknown;
        try {
            await queryFn({ signal: controller.signal } as Parameters<typeof queryFn>[0]);
        } catch (caught) {
            error = caught;
        }

        expect((error as DOMException).name).toBe('AbortError');
    });

    // `retryDelay: 0` only shortens the wait; the retry decision still comes from the
    // default `shouldRetry` of `createQueryClient`, which is what these two cases probe.
    const fetchThroughDefaultClient = async (status: number): Promise<number> => {
        let requests = 0;
        server.use(
            http.get(URL, () => {
                requests += 1;
                return HttpResponse.json({}, { status });
            })
        );

        await createQueryClient()
            .query({
                queryKey: ['safe-fetch-retry', status],
                queryFn: safeFetchQueryFn(URL, Schema),
                retryDelay: 0
            })
            .catch(() => undefined);

        return requests;
    };

    it('is requested exactly once when the response is a 4xx, because a client error will not heal', async () => {
        expect(await fetchThroughDefaultClient(404)).toBe(1);
    });

    it('is still retried up to the cap when the response is a 5xx', async () => {
        expect(await fetchThroughDefaultClient(503)).toBe(3);
    });
});
