import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves focus to the main landmark on client-side navigations (WCAG 2.4.1).
 * Skips the initial mount so hydration / first paint is unchanged.
 */
export const useRouteFocus = (mainRef: RefObject<HTMLElement | null>) => {
    const location = useLocation();
    const isInitialMount = useRef(true);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        mainRef.current?.focus({ preventScroll: true });
    }, [location.pathname, mainRef]);
};
