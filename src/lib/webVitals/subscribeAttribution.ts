import type { Metric } from 'web-vitals';

/**
 * Registers web-vitals/attribution. Separate module so production builds without
 * the flag never ship this chunk.
 */
export const subscribeWebVitals = (reporter: (metric: Metric) => void): Promise<void> =>
    import('web-vitals/attribution').then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
        onLCP(reporter);
        onCLS(reporter);
        onINP(reporter);
        onFCP(reporter);
        onTTFB(reporter);
    });
