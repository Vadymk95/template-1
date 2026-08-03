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

/**
 * Measures every primitive against every content state at every width the app is expected to render
 * at, and reports the ones that break a layout invariant.
 *
 * Runs against the DEV server, because the fixture route is mounted only under `import.meta.env.DEV`
 * — see `playwright.dev.config.ts`. `playwright.config.ts` must keep `dev/**` in `testIgnore`, or the
 * production project collects this file and runs it against `vite preview`, where the route 404s and
 * the coverage becomes an illusion that still looks like a win.
 *
 * FIVE widths, not one. A guard proven at a single width proves almost nothing: a defect fixed at 390
 * commonly just moves to 1024, so the range a guard must cover is part of its specification.
 */
const CONTENT_STRESS_ROUTE = '/dev/ui/content-stress';
const VIEWPORT_WIDTHS = [390, 640, 768, 1024, 1440] as const;
const VIEWPORT_HEIGHT = 900;

/** A fixture that rendered fewer components than this is broken, not merely small. */
const MIN_EXPECTED_COMPONENTS = 3;

/**
 * Named here on purpose. Counts are derived from the fixture, but the STATES are the contract: if one
 * is renamed or quietly dropped, a derived count would still add up and this spec would not notice.
 */
const EXPECTED_STATES = ['long', 'many', 'minimal', 'none', 'one', 'typical', 'unbroken'] as const;

/** The one state whose case may legitimately have nothing visible to measure. */
const EMPTY_COLLECTION_STATE = 'none';

