import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

export const SkipLink: FunctionComponent = () => {
    const { t } = useTranslation('common');

    return (
        <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow focus:ring-2 focus:ring-ring focus:outline-none"
        >
            {t('skipToMain')}
        </a>
    );
};
