import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { server } from '@/test/server';

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

    it('throws a plain Error on a non-2xx response, carrying the HTTP status', async () => {
        server.use(
            http.get(URL, () => HttpResponse.json({}, { status: 500, statusText: 'Server Error' }))
        );

        const error = await safeFetch(URL, Schema).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(SchemaValidationError);
        expect((error as Error).message).toBe('HTTP 500: Server Error');
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
});
