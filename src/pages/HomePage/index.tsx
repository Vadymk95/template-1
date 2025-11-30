import { useQuery } from '@tanstack/react-query';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_NAMESPACE } from '@/lib/i18n/constants';

const HOME_NAMESPACE = 'home';

export const HomePage: FC = () => {
    const { t } = useTranslation([DEFAULT_NAMESPACE, HOME_NAMESPACE]);
    const { data, isLoading } = useQuery({
        queryKey: ['greeting'],
        queryFn: async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
            return 'Fetched via React Query';
        }
    });

    return (
        <div className="flex flex-col items-center gap-6">
            <header className="text-center">
                <h1 className="text-3xl font-bold mb-2">{t('home:title')}</h1>
                <p className="text-muted-foreground">{t('home:description')}</p>
            </header>

            {isLoading ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {t('common:loading')}
                </p>
            ) : (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {data}
                </p>
            )}
        </div>
    );
};
