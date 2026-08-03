import { expect, test } from '@playwright/test';

import { isAcceptedControlTarget } from '../support/control-targets';
import {
    CONTROL_SELECTOR,
    FIELD_SELECTOR,
    hasContentOverflow,
    hasDocumentOverflow,
    hasInsufficientControlTarget,
    hasNarrowWrappedLabel
} from '../support/geometry';
import { measureDocument, measureSubtree } from '../support/measure';

/**
 * Measures every primitive against every content state at every width the app is expected to render at,
 * and reports the ones that break a layout invariant.
 *
 * Runs against the DEV server, because the fixture route is mounted only under `import.meta.env.DEV` —
 * see `playwright.dev.config.ts`. `playwright.config.ts` must keep `dev/**` in `testIgnore`, or the
 * production project collects this file and runs it against `vite preview`, where the route 404s and the
 * coverage becomes an illusion that still looks like a win.
 *
 * FIVE widths, not one. A guard proven at a single width proves almost nothing: a defect fixed at 390
 * commonly just moves to 1024, so the range a guard must cover is part of its specification.
 *
 * The predicates live in `../support/geometry` and the in-page measurement in `../support/measure`, each
 * with ONE definition shared with the production-side spec.
 */
const CONTENT_STRESS_ROUTE = '/dev/ui/content-stress';
const SELECTORS = { control: CONTROL_SELECTOR, field: FIELD_SELECTOR };
const VIEWPORT_WIDTHS = [390, 640, 768, 1024, 1440] as const;
const VIEWPORT_HEIGHT = 900;

/** A fixture that rendered fewer components than this is broken, not merely small. */
const MIN_EXPECTED_COMPONENTS = 3;

/**
 * Named here on purpose. Counts are derived from the fixture, but the STATES are the contract: if one is
 * renamed or quietly dropped, a derived count would still add up and this spec would not notice.
 */
const EXPECTED_STATES = ['long', 'many', 'minimal', 'none', 'one', 'typical', 'unbroken'] as const;

/** The one state whose case may legitimately have nothing visible to measure. */
const EMPTY_COLLECTION_STATE = 'none';

