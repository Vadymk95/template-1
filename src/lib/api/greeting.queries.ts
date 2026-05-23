/**
 * First real TanStack Query module — mirrors the pattern captured in
 * `_example.queries.ts`. Consumed by `src/pages/HomePage/useHomePage.ts` and
 * MSW-served via `src/test/handlers.ts`.
 *
 * The `_example.queries.ts` seed stays as the canonical reference so new
 * domains can be scaffolded by copy-paste; this file is the live vertical
 * slice — also the reference for the boundary-validation pattern (see
 * `.cursor/brain/DECISIONS.md` "[2026-05] Boundary validation via Zod
 * safeFetch wrapper" and `src/lib/api/safeFetch.ts`).
 */
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_BASE_URL } from './client';
import { safeFetchQueryFn } from './safeFetch';

// Schema = single source of truth for the response shape. The queryFn return
// type is inferred via `safeFetchQueryFn`'s `z.ZodType<T>` generic — equivalent
// to `z.infer<typeof GreetingSchema>` without an extra alias.
const GreetingSchema = z.object({
    greeting: z.string()
});

export const greetingKeys = {
    all: ['greeting'] as const,
    detail: () => [...greetingKeys.all, 'detail'] as const
};

export const greetingOptions = () =>
    queryOptions({
        queryKey: greetingKeys.detail(),
        queryFn: safeFetchQueryFn(`${API_BASE_URL}/greeting`, GreetingSchema),
        staleTime: 60_000
    });
