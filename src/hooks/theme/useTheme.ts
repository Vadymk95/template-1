import { useCallback, useEffect, useState } from 'react';

import { logger } from '@/lib/logger';
import { STORAGE_KEYS } from '@/store/keys';

const THEMES = ['light', 'dark', 'system'] as const;

type Theme = (typeof THEMES)[number];

const STORAGE_KEY = STORAGE_KEYS.THEME;

const isTheme = (value: string | null): value is Theme => THEMES.some((theme) => theme === value);

// A stored value this app never writes (a hand edit, an older release) reads as the OS preference,
// the way `public/theme-boot.js` reads it, so the hook and the boot script paint the same theme.
// Storage the browser refuses to open reads the same way (strict cookie settings make `localStorage`
// throw): the boot script skips its work there and leaves the theme to this hook after mount.
const readStoredTheme = (): Theme => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return isTheme(stored) ? stored : 'system';
    } catch (error: unknown) {
        logger.warn('[useTheme] readStoredTheme: storage unavailable, reading system', {
            reason: String(error)
        });
        return 'system';
    }
};

const getResolved = (theme: Theme): 'light' | 'dark' =>
    theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
        : theme;

const applyTheme = (theme: Theme): void => {
    document.documentElement.classList.toggle('dark', getResolved(theme) === 'dark');
};

export const useTheme = (): { theme: Theme; setTheme: (next: Theme) => void } => {
    const [theme, setThemeState] = useState<Theme>(readStoredTheme);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    // Respond to OS-level changes when in 'system' mode
    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (): void => {
            applyTheme('system');
        };
        mq.addEventListener('change', handler);
        return () => {
            mq.removeEventListener('change', handler);
        };
    }, [theme]);

    const setTheme = useCallback((next: Theme): void => {
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch (error: unknown) {
            // Storage is refused or full: the theme still changes for this session, it is just not kept.
            logger.warn('[useTheme] setTheme: storage unavailable, the theme is not saved', {
                reason: String(error)
            });
        }
        setThemeState(next);
    }, []);

    return { theme, setTheme };
};
