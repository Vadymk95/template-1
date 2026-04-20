/**
 * 🌱 TEMPLATE SEED — demonstrative wiring, do NOT delete during refactors.
 *
 * Why it exists:
 *   The Header references this component to show how `useTheme` is consumed in
 *   the shell. Agents adding real navigation should keep (or replace) this
 *   control — removing it without a replacement breaks the dark-mode demo that
 *   `.cursor/brain/MAP.md` advertises under "CSS / Theming".
 *
 * What it demonstrates:
 *   - three-state theme cycle (light → dark → system)
 *   - icon-only button with accessible label via `t('theme.*')`
 *   - no local state; all persistence handled by `useTheme`
 *
 * When to delete / replace:
 *   Replace with the product's real theme switcher (dropdown, menu, settings
 *   page) once the app has one. Update `.cursor/brain/TEMPLATE_SEEDS.md` in
 *   the same commit.
 */
import { Monitor, Moon, Sun } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/theme/useTheme';

const order = ['light', 'dark', 'system'] as const;
type Theme = (typeof order)[number];

const nextTheme = (current: Theme): Theme => order[(order.indexOf(current) + 1) % order.length];

const iconByTheme: Record<Theme, FunctionComponent<{ className?: string }>> = {
    light: Sun,
    dark: Moon,
    system: Monitor
};

export const ThemeToggle: FunctionComponent = () => {
    const { theme, setTheme } = useTheme();
    const { t } = useTranslation('common');
    const Icon = iconByTheme[theme];
    const label = `${t('theme.label')}: ${t(`theme.${theme}`)}`;

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            onClick={() => {
                setTheme(nextTheme(theme));
            }}
        >
            <Icon className="h-4 w-4" />
        </Button>
    );
};
