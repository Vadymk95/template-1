import type { FC } from 'react';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Main } from '@/components/layout/Main';
import { useI18nReload } from '@/hooks/i18n/useI18nReload';

export const App: FC = () => {
    // Hot reload translations in development mode
    useI18nReload();

    return (
        <ErrorBoundary>
            <div className="flex min-h-screen flex-col">
                <Header />
                <Main />
                <Footer />
            </div>
        </ErrorBoundary>
    );
};
