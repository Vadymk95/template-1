import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';

import i18n, { i18nInitPromise } from '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';
import { reportWebVitals } from '@/lib/vitals';
import { router } from '@/router';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element not found');
}

// eslint-disable-next-line react-refresh/only-export-components
const RootProviders = () => {
    const [isI18nReady, setIsI18nReady] = useState(i18n.isInitialized);

    useEffect(() => {
        if (!isI18nReady) {
            // i18n-loading CSS class is removed inside i18n/index.ts init chain.
            // lang attribute is also set there. Only state update needed here.
            void i18nInitPromise.then(() => {
                setIsI18nReady(true);
            });
        }
    }, [isI18nReady]);

    if (!isI18nReady) {
        return null;
    }

    return (
        <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
            </QueryClientProvider>
        </I18nextProvider>
    );
};

createRoot(rootElement).render(
    <StrictMode>
        <RootProviders />
    </StrictMode>
);

// Load lazily — runs after paint, no startup impact
reportWebVitals();
