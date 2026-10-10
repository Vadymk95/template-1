import { buildSecurityHeaders } from '../vite-plugins/security-headers';

import { expectNoSevereA11yViolations } from './support/a11y';
import {
    isConsoleFailure,
    stylesheetScriptSources,
    thirdPartyHintHrefs
} from './support/console-guard';
import { expect, test } from './support/test';

const ROUTES_UNDER_LOAD = ['/', '/login', '/e2e-unknown-route-xyz'] as const;

test.describe('Smoke', () => {
    test('home loads with app title', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle(/React Enterprise Foundation/);
    });

    test('home exposes main landmark and the start-page heading', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('main')).toBeVisible();
        await expect(
            page.getByRole('heading', { level: 1, name: /gate already wired/i })
        ).toBeVisible();
        await expectNoSevereA11yViolations(page);
    });

    test('production preview sends the default security headers', async ({ page }) => {
        // `vite preview` is where the shipped policy is applied; the dev server has none, so a desk
        // run against it has nothing to assert. Same switch as `playwright.config.ts`.
        test.skip(
            !process.env.CI && process.env.PLAYWRIGHT_USE_PREVIEW !== '1',
            'headers are applied by `vite preview`, not by the dev server'
        );

        const response = await page.goto('/');
        const sent = response?.headers() ?? {};

        // Without this the CSP guard (`./support/test.ts`) could stay green with no policy at all.
        for (const name of Object.keys(buildSecurityHeaders())) {
            expect(sent[name.toLowerCase()], name).toBeTruthy();
        }
    });

    test('production build loads every route with no console error, no stylesheet behind a script tag and no third-party resource hint', async ({
        page
    }) => {
        test.skip(
            !process.env.CI && process.env.PLAYWRIGHT_USE_PREVIEW !== '1',
            'the dev server serves modules, not the built chunks this guards'
        );

        const failures: string[] = [];
        page.on('console', (message) => {
            if (isConsoleFailure(message.type())) {
                failures.push(`console.${message.type()}: ${message.text()}`);
            }
        });
        page.on('pageerror', (error) => {
            failures.push(`pageerror: ${error.message}`);
        });
        // The home page calls the API and no server runs behind the gate; a refused connection is a
        // console error that says nothing about the build, so the call is answered here.
        await page.route('**/api/greeting', (route) =>
            route.fulfill({
                json: { greeting: 'Hello' },
                headers: { 'access-control-allow-origin': '*' }
            })
        );

        for (const path of ROUTES_UNDER_LOAD) {
            await page.goto(path, { waitUntil: 'networkidle' });
            const sources = await page.evaluate(() =>
                Array.from(document.scripts, (script) => script.src)
            );
            for (const source of stylesheetScriptSources(sources)) {
                failures.push(`${path}: stylesheet loaded as a script: ${source}`);
            }
            const hints = await page.evaluate(() =>
                Array.from(
                    document.querySelectorAll<HTMLLinkElement>(
                        'link[rel~="preconnect" i], link[rel~="dns-prefetch" i]'
                    ),
                    (link) => ({ rel: link.rel, href: link.href })
                )
            );
            for (const href of thirdPartyHintHrefs(hints, new URL(page.url()).origin)) {
                failures.push(`${path}: resource hint to another origin: ${href}`);
            }
        }

        expect(failures, 'failures while loading the production build').toEqual([]);
    });
});
