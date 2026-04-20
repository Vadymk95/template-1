import type { FunctionComponent } from 'react';
import { useRef } from 'react';
import { ScrollRestoration } from 'react-router-dom';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { SkipLink } from '@/components/common/SkipLink';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { Main } from '@/components/layout/Main';
import { useRouteFocus } from '@/hooks/a11y/useRouteFocus';
import { useI18nReload } from '@/hooks/i18n/useI18nReload';

export const App: FunctionComponent = () => {
    // Hot reload translations in development mode
    useI18nReload();

    const mainRef = useRef<HTMLElement>(null);
    useRouteFocus(mainRef);

    return (
        <ErrorBoundary>
            <SkipLink />
            <ScrollRestoration getKey={(location) => location.pathname} />
            <div className="flex min-h-screen flex-col">
                <Header />
                <Main ref={mainRef} />
                <Footer />
            </div>
        </ErrorBoundary>
    );
};
