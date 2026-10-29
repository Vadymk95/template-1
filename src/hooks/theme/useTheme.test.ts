import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTheme } from './useTheme';

interface MockMediaQueryList {
    matches: boolean;
    addEventListener: (type: 'change', listener: () => void) => void;
    removeEventListener: (type: 'change', listener: () => void) => void;
}

const buildMatchMedia = (matches: boolean) => {
    const listeners = new Set<() => void>();
    const mql: MockMediaQueryList = {
        matches,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => {
            listeners.delete(listener);
        }
    };
    const matchMedia = vi.fn(() => mql);
    return { matchMedia, listeners, mql };
};

describe('useTheme', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.classList.remove('dark');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('defaults to system and applies resolved theme to <html>', () => {
        const { matchMedia } = buildMatchMedia(true);
        vi.stubGlobal('matchMedia', matchMedia);

        const { result } = renderHook(() => useTheme());

        expect(result.current.theme).toBe('system');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    // The boot script in `public/theme-boot.js` reads any stored value other than `dark` and `light`
    // as the OS preference. A hook that handed the raw string on resolved it to neither theme, so the
    // page painted dark from the script and then flipped to light once React mounted.
    it.each(['blue', '', 'Dark'])('reads the unknown stored value %j as system', (stored) => {
        const { matchMedia } = buildMatchMedia(true);
        vi.stubGlobal('matchMedia', matchMedia);
        localStorage.setItem('theme', stored);

        const { result } = renderHook(() => useTheme());

        expect(result.current.theme).toBe('system');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it.each([
        { stored: 'light', dark: false },
        { stored: 'dark', dark: true },
        { stored: 'system', dark: true }
    ])('keeps the valid stored value $stored over the OS preference', ({ stored, dark }) => {
        const { matchMedia } = buildMatchMedia(true);
        vi.stubGlobal('matchMedia', matchMedia);
        localStorage.setItem('theme', stored);

        const { result } = renderHook(() => useTheme());

        expect(result.current.theme).toBe(stored);
        expect(document.documentElement.classList.contains('dark')).toBe(dark);
    });

    it('persists explicit theme to localStorage and toggles html.dark', () => {
        const { matchMedia } = buildMatchMedia(false);
        vi.stubGlobal('matchMedia', matchMedia);

        const { result } = renderHook(() => useTheme());

        act(() => {
            result.current.setTheme('dark');
        });

        expect(localStorage.getItem('theme')).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        act(() => {
            result.current.setTheme('light');
        });

        expect(localStorage.getItem('theme')).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('unsubscribes matchMedia listener on unmount (system mode)', () => {
        const { matchMedia, listeners } = buildMatchMedia(false);
        vi.stubGlobal('matchMedia', matchMedia);

        const { unmount } = renderHook(() => useTheme());

        expect(listeners.size).toBe(1);
        unmount();
        expect(listeners.size).toBe(0);
    });
});
