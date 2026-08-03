import { describe, expect, it } from 'vitest';

import {
    getLabelMeasureCh,
    hasContentOverflow,
    hasDocumentOverflow,
    hasInsufficientControlTarget,
    hasNarrowWrappedLabel
} from './geometry';

/**
 * Every case asserts a boundary from BOTH sides (N and N-1), so the recorded thresholds cannot drift
 * without a red test. This runs in Vitest, not Playwright: the predicates are pure, and the browser
 * spec that consumes them is expensive enough that its own failures should be about the page.
 */
describe('layout invariants', () => {
    it('allows one pixel of rounding and explicit horizontal scrolling', () => {
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 101,
                overflowX: 'visible'
            })
        ).toBe(false);
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 102,
                overflowX: 'visible'
            })
        ).toBe(true);
        // An element that opted into scrolling is not overflowing, it is scrolling.
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 400,
                overflowX: 'auto'
            })
        ).toBe(false);
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'block',
                clientWidth: 100,
                scrollWidth: 400,
                overflowX: 'scroll'
            })
        ).toBe(false);
    });

    it('exempts an inline box, which cannot answer the question at all', () => {
        // Found by running Firefox, not by reasoning: CSS `overflow` does not apply to inline
        // non-replaced elements and CSSOM defines their `clientWidth` as 0. Firefox returns that 0
        // while Chromium reports a box, so every `<label>` read as a 176px overflow in one engine and
        // as nothing in the other.
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 0,
                display: 'inline',
                clientWidth: 0,
                scrollWidth: 176,
                overflowX: 'visible'
            })
        ).toBe(false);
        // Only exactly `inline`. An inline-block or a flex item DOES have a content area, so the same
        // numbers there are a real overflow and must stay red.
        for (const display of ['inline-block', 'inline-flex', 'block', 'flex', 'grid']) {
            expect(
                hasContentOverflow({
                    accountedNegativeInlineMargin: 0,
                    display,
                    clientWidth: 0,
                    scrollWidth: 176,
                    overflowX: 'visible'
                }),
                `${display} must not be exempt`
            ).toBe(true);
        }
    });

    it('subtracts only the negative inline margin that explains an overflow', () => {
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 12,
                display: 'block',
                clientWidth: 358,
                scrollWidth: 370,
                overflowX: 'visible'
            })
        ).toBe(false);
        expect(
            hasContentOverflow({
                accountedNegativeInlineMargin: 12,
                display: 'block',
                clientWidth: 358,
                scrollWidth: 388,
                overflowX: 'visible'
            })
        ).toBe(true);
    });

    it('requires control height, except inline text, and width only for icon-only controls', () => {
        expect(
            hasInsufficientControlTarget({
                display: 'inline-flex',
                hasTextLabel: true,
                width: 39,
                height: 44
            })
        ).toBe(false);
        expect(
            hasInsufficientControlTarget({
                display: 'inline-flex',
                hasTextLabel: true,
                width: 98,
                height: 43.4
            })
        ).toBe(true);
        // An inline link takes its height from the line box; demanding 44 there flags ordinary prose.
        expect(
            hasInsufficientControlTarget({
                display: 'inline',
                hasTextLabel: true,
                width: 39,
                height: 20
            })
        ).toBe(false);
        // Icon-only: both axes matter, because there is no label to make it wide.
        expect(
            hasInsufficientControlTarget({
                display: 'flex',
                hasTextLabel: false,
                width: 43.4,
                height: 44
            })
        ).toBe(true);
        expect(
            hasInsufficientControlTarget({
                display: 'flex',
                hasTextLabel: false,
                width: 44,
                height: 44
            })
        ).toBe(false);
    });

    it('uses the element font ch measurement only when a label wraps', () => {
        expect(hasNarrowWrappedLabel({ lineCount: 1, contentWidth: 70, chWidth: 7 })).toBe(false);
        expect(hasNarrowWrappedLabel({ lineCount: 2, contentWidth: 133, chWidth: 7 })).toBe(true);
        expect(hasNarrowWrappedLabel({ lineCount: 2, contentWidth: 140, chWidth: 7 })).toBe(false);
        expect(getLabelMeasureCh({ lineCount: 2, contentWidth: 154, chWidth: 7 })).toBe(22);
    });

    it('reports no measure when the ch probe could not be measured', () => {
        // A zero probe means the measurement failed, not that the label is infinitely narrow.
        expect(getLabelMeasureCh({ lineCount: 2, contentWidth: 154, chWidth: 0 })).toBe(0);
    });

    it('detects document overflow without the element-level tolerance', () => {
        expect(hasDocumentOverflow(390, 390)).toBe(false);
        expect(hasDocumentOverflow(391, 390)).toBe(true);
    });
});
