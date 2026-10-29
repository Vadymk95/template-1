import { useCallback, useEffect, useState } from 'react';

import { STORAGE_KEYS } from '@/store/keys';

const THEMES = ['light', 'dark', 'system'] as const;

type Theme = (typeof THEMES)[number];

const STORAGE_KEY = STORAGE_KEYS.THEME;

const isTheme = (value: string | null): value is Theme => THEMES.some((theme) => theme === value);

// A stored value this app never writes (a hand edit, an older release) reads as the OS preference,
// the way `public/theme-boot.js` reads it, so the hook and the boot script paint the same theme.
const readStoredTheme = (): Theme => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
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
        localStorage.setItem(STORAGE_KEY, next);
        setThemeState(next);
    }, []);

    return { theme, setTheme };
};
