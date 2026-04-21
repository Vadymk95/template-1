/**
 * 🌱 TEMPLATE SEED — do NOT delete during refactors.
 *
 * Why it exists:
 *   Canonical reference for the TanStack Query pattern in this stack.
 *   `.cursor/brain/MAP.md` and `.cursor/brain/PROJECT_CONTEXT.md` point here by name —
 *   removing it silently breaks the agent contract for "how to add a new feature".
 *
 * What it demonstrates:
 *   - stable key factory (`exampleKeys`)
 *   - typed `queryOptions()` factories consumed via `useQuery(detailOptions(id))`
 *   - cancellation via request signal
 *
 * When to delete:
 *   Only when this repo graduates from "template" to a real MVP AND
 *   at least one real `<domain>.queries.ts` exists. Update `.cursor/brain/TEMPLATE_SEEDS.md`
 *   in the same commit.
 *
 * Leading underscore signals "reference, not wired into routes".
 * See `.cursor/brain/TEMPLATE_SEEDS.md` for the full seed registry.
 */
import { queryOptions } from '@tanstack/react-query';

export type ExampleFilters = Record<string, string | number | boolean | undefined>;

export const exampleKeys = {
    all: ['example'] as const,
    lists: () => [...exampleKeys.all, 'list'] as const,
    list: (filters: ExampleFilters) => [...exampleKeys.lists(), filters] as const,
    details: () => [...exampleKeys.all, 'detail'] as const,
    detail: (id: string) => [...exampleKeys.details(), id] as const
};

const fetchExample = async (id: string, signal?: AbortSignal): Promise<{ id: string }> => {
    void signal;
    return Promise.resolve({ id });
};

export const exampleDetailOptions = (id: string) =>
    queryOptions({
        queryKey: exampleKeys.detail(id),
        queryFn: ({ signal }) => fetchExample(id, signal),
        staleTime: 60_000
    });
