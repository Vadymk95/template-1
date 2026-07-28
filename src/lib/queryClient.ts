import { QueryClient } from '@tanstack/react-query';

import type { ApiError } from './api/client';

const MINUTE_MS = 60 * 1000;
const STALE_MINUTES = 5;
const GC_MINUTES = 30;

// A client error will not resolve on retry; a server error might. 500 is the
// floor of the 5xx class, so anything below it is the client's fault.
const HTTP_SERVER_ERROR_FLOOR = 500;

// staleTime: how long until data is considered stale (triggers background refetch)
// gcTime: how long stale/unused data stays in memory before GC
// Rule: gcTime must be >> staleTime to allow serving cached data during refetch
const DEFAULTS = {
    STALE_TIME: STALE_MINUTES * MINUTE_MS,
    GC_TIME: GC_MINUTES * MINUTE_MS // gives a 25 min grace window
} as const;

// Do not retry client errors (4xx) — they will not resolve on retry
const shouldRetry = (failureCount: number, error: unknown): boolean => {
    const apiError = error as ApiError;
    if (typeof apiError.status === 'number' && apiError.status < HTTP_SERVER_ERROR_FLOOR)
        return false;
    return failureCount < 2;
};

export const createQueryClient = (options?: {
    staleTime?: number;
    gcTime?: number;
    refetchOnWindowFocus?: boolean;
    retry?: number | false;
}): QueryClient => {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: options?.staleTime ?? DEFAULTS.STALE_TIME,
                gcTime: options?.gcTime ?? DEFAULTS.GC_TIME,
                retry: options?.retry ?? shouldRetry,
                refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
                refetchOnReconnect: true,
                refetchOnMount: true
            },
            mutations: {
                retry: 0
            }
        }
    });
};

export const queryClient = createQueryClient();
