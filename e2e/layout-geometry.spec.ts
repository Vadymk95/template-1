import { expect, test } from '@playwright/test';

import { isAcceptedControlTarget } from './support/control-targets';
import {
    CONTROL_SELECTOR,
    FIELD_SELECTOR,
    hasContentOverflow,
    hasDocumentOverflow,
    hasInsufficientControlTarget,
    hasNarrowWrappedLabel
} from './support/geometry';
import { measureDocument, measureSubtree } from './support/measure';

/**
 * The production-side twin of `e2e/dev/content-stress.spec.ts`: the same invariants and the same in-page
 * measurement, over the real routes with their real content and the real shell around them.
 *
 * Both are needed and neither replaces the other. The fixture proves a PRIMITIVE survives content it has
 * not seen; this proves the assembled PAGE holds up — the header row, the footer, the page body and
 * everything a fixture cannot inject content into.
 *
 * Themes are deliberately not a second axis here. Nothing in this template's theme changes a box
 * dimension (same fonts, same spacing tokens, only colour), so a light/dark sweep would double the run
 * time to re-measure identical geometry. Add the axis the moment a theme changes a size.
 */
const ROUTES_UNDER_TEST = [
    { name: 'home', path: '/' },
    { name: 'login', path: '/login' },
    { name: 'not-found', path: '/e2e-unknown-route-xyz' }
] as const;

const SELECTORS = { control: CONTROL_SELECTOR, field: FIELD_SELECTOR };
const VIEWPORT_WIDTHS = [390, 640, 768, 1024, 1440] as const;
const VIEWPORT_HEIGHT = 900;

for (const width of VIEWPORT_WIDTHS) {
    test(`keeps the real routes inside the layout invariants at ${String(width)}px`, async ({
        page
    }, testInfo) => {
        await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });

        const violations: string[] = [];
        const results: string[] = [];

        for (const route of ROUTES_UNDER_TEST) {
            /*
             * `load`, not `domcontentloaded`. Found by running Firefox: at `domcontentloaded` the
             * stylesheet is not necessarily applied yet, so the page measures with UA defaults — a submit
             * button 18px tall and an input 19px, which look like catastrophic layout defects and are
             * simply an unstyled snapshot. Chromium happened to apply the CSS before that event, so a
             * single-engine run could not see it. A geometry measurement needs the render-blocking
             * resources in, which is what `load` waits for.
             */
            await page.goto(route.path, { waitUntil: 'load' });
            await expect(page.getByRole('main')).toBeVisible();

            const violationCountBefore = violations.length;

            const documentWidths = await page.evaluate(measureDocument);
            const measurement = await page.locator('body').evaluate(measureSubtree, SELECTORS);

            // Fail closed: this app hides the document while i18next loads, so a page caught mid-boot
            // measures nothing and every invariant passes vacuously.
            expect(
                measurement.elements.length,
                `${route.name} at ${String(width)}px measured no visible element`
            ).toBeGreaterThan(0);

            if (hasDocumentOverflow(documentWidths.scrollWidth, documentWidths.clientWidth)) {
                violations.push(
                    `${route.name} | ${String(width)}px | html | scrollWidth=${String(documentWidths.scrollWidth)} clientWidth=${String(documentWidths.clientWidth)}`
                );
            }

            for (const element of measurement.elements) {
                // A field scrolls its own value by design; that is not a layout overflow.
                if (
                    !element.isField &&
                    hasContentOverflow({
                        accountedNegativeInlineMargin: 0,
                        clientWidth: element.clientWidth,
                        display: element.display,
                        overflowX: element.overflowX,
                        scrollWidth: element.scrollWidth
                    })
                ) {
                    violations.push(
                        `${route.name} | ${String(width)}px | ${element.selector} | overflow=${String(element.scrollWidth)}-${String(element.clientWidth)}`
                    );
                }

                if (!element.isControl) {
                    continue;
                }

                if (hasNarrowWrappedLabel(element)) {
                    violations.push(
                        `${route.name} | ${String(width)}px | ${element.selector} | wrapped-label lines=${String(element.lineCount)} content=${element.contentWidth.toFixed(1)} ch=${element.chWidth.toFixed(1)}`
                    );
                }

                if (hasInsufficientControlTarget(element) && !isAcceptedControlTarget(element)) {
                    violations.push(
                        `${route.name} | ${String(width)}px | ${element.selector} | target=${element.width.toFixed(1)}x${element.height.toFixed(1)} label=${JSON.stringify(element.label)}`
                    );
                }
            }

            results.push(
                `${route.name} | ${String(width)}px | ${violations.length === violationCountBefore ? 'PASS' : 'FAIL'}`
            );
        }

        await testInfo.attach('layout-geometry-results', {
            body: results.join('\n'),
            contentType: 'text/plain'
        });

        expect(violations, `${results.join('\n')}\n\n${violations.join('\n')}`).toEqual([]);
    });
}
