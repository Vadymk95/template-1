import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_NAMESPACE } from '@/lib/i18n/constants';

import { useHomePage } from './useHomePage';

const HOME_NAMESPACE = 'home';

export const HomePage: FunctionComponent = () => {
    const { t } = useTranslation([DEFAULT_NAMESPACE, HOME_NAMESPACE]);
    const { data, isLoading, isError } = useHomePage();

    return (
        <div className="flex flex-col items-center gap-6">
            <header className="text-center">
                <h1 className="mb-2 text-3xl font-bold">{t('home:title')}</h1>
                <p className="text-muted-foreground">{t('home:description')}</p>
            </header>

            {isLoading ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {t('common:loading')}
                </p>
            ) : isError ? (
                <p className="text-sm text-destructive" role="alert">
                    {t('home:greeting.error')}
                </p>
            ) : (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {data}
                </p>
            )}
        </div>
    );
};
