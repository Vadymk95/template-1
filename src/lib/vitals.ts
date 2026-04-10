/**
 * Web Vitals reporting
 *
 * Measures Core Web Vitals (LCP, CLS, INP) and diagnostic metrics (FCP, TTFB).
 * Loaded lazily after hydration — zero impact on startup performance.
 *
 * Usage: replace `reportToAnalytics` with your real analytics/Sentry call.
 */
import type { Metric } from 'web-vitals';

const reportToAnalytics = (metric: Metric): void => {
    // Replace with your analytics call, e.g.:
    // Sentry.captureEvent({ message: 'web-vital', extra: metric });
    // gtag('event', metric.name, { value: metric.delta, metric_id: metric.id });
    if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[vitals] ${metric.name}`, metric);
    }
};

export const reportWebVitals = (): void => {
    void import('web-vitals').then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
        onLCP(reportToAnalytics);
        onCLS(reportToAnalytics);
        onINP(reportToAnalytics);
        onFCP(reportToAnalytics);
        onTTFB(reportToAnalytics);
    });
};
