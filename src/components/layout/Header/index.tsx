/**
 * 🌱 TEMPLATE SEED — demo layout shell, do NOT empty during refactors.
 *
 * Why it exists:
 *   Canonical composition of `useTheme`, `useTranslation`, `useUserStore` and
 *   router `NavLink` — the single place a new engineer (or an agent) sees all
 *   the cross-cutting hooks meeting in one layout shell. `.cursor/brain/MAP.md`
 *   and `.cursor/brain/TEMPLATE_SEEDS.md` point to this file by name; emptying it back to an
 *   empty `<header />` silently breaks the agent contract for how pages,
 *   theming and auth compose together.
 *
 * What it demonstrates:
 *   - brand link + `NavLink` for primary nav
 *   - `LanguageSwitcher` and `ThemeToggle` wired to global stores
 *   - conditional auth control backed by `useUserStore` selectors
 *
 * When to delete / replace:
 *   Replace (not empty) with the product's real navigation the moment brand +
 *   nav are defined. Update `.cursor/brain/TEMPLATE_SEEDS.md` in the same
 *   commit.
 */
import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';
import { ThemeToggle } from '@/components/common/ThemeToggle';
import {
    CHROME_BRAND_LABEL,
    CHROME_BRAND_LINK,
    chromeNavLinkClass
} from '@/components/layout/chromeLink';
import { Button } from '@/components/ui/button';
import { RoutesPath } from '@/router/routes';
import { useUserStore } from '@/store/user/userStore';

export const Header: FunctionComponent = () => {
    const { t } = useTranslation('common');
    const isLoggedIn = useUserStore.use.isLoggedIn();
    const username = useUserStore.use.username();
    const logout = useUserStore.use.logout();

    return (
        <header className="border-b bg-card">
            {/*
             * `flex-wrap` is load-bearing, not tidiness. Measured before it existed: at a 390px
             * viewport the three groups summed wider than the row, so the control group ran from
             * x=259 to x=418 and the DOCUMENT scrolled horizontally by 28px — on every route, on
             * every phone. A row that cannot wrap and cannot shrink can only overflow.
             *
             * The brand truncates rather than pushes: it is chrome, and an app name long enough to
             * need two lines is better clipped than allowed to displace the navigation.
             */}
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
                <NavLink to={RoutesPath.Root} className={CHROME_BRAND_LINK}>
                    <span className={CHROME_BRAND_LABEL}>{t('appName')}</span>
                </NavLink>

                <nav
                    className="flex min-w-0 flex-wrap items-center gap-4"
                    aria-label={t('navigation.home')}
                >
                    <NavLink to={RoutesPath.Root} end className={chromeNavLinkClass}>
                        {t('navigation.home')}
                    </NavLink>
                    <NavLink to={RoutesPath.Dashboard} className={chromeNavLinkClass}>
                        {t('navigation.dashboard')}
                    </NavLink>
                </nav>

                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <LanguageSwitcher />
                    <ThemeToggle />
                    {isLoggedIn ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={logout}
                            aria-label={`${t('auth.signOut')}${username ? `: ${username}` : ''}`}
                        >
                            {t('auth.signOut')}
                        </Button>
                    ) : (
                        <NavLink to={RoutesPath.Login}>
                            <Button type="button" size="sm">
                                {t('auth.signIn')}
                            </Button>
                        </NavLink>
                    )}
                </div>
            </div>
        </header>
    );
};
