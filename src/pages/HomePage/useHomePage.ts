import { useQuery } from '@tanstack/react-query';

import { greetingOptions } from '@/lib/api/greeting.queries';

export const useHomePage = (): {
    data: string | undefined;
    isLoading: boolean;
    isError: boolean;
} => {
    const { data, isLoading, isError } = useQuery(greetingOptions());

    return { data: data?.greeting, isLoading, isError };
};
