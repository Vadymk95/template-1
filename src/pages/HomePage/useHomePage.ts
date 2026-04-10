import { useQuery } from '@tanstack/react-query';

interface HomePageData {
    greeting: string;
}

export const useHomePage = () => {
    const { data, isLoading } = useQuery<HomePageData['greeting']>({
        queryKey: ['greeting'],
        queryFn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return 'Fetched via React Query';
        }
    });

    return { data, isLoading };
};
