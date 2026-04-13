/**
 * Web Vitals reporting
 *
 * Measures Core Web Vitals (LCP, CLS, INP) and diagnostic metrics (FCP, TTFB).
 * Loaded lazily after hydration — no synchronous cost on the critical path.
 *
 * Set `VITE_WEB_VITALS_ATTRIBUTION=true` for the attribution build (richer metric payloads for GA4/Sentry).
 * Pass a custom `reporter` to send metrics to your backend (default: dev-only console).
 *
 * **Branching must use `import.meta.env.VITE_WEB_VITALS_ATTRIBUTION`**, not `env` from `@/env`:
 * Vite only eliminates the unused `import()` when the condition is visible on `import.meta.env`.
 * The same variable is still declared in `src/env.ts` (Zod) for validation and `.env.example` docs — keep both in sync (`'true'` string only).
 */
import type { Metric } from 'web-vitals';

import { logger } from '@/lib/logger';

export type WebVitalsReporter = (metric: Metric) => void;

const defaultReporter: WebVitalsReporter = (metric) => {
    // Replace with your analytics call, e.g.:
    // Sentry.captureEvent({ message: 'web-vital', extra: metric });
    // gtag('event', metric.name, { value: metric.delta, metric_id: metric.id });
    if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[vitals] ${metric.name}`, metric);
    }
};

export const reportWebVitals = (reporter: WebVitalsReporter = defaultReporter): void => {
    const useAttribution = import.meta.env.VITE_WEB_VITALS_ATTRIBUTION === 'true';
    const loadSubscriber = useAttribution
        ? import('@/lib/webVitals/subscribeAttribution')
        : import('@/lib/webVitals/subscribeStandard');

    void loadSubscriber
        .then((m) => m.subscribeWebVitals(reporter))
        .catch((error: unknown) => {
            logger.warn('[vitals] failed to load or run web-vitals subscriber', {
                attribution: useAttribution,
                reason: error instanceof Error ? error.message : String(error)
            });
        });
};
