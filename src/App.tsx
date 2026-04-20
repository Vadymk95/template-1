import type { FunctionComponent } from 'react';
import { ScrollRestoration } from 'react-router-dom';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Main } from '@/components/layout/Main';
import { useI18nReload } from '@/hooks/i18n/useI18nReload';

export const App: FunctionComponent = () => {
    // Hot reload translations in development mode
    useI18nReload();

    return (
        <ErrorBoundary>
            <ScrollRestoration getKey={(location) => location.pathname} />
            <div className="flex min-h-screen flex-col">
                <Header />
                <Main />
                <Footer />
            </div>
        </ErrorBoundary>
    );
};
