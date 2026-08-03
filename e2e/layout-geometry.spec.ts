import { expect, test } from '@playwright/test';

import { isAcceptedControlTarget } from './support/control-targets';
import {
    hasContentOverflow,
    hasDocumentOverflow,
    hasInsufficientControlTarget,
    hasNarrowWrappedLabel
} from './support/geometry';

/**
 * The production-side twin of `e2e/dev/content-stress.spec.ts`: the same invariants, but over the real
 * routes with their real content and the real shell around them.
 *
 * Both are needed and neither replaces the other. The fixture proves a PRIMITIVE survives content it
 * has not seen; this proves the assembled PAGE holds up — the header row, the footer, the page body and
 * everything a fixture cannot inject content into.
 *
 * Themes are deliberately not a second axis here. Nothing in this template's theme changes a box
 * dimension (same fonts, same spacing tokens, only colour), so a light/dark sweep would double the
 * run time to re-measure identical geometry. Add the axis the moment a theme changes a size.
 */
const ROUTES_UNDER_TEST = [
    { name: 'home', path: '/' },
    { name: 'login', path: '/login' },
    { name: 'not-found', path: '/e2e-unknown-route-xyz' }
] as const;

const VIEWPORT_WIDTHS = [390, 640, 768, 1024, 1440] as const;
const VIEWPORT_HEIGHT = 900;
const CONTROL_SELECTOR = 'button, a, [role="button"], summary, input, select, textarea';

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
             * stylesheet is not necessarily applied yet, so the page measures with UA defaults — a
             * submit button 18px tall and an input 19px, which look like catastrophic layout defects and
             * are simply an unstyled snapshot. Chromium happened to apply the CSS before that event, so
             * a single-engine run could not see it. A geometry measurement needs the render-blocking
             * resources in, which is what `load` waits for.
             */
            await page.goto(route.path, { waitUntil: 'load' });
            await expect(page.getByRole('main')).toBeVisible();

            const violationCountBefore = violations.length;

            const measurement = await page.evaluate((controlSelector) => {
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

                const getTextLineCount = (element: HTMLElement) => {
                    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                    const tops: number[] = [];
                    let textNode = walker.nextNode();
                    while (textNode) {
                        if (textNode.textContent?.trim()) {
                            const parent = textNode.parentElement;
                            if (parent && isVisible(parent) && !isVisuallyHidden(parent)) {
                                const range = document.createRange();
                                range.selectNodeContents(textNode);
                                for (const rect of Array.from(range.getClientRects())) {
                                    if (!tops.some((top) => Math.abs(top - rect.top) <= 1)) {
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
                    // nodes, so walking children would report every input as unlabelled — and an
                    // unlabelled control is then held to the icon-only width rule, which a full-width
                    // field cannot fail meaningfully. Kept identical to the content-stress spec: the
                    // two in-page measurements are separate copies and this fix landed in one of them
                    // first, which is exactly how they drift.
                    if (element instanceof HTMLInputElement) {
                        return (element.value || element.placeholder).trim();
                    }
                    if (element instanceof HTMLTextAreaElement) {
                        return (element.value || element.placeholder).trim();
                    }
                    if (element instanceof HTMLSelectElement) {
                        return (element.selectedOptions[0]?.textContent ?? '').trim();
                    }

                    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
                    const parts: string[] = [];
                    let textNode = walker.nextNode();
                    while (textNode) {
                        const parent = textNode.parentElement;
                        const value = textNode.textContent?.trim();
                        if (value && parent && isVisible(parent) && !isVisuallyHidden(parent)) {
                            parts.push(value);
                        }
                        textNode = walker.nextNode();
                    }
                    return parts.join(' ').replaceAll(/\s+/g, ' ');
                };

                const measureCh = (element: HTMLElement) => {
                    const style = getComputedStyle(element);
                    const probe = document.createElement('span');
                    probe.style.position = 'fixed';
                    probe.style.visibility = 'hidden';
                    probe.style.width = '1ch';
                    probe.style.fontFamily = style.fontFamily;
                    probe.style.fontSize = style.fontSize;
                    probe.style.fontWeight = style.fontWeight;
                    document.body.append(probe);
                    const probeWidth = probe.getBoundingClientRect().width;
                    probe.remove();
                    return probeWidth;
                };

                const elements = Array.from(document.body.querySelectorAll('*')).filter(
                    (element): element is HTMLElement =>
                        element instanceof HTMLElement &&
                        isVisible(element) &&
                        !isVisuallyHidden(element)
                );

                return {
                    documentClientWidth: document.documentElement.clientWidth,
                    documentScrollWidth: document.documentElement.scrollWidth,
                    elements: elements.map((element) => {
                        const style = getComputedStyle(element);
                        const rect = element.getBoundingClientRect();
                        const isControl = element.matches(controlSelector);
                        const isField = element.matches('input, select, textarea');
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
            }, CONTROL_SELECTOR);

            // Fail closed: this app hides the document while i18next loads, so a page caught mid-boot
            // measures nothing and every invariant passes vacuously.
            expect(
                measurement.elements.length,
                `${route.name} at ${String(width)}px measured no visible element`
            ).toBeGreaterThan(0);

            if (
                hasDocumentOverflow(
                    measurement.documentScrollWidth,
                    measurement.documentClientWidth
                )
            ) {
                violations.push(
                    `${route.name} | ${String(width)}px | html | scrollWidth=${String(measurement.documentScrollWidth)} clientWidth=${String(measurement.documentClientWidth)}`
                );
            }

            for (const element of measurement.elements as ElementMeasurement[]) {
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
