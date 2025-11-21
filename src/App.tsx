import type { FC } from 'react';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Main } from '@/components/layout/Main';

export const App: FC = () => {
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
