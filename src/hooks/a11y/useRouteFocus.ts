import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves focus to the main landmark on client-side navigations (WCAG 2.4.1).
 * Skips the initial mount so hydration / first paint is unchanged.
 */
export const useRouteFocus = (mainRef: RefObject<HTMLElement | null>) => {
    const location = useLocation();
    const isInitialMount = useRef(true);

    useLayoutEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        const el = mainRef.current;
        if (!el) return;

        // Suppress the huge focus ring only for programmatic route focus. Browsers
        // may still set :focus-visible here; skip-link / hash focus has no attribute.
        el.setAttribute('data-route-focus', '');
        el.focus({ preventScroll: true });

        const onBlur = () => {
            el.removeAttribute('data-route-focus');
        };
        el.addEventListener('blur', onBlur);

        return () => {
            el.removeEventListener('blur', onBlur);
            el.removeAttribute('data-route-focus');
        };
    }, [location.pathname, mainRef]);
};
