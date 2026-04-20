import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { RoutesPath } from '@/router/routes';

export const NotFoundPage: FunctionComponent = () => {
    const { t: tErrors } = useTranslation('errors');
    const { t: tCommon } = useTranslation('common');

    return (
        <section className="flex flex-col items-center gap-4 text-center">
            <h1 className="text-2xl font-bold">{tErrors('notFound.title')}</h1>
            <p className="text-muted-foreground">{tErrors('notFound.description')}</p>
            <Link to={RoutesPath.Root}>
                <Button type="button">{tCommon('notFound.goHome')}</Button>
            </Link>
        </section>
    );
};
