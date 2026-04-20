/**
 * First real TanStack Query module — mirrors the pattern captured in
 * `_example.queries.ts`. Consumed by `src/pages/HomePage/useHomePage.ts` and
 * MSW-served via `src/test/handlers.ts`.
 *
 * The `_example.queries.ts` seed stays as the canonical reference so new
 * domains can be scaffolded by copy-paste; this file is the live vertical
 * slice.
 */
import { queryOptions } from '@tanstack/react-query';

import { greetingApi } from './greeting';

export const greetingKeys = {
    all: ['greeting'] as const,
    detail: () => [...greetingKeys.all, 'detail'] as const
};

export const greetingOptions = () =>
    queryOptions({
        queryKey: greetingKeys.detail(),
        queryFn: ({ signal }) => greetingApi.get(signal),
        staleTime: 60_000
    });
