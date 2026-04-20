import { queryOptions } from '@tanstack/react-query';

/** Example filters — replace when copying this pattern into a real feature module. */
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

/** Reference template — not imported by app code; safe to delete when real queries exist. */
export const exampleDetailOptions = (id: string) =>
    queryOptions({
        queryKey: exampleKeys.detail(id),
        queryFn: ({ signal }) => fetchExample(id, signal),
        staleTime: 60_000
    });
