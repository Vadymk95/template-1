import { QueryClient } from '@tanstack/react-query';

import type { ApiError } from './api/client';

// staleTime: how long until data is considered stale (triggers background refetch)
// gcTime: how long stale/unused data stays in memory before GC
// Rule: gcTime must be >> staleTime to allow serving cached data during refetch
const DEFAULTS = {
    STALE_TIME: 5 * 60 * 1000, // 5 min
    GC_TIME: 30 * 60 * 1000 // 30 min — gives 25 min grace window
} as const;

// Do not retry client errors (4xx) — they will not resolve on retry
const shouldRetry = (failureCount: number, error: unknown): boolean => {
    const apiError = error as ApiError;
    if (typeof apiError.status === 'number' && apiError.status < 500) return false;
    return failureCount < 2;
};

export const createQueryClient = (options?: {
    staleTime?: number;
    gcTime?: number;
    refetchOnWindowFocus?: boolean;
    retry?: number | false;
}) => {
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