test.describe('content stress', () => {
    test('keeps every primitive and content state inside the layout invariants', async ({
        page
    }, testInfo) => {
        await page.setViewportSize({ width: VIEWPORT_WIDTHS[0], height: VIEWPORT_HEIGHT });
        await page.goto(CONTENT_STRESS_ROUTE);

        const root = page.locator('[data-stress-root]');
        await expect(root).toBeVisible();

        // The fixture publishes its own totals, derived from the case list, so this spec needs no
        // hardcoded count that a new case would silently invalidate. `ContentStress.test.tsx` pins the
        // attributes to the list, so the two cannot drift together.
        const expectedTotal = Number(await root.getAttribute('data-stress-total'));
        const expectedComponents = Number(await root.getAttribute('data-stress-components'));
        expect(expectedComponents).toBeGreaterThanOrEqual(MIN_EXPECTED_COMPONENTS);
        expect(expectedTotal).toBeGreaterThanOrEqual(expectedComponents);

        const cases = page.locator('[data-stress-case]');
        await expect(cases).toHaveCount(expectedTotal);

        /*
         * Fail CLOSED on a page that rendered nothing. Every element here is hidden while i18next loads
         * (`html.i18n-loading { visibility: hidden }`), so a run caught mid-boot would measure no
         * elements and pass every invariant vacuously — green while checking nothing. This is a
         * PAGE-level condition, which is why it is asserted once rather than per case.
         */
        const pageMeasurement = await root.evaluate(measureSubtree, SELECTORS);
        expect(
            pageMeasurement.elements.length,
            'the fixture page rendered nothing visible'
        ).toBeGreaterThan(expectedTotal);

        const components = new Set<string>();
        const states = new Set<string>();
        const violations: string[] = [];
        const results: string[] = [];
        /** Cases whose target held no visible element. Legitimate only for an empty collection. */
        const emptyCases: string[] = [];

        for (const width of VIEWPORT_WIDTHS) {
            await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });

            const documentWidths = await page.evaluate(measureDocument);
            if (hasDocumentOverflow(documentWidths.scrollWidth, documentWidths.clientWidth)) {
                violations.push(
                    `document | - | ${width}px | html | scrollWidth=${documentWidths.scrollWidth} clientWidth=${documentWidths.clientWidth}`
                );
            }

            for (const stressCase of await cases.all()) {
                const component =
                    (await stressCase.getAttribute('data-stress-component')) ?? 'unknown';
                const state = (await stressCase.getAttribute('data-stress-state')) ?? 'unknown';
                const violationCountBefore = violations.length;
                components.add(component);
                states.add(state);

                const measurement = await stressCase
                    .locator('[data-stress-target]')
                    .evaluate(measureSubtree, SELECTORS);

                /*
                 * A case that measured nothing is only legitimate for an EMPTY collection — an empty list
                 * has no visible box, and neither does the wrapper that holds only that list. Anything
                 * else measuring nothing is a case that failed to render, which would otherwise pass
                 * every invariant by having nothing to check.
                 */
                if (measurement.elements.length === 0) {
                    emptyCases.push(`${component} | ${state}`);
                }

                if (hasDocumentOverflow(measurement.scrollWidth, measurement.clientWidth)) {
                    violations.push(
                        `${component} | ${state} | ${width}px | target | scrollWidth=${measurement.scrollWidth} clientWidth=${measurement.clientWidth}`
                    );
                }

                for (const element of measurement.elements) {
                    // A field scrolls its own value; see FIELD_SELECTOR for why that is not an overflow.
                    if (
                        !element.isField &&
                        hasContentOverflow({
                            // The fixtures carry no `-mx-*` bleed. Wire the negative-margin accounting
                            // here if one is ever added, rather than widening the tolerance.
                            accountedNegativeInlineMargin: 0,
                            clientWidth: element.clientWidth,
                            display: element.display,
                            overflowX: element.overflowX,
                            scrollWidth: element.scrollWidth
                        })
                    ) {
                        violations.push(
                            `${component} | ${state} | ${width}px | ${element.selector} | overflow=${element.scrollWidth}-${element.clientWidth}`
                        );
                    }

                    if (!element.isControl) {
                        continue;
                    }

                    if (hasNarrowWrappedLabel(element)) {
                        violations.push(
                            `${component} | ${state} | ${width}px | ${element.selector} | wrapped-label lines=${element.lineCount} content=${element.contentWidth.toFixed(1)} ch=${element.chWidth.toFixed(1)}`
                        );
                    }

                    if (
                        hasInsufficientControlTarget(element) &&
                        !isAcceptedControlTarget(element)
                    ) {
                        violations.push(
                            `${component} | ${state} | ${width}px | ${element.selector} | target=${element.width.toFixed(1)}x${element.height.toFixed(1)} label=${JSON.stringify(element.label)}`
                        );
                    }
                }

                results.push(
                    `${component} | ${state} | ${width}px | ${violations.length === violationCountBefore ? 'PASS' : 'FAIL'}`
                );
            }
        }

        // Attached on green too, so the harness can be used as an INSTRUMENT — "does this class change
        // anything at any width" is answerable from a passing run.
        await testInfo.attach('content-stress-results', {
            body: results.join('\n'),
            contentType: 'text/plain'
        });

        expect(components.size).toBe(expectedComponents);
        expect([...states].sort()).toEqual([...EXPECTED_STATES]);
        // Subset, not equality: an empty state that renders a placeholder is good design and must not
        // fail here. What must fail is any OTHER case rendering nothing.
        expect(
            emptyCases.filter((entry) => !entry.endsWith(`| ${EMPTY_COLLECTION_STATE}`)),
            'a case rendered no visible element'
        ).toEqual([]);
        expect(violations, `${results.join('\n')}\n\n${violations.join('\n')}`).toEqual([]);
    });
});
