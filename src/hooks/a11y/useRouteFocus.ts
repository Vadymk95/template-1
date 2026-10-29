import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves focus to the main landmark on client-side navigations (WCAG 2.4.1).
 * Skips the initial mount so hydration / first paint is unchanged.
 *
 * The last pathname is kept in a ref and compared, instead of a "first run" flag: StrictMode (the dev
 * server) runs the mount effect, cleans it up and runs it again, and a flag already flipped by the
 * first run reads that replay as a navigation and pulls focus to the landmark on the first load.
 * The ref survives the replay, and a replay with the same pathname is not a navigation.
 */
export const useRouteFocus = (mainRef: RefObject<HTMLElement | null>): void => {
    const location = useLocation();
    const lastPathname = useRef<string | null>(null);

    useLayoutEffect(() => {
        const previous = lastPathname.current;
        lastPathname.current = location.pathname;
        if (previous === null || previous === location.pathname) return;

        const el = mainRef.current;
        if (!el) return;

        // Suppress the huge focus ring only for programmatic route focus. Browsers
        // may still set :focus-visible here; skip-link / hash focus has no attribute.
        el.setAttribute('data-route-focus', '');
        el.focus({ preventScroll: true });

        const onBlur = (): void => {
            el.removeAttribute('data-route-focus');
        };
        el.addEventListener('blur', onBlur);

        return () => {
            el.removeEventListener('blur', onBlur);
            el.removeAttribute('data-route-focus');
        };
    }, [location.pathname, mainRef]);
};
