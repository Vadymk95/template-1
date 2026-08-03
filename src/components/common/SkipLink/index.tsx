import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

export const SkipLink: FunctionComponent = () => {
    const { t } = useTranslation('common');

    return (
        <a
            href="#main"
            // `outline-hidden` rather than `outline-none`: the ring is a box-shadow and
            // `forced-colors: active` suppresses it, so `outline-none` would leave the skip link — the
            // first thing a keyboard user reaches — with no visible focus at all. See `button.tsx`.
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-sm focus:ring-2 focus:ring-ring focus:outline-hidden"
        >
            {t('skipToMain')}
        </a>
    );
};
