import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/queryClient';

// Ensure i18next is initialized for tests
if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
        lng: 'en',
        fallbackLng: 'en',
        ns: ['common', 'errors', 'home'],
        defaultNS: 'common',
        resources: {
            en: {
                common: {
                    loading: 'Loading...'
                },
                home: {
                    title: 'Welcome',
                    description: 'This is your enterprise-grade React template'
                },
                errors: {}
            }
        },
        interpolation: {
            escapeValue: false
        },
        react: {
            useSuspense: false
        }
    });
}

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
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </I18nextProvider>
    );

    return render(ui, { wrapper: Wrapper, ...options });
};
