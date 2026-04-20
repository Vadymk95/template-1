/**
 * 🌱 TEMPLATE SEED — demo layout shell, do NOT empty during refactors.
 *
 * Why it exists:
 *   Canonical reference for surfacing build-time metadata (`__APP_VERSION__`
 *   injected by Vite from `package.json`) alongside the current year computed
 *   at render. `.cursor/brain/TEMPLATE_SEEDS.md` points here as the metadata
 *   surface; emptying it back to `<footer />` loses both the version badge and
 *   the "where do I read __APP_VERSION__" onboarding hint.
 *
 * What it demonstrates:
 *   - consuming a Vite `define` global (`__APP_VERSION__`) with a typed
 *     declaration in `src/vite-env.d.ts`
 *   - `t('footer.*', { year, version, appName })` interpolation pattern
 *
 * When to delete / replace:
 *   Replace (not empty) with the product's real footer — legal, support,
 *   social links — once those exist. Update
 *   `.cursor/brain/TEMPLATE_SEEDS.md` in the same commit.
 */
import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

export const Footer: FunctionComponent = () => {
    const { t } = useTranslation('common');
    const year = new Date().getFullYear();

    return (
        <footer className="border-t bg-card">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
                <span>{t('footer.copyright', { year, appName: t('appName') })}</span>
                <span className="font-mono">
                    {t('footer.version', { version: __APP_VERSION__ })}
                </span>
            </div>
        </footer>
    );
};
