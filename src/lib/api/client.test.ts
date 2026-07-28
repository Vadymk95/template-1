import { http, HttpResponse, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { useUserStore } from '@/store/user/userStore';
import { server } from '@/test/server';

import { API_BASE_URL, ApiError, apiClient } from './client';

const ENDPOINT = '/probe';
const url = `${API_BASE_URL}${ENDPOINT}`;

const respondWith = (body: JsonBodyType, status: number): void => {
    server.use(http.get(url, () => HttpResponse.json(body, { status })));
};

afterEach(() => {
    useUserStore.getState().logout();
});

describe('apiClient error mapping', () => {
    it('throws an ApiError carrying the response status', async () => {
        respondWith({ message: 'nope' }, 403);

        await expect(apiClient(ENDPOINT)).rejects.toBeInstanceOf(ApiError);
        await expect(apiClient(ENDPOINT)).rejects.toMatchObject({ status: 403, message: 'nope' });
    });

    it('reads the message from a nested error object', async () => {
        respondWith({ error: { message: 'nested detail' } }, 422);

        await expect(apiClient(ENDPOINT)).rejects.toMatchObject({ message: 'nested detail' });
    });

    it('reads the message from a flat error string', async () => {
        respondWith({ error: 'flat detail' }, 400);

        await expect(apiClient(ENDPOINT)).rejects.toMatchObject({ message: 'flat detail' });
    });

    it('falls back to the status line when the body carries no usable message', async () => {
        // An empty object parses fine but yields nothing to extract, so the
        // fallback chain has to produce a message rather than `undefined`.
        respondWith({}, 500);

        const error = await apiClient(ENDPOINT).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).message).not.toBe('');
        expect((error as ApiError).message).toMatch(/500|Internal Server Error/i);
    });

    it('still produces a message when the body is not JSON at all', async () => {
        // This is the branch a default initialiser used to shadow: response.json()
        // rejects, and the catch must supply the message on its own.
        server.use(http.get(url, () => new HttpResponse('<html>502</html>', { status: 502 })));

        const error = await apiClient(ENDPOINT).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(502);
        expect((error as ApiError).message).not.toBe('');
    });
});

describe('apiClient request shape', () => {
    it('omits the Authorization header while no token is stored', async () => {
        let seen: string | null = 'unset';
        server.use(
            http.get(url, ({ request }) => {
                seen = request.headers.get('authorization');
                return HttpResponse.json({ ok: true });
            })
        );

        await apiClient(ENDPOINT);

        expect(seen).toBeNull();
    });

    it('sends the stored token as a bearer credential', async () => {
        useUserStore.getState().setUser('Test User', 'token-123');

        let seen: string | null = null;
        server.use(
            http.get(url, ({ request }) => {
                seen = request.headers.get('authorization');
                return HttpResponse.json({ ok: true });
            })
        );

        await apiClient(ENDPOINT);

        expect(seen).toBe('Bearer token-123');
    });

    it('returns the parsed body on success', async () => {
        server.use(http.get(url, () => HttpResponse.json({ value: 42 })));

        await expect(apiClient<{ value: number }>(ENDPOINT)).resolves.toEqual({ value: 42 });
    });
});
