/**
 * The in-page measurement, as ONE definition shared by both geometry specs.
 *
 * It used to be a ~120-line `page.evaluate` block copied into each spec, and the copies drifted exactly
 * the way copies do: the form-field handling landed in one of them, so an `<input>` read as an
 * unlabelled icon-only control in the route spec and correctly in the fixture spec. The predicates in
 * `./geometry` were already shared; this closes the other half.
 *
 * **Constraint that shapes the file.** Playwright serialises the function source and evaluates it in the
 * page, so it can reference NOTHING from module scope — every helper is nested inside, and every value it
 * needs (the selectors) arrives as the argument. That is also why the selectors are passed rather than
 * imported: an import would be `undefined` by the time this runs in the browser.
 *
 * Both specs call it through a locator, which gives the same `(element, arg)` signature:
 *   `stressCase.locator('[data-stress-target]').evaluate(measureSubtree, SELECTORS)`
 *   `page.locator('body').evaluate(measureSubtree, SELECTORS)`
 */

export interface MeasureSelectors {
    /** Everything treated as a control. */
    control: string;
    /** Form fields, which are never icon-only and never "overflowing" when they scroll their value. */
    field: string;
}

export interface MeasuredElement {
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

export interface SubtreeMeasurement {
    clientWidth: number;
    scrollWidth: number;
    elements: MeasuredElement[];
}

export const measureSubtree = (
    root: HTMLElement,
    selectors: MeasureSelectors
): SubtreeMeasurement => {
    const isVisible = (element: HTMLElement): boolean => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
            element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
        );
    };

    // A screen-reader-only node is absolutely positioned and clipped to a pixel. Left in, it registers
    // as both an overflow and a 1px control on every case.
    const isVisuallyHidden = (element: HTMLElement): boolean => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
            style.position === 'absolute' &&
            (style.clip !== 'auto' || style.clipPath !== 'none') &&
            rect.width <= 1 &&
            rect.height <= 1
        );
    };

    // Rendered line count, not a guess from the string length: each text node's client rects are deduped
    // by their top edge, within a pixel of rounding.
    const getTextLineCount = (element: HTMLElement): number => {
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

    const getVisibleText = (element: HTMLElement): string => {
        // A field's own value or placeholder IS its visible text; it has no text child nodes, so walking
        // children would report every input as unlabelled — and an unlabelled control is then held to the
        // icon-only width rule, which a full-width field cannot fail meaningfully.
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
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

    // Turns a pixel width into a character measure in the element's OWN font, which is what a readability
    // rule is actually about. Font metrics differ per engine, so this must be measured, not assumed.
    const measureCh = (element: HTMLElement): number => {
        const style = getComputedStyle(element);
        const probe = document.createElement('span');
        probe.style.position = 'fixed';
        probe.style.visibility = 'hidden';
        probe.style.width = '1ch';
        probe.style.fontFamily = style.fontFamily;
        probe.style.fontSize = style.fontSize;
        probe.style.fontWeight = style.fontWeight;
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
    };

    const elements = [root, ...Array.from(root.querySelectorAll('*'))].filter(
        (element): element is HTMLElement =>
            element instanceof HTMLElement && isVisible(element) && !isVisuallyHidden(element)
    );

    return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
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
};

/** Reads the document's own widths — the one measurement that is not about a subtree. */
export const measureDocument = (): { clientWidth: number; scrollWidth: number } => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
});
