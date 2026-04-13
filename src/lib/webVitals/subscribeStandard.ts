import type { Metric } from 'web-vitals';

/**
 * Registers web-vitals (standard build). Kept in a separate module so the
 * attribution chunk is not emitted when VITE_WEB_VITALS_ATTRIBUTION is off.
 */
export const subscribeWebVitals = (reporter: (metric: Metric) => void): Promise<void> =>
    import('web-vitals').then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
        onLCP(reporter);
        onCLS(reporter);
        onINP(reporter);
        onFCP(reporter);
        onTTFB(reporter);
    });
