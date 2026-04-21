import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';

import { I18nInitErrorFallback } from '@/components/common/I18nInitErrorFallback';
import i18n, { i18nInitPromise } from '@/lib/i18n';
import { logger } from '@/lib/logger';
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
    const [i18nInitError, setI18nInitError] = useState<Error | null>(null);

    useEffect(() => {
        let cancelled = false;

        void i18nInitPromise
            .then(() => {
                if (!cancelled) {
                    setIsI18nReady(true);
                }
            })
            .catch((error: unknown) => {
                if (cancelled) {
                    return;
                }
                document.documentElement.classList.remove('i18n-loading');
                logger.error('[i18n] Failed to initialize i18next', {
                    reason: error instanceof Error ? error.message : String(error)
                });
                setI18nInitError(error instanceof Error ? error : new Error(String(error)));
            });

        return () => {
            cancelled = true;
        };
    }, []);

    if (i18nInitError) {
        return <I18nInitErrorFallback />;
    }

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

const root = createRoot(rootElement, {
    onCaughtError: (error, errorInfo) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[react]', {
            source: 'react-caught',
            message,
            stack: error instanceof Error ? error.stack : undefined,
            componentStack: errorInfo.componentStack
        });
    },
    onUncaughtError: (error, errorInfo) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('[react]', {
            source: 'react-uncaught',
            message,
            stack: error instanceof Error ? error.stack : undefined,
            componentStack: errorInfo.componentStack
        });
    }
});

const startApp = async () => {
    const isMswEnabled = import.meta.env.VITE_ENABLE_MSW !== 'false';

    if (import.meta.env.DEV && isMswEnabled) {
        try {
            const { worker } = await import('@/mocks/browser');
            await worker.start({
                onUnhandledRequest: 'bypass'
            });
        } catch (error: unknown) {
            logger.error('[msw] Failed to start browser worker', {
                reason: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }

    root.render(
        <StrictMode>
            <RootProviders />
        </StrictMode>
    );

    reportWebVitals();
};

void startApp();
