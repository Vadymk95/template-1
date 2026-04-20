/**
 * 🌱 TEMPLATE SEED — demonstrative wiring, do NOT delete during refactors.
 *
 * Why it exists:
 *   Canonical reference for how `SUPPORTED_LANGUAGES` drives a language picker
 *   wired to `i18n.changeLanguage`. Keeps the Header demo honest when a second
 *   locale is added later (the control auto-switches from static badge to a
 *   real dropdown based on `SUPPORTED_LANGUAGES.length`).
 *
 * What it demonstrates:
 *   - reading the active language from `useTranslation().i18n`
 *   - gating UI on `SUPPORTED_LANGUAGES` so the control degrades cleanly when
 *     only one locale ships
 *   - accessible label via `t('language.label')`
 *
 * When to delete / replace:
 *   Replace with the product's real language picker (modal, settings page,
 *   flag grid) or remove once i18n is scoped to a single locale permanently.
 *   Update `.cursor/brain/TEMPLATE_SEEDS.md` in the same commit.
 */
import type { ChangeEvent, FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES } from '@/lib/i18n/constants';

export const LanguageSwitcher: FunctionComponent = () => {
    const { i18n, t } = useTranslation('common');
    const current = i18n.resolvedLanguage ?? i18n.language;

    const locales = SUPPORTED_LANGUAGES as readonly string[];

    if (locales.length <= 1) {
        return (
            <span
                className="rounded-md border border-border px-2 py-1 text-xs uppercase text-muted-foreground"
                aria-label={t('language.label')}
            >
                {current}
            </span>
        );
    }

    const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        void i18n.changeLanguage(event.target.value);
    };

    return (
        <label className="inline-flex items-center gap-2 text-sm">
            <span className="sr-only">{t('language.label')}</span>
            <select
                value={current}
                onChange={handleChange}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
                {locales.map((lng) => (
                    <option key={lng} value={lng}>
                        {lng.toUpperCase()}
                    </option>
                ))}
            </select>
        </label>
    );
};
