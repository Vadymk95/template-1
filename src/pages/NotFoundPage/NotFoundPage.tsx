import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

export const NotFoundPage: FunctionComponent = () => {
    const { t } = useTranslation('errors');

    return (
        <section className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
            <p className="text-muted-foreground">{t('notFound.description')}</p>
        </section>
    );
};