interface ElementMeasurement {
    chWidth: number;
    clientWidth: number;
    contentWidth: number;
    display: string;
    hasTextLabel: boolean;
    height: number;
    isControl: boolean;
    isField: boolean;
    label: string;
    lineCount: number;
    overflowX: string;
    scrollWidth: number;
    selector: string;
    width: number;
}

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
         * Fail CLOSED on a page that rendered nothing. Every element here is hidden while i18next
         * loads (`html.i18n-loading { visibility: hidden }`), so a run caught mid-boot would measure
         * no elements and pass every invariant vacuously — green while checking nothing. This is a
         * PAGE-level condition, which is why it is asserted once rather than per case.
         */
        const visibleUnderRoot = await root.evaluate(
            (node) =>
                Array.from(node.querySelectorAll('*')).filter(
                    (element) =>
                        element instanceof HTMLElement &&
                        element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
                ).length
        );
        expect(visibleUnderRoot, 'the fixture page rendered nothing visible').toBeGreaterThan(
            expectedTotal
        );

        const components = new Set<string>();
        const states = new Set<string>();
        const violations: string[] = [];
        const results: string[] = [];
        /** Cases whose target held no visible element. Legitimate only for an empty collection. */
        const emptyCases: string[] = [];

        for (const width of VIEWPORT_WIDTHS) {
            await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });

            const document = await page.evaluate(() => ({
                clientWidth: window.document.documentElement.clientWidth,
                scrollWidth: window.document.documentElement.scrollWidth
            }));
            if (hasDocumentOverflow(document.scrollWidth, document.clientWidth)) {
                violations.push(
                    `document | - | ${width}px | html | scrollWidth=${document.scrollWidth} clientWidth=${document.clientWidth}`
                );
            }

            for (const stressCase of await cases.all()) {
                const component =
                    (await stressCase.getAttribute('data-stress-component')) ?? 'unknown';
                const state = (await stressCase.getAttribute('data-stress-state')) ?? 'unknown';
                const violationCountBefore = violations.length;
                components.add(component);
                states.add(state);

                const target = stressCase.locator('[data-stress-target]');
                const measurement = await target.evaluate(
                    (node, selectors) => {
                        const isVisible = (element: HTMLElement) => {
                            const style = getComputedStyle(element);
                            const rect = element.getBoundingClientRect();
                            return (
                                element.checkVisibility({
                                    checkOpacity: true,
                                    checkVisibilityCSS: true
                                }) &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                rect.width > 0 &&
                                rect.height > 0
                            );
                        };

                        // A screen-reader-only node is absolutely positioned and clipped to a pixel. Left
                        // in, it registers as both an overflow and a 1px control on every case.
                        const isVisuallyHidden = (element: HTMLElement) => {
                            const style = getComputedStyle(element);
                            const rect = element.getBoundingClientRect();
                            return (
                                style.position === 'absolute' &&
                                (style.clip !== 'auto' || style.clipPath !== 'none') &&
                                rect.width <= 1 &&
                                rect.height <= 1
                            );
                        };

                        // Rendered line count, not a guess from the string length: each text node's client
                        // rects are deduped by their top edge, within a pixel of rounding.
                        const getTextLineCount = (element: HTMLElement) => {
                            const walker = window.document.createTreeWalker(
                                element,
                                NodeFilter.SHOW_TEXT
                            );
                            const tops: number[] = [];
                            let textNode = walker.nextNode();
                            while (textNode) {
                                if (textNode.textContent?.trim()) {
                                    const parent = textNode.parentElement;
                                    if (parent && isVisible(parent) && !isVisuallyHidden(parent)) {
                                        const range = window.document.createRange();
                                        range.selectNodeContents(textNode);
                                        for (const rect of Array.from(range.getClientRects())) {
                                            if (
                                                !tops.some((top) => Math.abs(top - rect.top) <= 1)
                                            ) {
                                                tops.push(rect.top);
                                            }
                                        }
                                    }
                                }
                                textNode = walker.nextNode();
                            }
                            return tops.length;
                        };

                        const getVisibleText = (element: HTMLElement) => {
                            // A field's own value or placeholder IS its visible text; it has no text child
                            // nodes, so walking children would report every input as unlabelled.
                            if (element instanceof HTMLInputElement) {
                                return (element.value || element.placeholder).trim();
                            }
                            if (element instanceof HTMLTextAreaElement) {
                                return (element.value || element.placeholder).trim();
                            }
                            if (element instanceof HTMLSelectElement) {
                                return (element.selectedOptions[0]?.textContent ?? '').trim();
                            }

                            const walker = window.document.createTreeWalker(
                                element,
                                NodeFilter.SHOW_TEXT
                            );
                            const parts: string[] = [];
                            let textNode = walker.nextNode();
                            while (textNode) {
                                const parent = textNode.parentElement;
                                const value = textNode.textContent?.trim();
                                if (
                                    value &&
                                    parent &&
                                    isVisible(parent) &&
                                    !isVisuallyHidden(parent)
                                ) {
                                    parts.push(value);
                                }
                                textNode = walker.nextNode();
                            }
                            return parts.join(' ').replaceAll(/\s+/g, ' ');
                        };

                        // Turns a pixel width into a character measure in the element's OWN font, which is
                        // what a readability rule is actually about. Font metrics differ per engine, so
                        // this must be measured rather than assumed.
                        const measureCh = (element: HTMLElement) => {
                            const style = getComputedStyle(element);
                            const probe = window.document.createElement('span');
                            probe.style.position = 'fixed';
                            probe.style.visibility = 'hidden';
                            probe.style.width = '1ch';
                            probe.style.fontFamily = style.fontFamily;
                            probe.style.fontSize = style.fontSize;
                            probe.style.fontWeight = style.fontWeight;
                            window.document.body.append(probe);
                            const width = probe.getBoundingClientRect().width;
                            probe.remove();
                            return width;
                        };

                        const elements = [node, ...Array.from(node.querySelectorAll('*'))].filter(
                            (element): element is HTMLElement =>
                                element instanceof HTMLElement &&
                                isVisible(element) &&
                                !isVisuallyHidden(element)
                        );

                        return {
                            clientWidth: node.clientWidth,
                            scrollWidth: node.scrollWidth,
                            elements: elements.map((element) => {
                                const style = getComputedStyle(element);
                                const rect = element.getBoundingClientRect();
                                const isControl = element.matches(selectors.control);
                                const isField = element.matches(selectors.field);
                                const visibleText = isControl ? getVisibleText(element) : '';
                                return {
                                    chWidth: isControl ? measureCh(element) : 0,
                                    clientWidth: element.clientWidth,
                                    contentWidth: Math.max(
                                        0,
                                        element.clientWidth -
                                            Number.parseFloat(style.paddingLeft) -
                                            Number.parseFloat(style.paddingRight)
                                    ),
                                    display: style.display,
                                    hasTextLabel: visibleText.length > 0,
                                    height: rect.height,
                                    isControl,
                                    isField,
                                    label: visibleText,
                                    lineCount: isControl ? getTextLineCount(element) : 0,
                                    overflowX: style.overflowX,
                                    scrollWidth: element.scrollWidth,
                                    selector:
                                        element.dataset.slot ??
                                        element.getAttribute('role') ??
                                        element.tagName.toLowerCase(),
                                    width: rect.width
                                };
                            })
                        };
                    },
                    { control: CONTROL_SELECTOR, field: FIELD_SELECTOR }
                );

                /*
                 * A case that measured nothing is only legitimate for an EMPTY collection — an empty
                 * list has no visible box, and neither does the wrapper that holds only that list.
                 * Anything else measuring nothing is a case that failed to render, which would
                 * otherwise pass every invariant by having nothing to check.
                 */
                if (measurement.elements.length === 0) {
                    emptyCases.push(`${component} | ${state}`);
                }

                if (hasDocumentOverflow(measurement.scrollWidth, measurement.clientWidth)) {
                    violations.push(
                        `${component} | ${state} | ${width}px | target | scrollWidth=${measurement.scrollWidth} clientWidth=${measurement.clientWidth}`
                    );
                }

                for (const element of measurement.elements as ElementMeasurement[]) {
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

        // Attached on green too, so the harness can be used as an INSTRUMENT — "does this class
        // change anything at any width" is answerable from a passing run.
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
