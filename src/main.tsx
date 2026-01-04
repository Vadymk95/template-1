import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';

import i18n, { i18nInitPromise } from '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';
import { router } from '@/router';
import './index.css';

if (typeof document !== 'undefined') {
    document.documentElement.classList.add('i18n-loading');
}

i18nInitPromise.then(() => {
    const rootElement = document.getElementById('root');
    if (!rootElement) return;

    createRoot(rootElement).render(
        <StrictMode>
            <I18nextProvider i18n={i18n}>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                </QueryClientProvider>
            </I18nextProvider>
        </StrictMode>
    );
});
