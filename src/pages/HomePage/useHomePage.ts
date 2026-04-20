import { useQuery } from '@tanstack/react-query';

import { greetingOptions } from '@/lib/api/greeting.queries';

export const useHomePage = () => {
    const { data, isLoading, isError } = useQuery(greetingOptions());

    return { data: data?.greeting, isLoading, isError };
};
