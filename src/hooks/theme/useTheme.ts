import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

const getResolved = (theme: Theme): 'light' | 'dark' =>
    theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
        : theme;

const applyTheme = (theme: Theme): void => {
    document.documentElement.classList.toggle('dark', getResolved(theme) === 'dark');
};

export const useTheme = () => {
    const [theme, setThemeState] = useState<Theme>(
        () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system'
    );

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    // Respond to OS-level changes when in 'system' mode
    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
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
