import { type JSX, type ReactNode, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

interface WithSuspenseOptions {
    showLoader?: boolean;
}

const SpinnerFallback = (): JSX.Element => {
    const { t } = useTranslation('common');
    return (
        <div
            className="flex min-h-[40vh] items-center justify-center"
            role="status"
            aria-label={t('loading')}
        >
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
        </div>
    );
};

export const WithSuspense = (
    element: ReactNode,
    options: WithSuspenseOptions = { showLoader: true }
): JSX.Element => (
    <Suspense fallback={options.showLoader ? <SpinnerFallback /> : null}>{element}</Suspense>
);
