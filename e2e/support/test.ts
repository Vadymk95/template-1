import { expect, test as base } from '@playwright/test';

import {
    CSP_REPORT_FUNCTION,
    formatCspViolation,
    isCspViolation,
    listenForCspViolations,
    type CspViolationEvent
} from './csp-guard';

/**
 * `test` for every spec that runs against the built app. Identical to Playwright's, plus one
 * automatic fixture: any Content-Security-Policy violation the page reports while the test runs
 * fails that test, naming the directive and the blocked resource.
 *
 * Violations are collected from two sources, in every engine: the console, and the standard
 * `securitypolicyviolation` event (see `./csp-guard.ts` for why neither is enough alone). The event
 * is forwarded to Node through an exposed function, which survives navigations, unlike an array
 * kept on `window`.
 *
 * Under `vite preview` the policy is the shipped one (`vite-plugins/security-headers.ts`), so a
 * change that needs something the policy forbids (an inline script, a third-party font, a new API
 * origin) turns red here instead of in production. Against the dev server there is no policy and
 * the fixture finds nothing, so the same specs run in both modes.
 */
export const test = base.extend<{ cspGuard: undefined }>({
    cspGuard: [
        async ({ page }, use) => {
            const violations: string[] = [];
            page.on('console', (message) => {
                if (isCspViolation(message.type(), message.text())) {
                    violations.push(message.text());
                }
            });
            await page.exposeFunction(CSP_REPORT_FUNCTION, (event: CspViolationEvent) => {
                violations.push(formatCspViolation(event));
            });
            await page.addInitScript(listenForCspViolations, CSP_REPORT_FUNCTION);

            await use(undefined);

            expect(violations, 'Content-Security-Policy violations in the browser').toEqual([]);
        },
        { auto: true }
    ]
});

export { expect };
