import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { createQueryClient } from '@/lib/queryClient';

interface ProvidersProps {
    children: ReactNode;
}

export const renderWithProviders = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) => {
    // Create QueryClient with test-specific options (no retries for faster tests)
    const queryClient = createQueryClient({
        retry: 0,
        refetchOnWindowFocus: false
    });

    const Wrapper = ({ children }: ProvidersProps) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return render(ui, { wrapper: Wrapper, ...options });
};
