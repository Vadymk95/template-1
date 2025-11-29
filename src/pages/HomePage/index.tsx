import { useQuery } from '@tanstack/react-query';
import type { FC } from 'react';

export const HomePage: FC = () => {
    const { data, isLoading } = useQuery({
        queryKey: ['greeting'],
        queryFn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return 'Fetched via React Query';
        }
    });

    return (
        <div className="flex flex-col items-center gap-6">
            <header className="text-center">
                <h1 className="text-3xl font-bold mb-2">Hello World</h1>
                <p className="text-muted-foreground">
                    Minimal template bundled with Tailwind & shadcn/ui
                </p>
            </header>

            {isLoading ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    Loading...
                </p>
            ) : (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {data}
                </p>
            )}
        </div>
    );
};
