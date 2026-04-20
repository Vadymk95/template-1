/**
 * First real domain transport module — lives here to mirror the canonical
 * pattern captured in `_example.ts`. Consumed by `src/lib/api/greeting.queries.ts`.
 *
 * When the app adds its second domain, copy this file (NOT the `_example.ts`
 * seed) — real modules drift with the codebase, seeds intentionally do not.
 */
import { apiClient } from './client';

export interface Greeting {
    greeting: string;
}

export const greetingApi = {
    get: (signal?: AbortSignal): Promise<Greeting> => apiClient<Greeting>('/greeting', { signal })
};
