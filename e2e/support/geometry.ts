/**
 * Layout invariants as PURE predicates, deliberately free of any Playwright import.
 *
 * Two consumers need the same rules and must not each carry their own copy: the browser spec that
 * measures a rendered page, and the Vitest sibling that pins every boundary. Two definitions of one
 * rule is the defect this module exists to prevent.
 *
 * Each predicate takes a plain measurement object, so the browser side only has to READ the DOM and
 * the decision stays testable without a browser.
 */

/**
 * Everything the invariants treat as a control. Lives here rather than in each spec, because two
 * copies of a selector drift and then the two specs are measuring different sets.
 */
export const CONTROL_SELECTOR = 'button, a, [role="button"], summary, input, select, textarea';

/**
 * Form fields, which are exempt from the horizontal-overflow rule and never count as icon-only.
 *
 * A text field SCROLLS its own value by design, so `scrollWidth > clientWidth` on an `<input>` is the
 * field working, not the layout breaking — the same reason `overflow-x: auto` is an accepted escape.
 * And a field has no text CHILD nodes, so a label-based width rule would read every input as an
 * unlabelled icon and demand 44px of width from something that is already full-width.
 */
export const FIELD_SELECTOR = 'input, select, textarea';

/** Sub-pixel rounding is normal; a real overflow is wider than that. */
export const CONTENT_OVERFLOW_TOLERANCE_PX = 1;

/** Touch-target floor. A control smaller than this is hard to hit on a phone. */
export const CONTROL_MIN_SIZE_PX = 44;

/**
 * A label that wrapped into a column this narrow is unreadable even though nothing overflowed —
 * the failure a pure overflow check cannot see.
 */
export const WRAPPED_LABEL_MIN_MEASURE_CH = 20;

export interface ContentOverflowMeasurement {
    /**
     * Width already explained by a deliberate negative inline margin (a `-mx-*` bleed row).
     * The fixtures here have none and pass 0; the field exists so a bleed row has an escape hatch
     * that is part of the rule rather than a second copy of it.
     */
    accountedNegativeInlineMargin: number;
    clientWidth: number;
    /** Computed `display`. An inline box is exempt — see `hasContentOverflow`. */
    display: string;
    overflowX: string;
    scrollWidth: number;
}

export interface ControlSizeMeasurement {
    display: string;
    hasTextLabel: boolean;
    height: number;
    width: number;
}

export interface WrappedLabelMeasurement {
    chWidth: number;
    contentWidth: number;
    lineCount: number;
}

/**
 * An element whose content is wider than its box. `overflow-x: auto | scroll` is an explicit decision
 * to scroll, so it is not a violation.
 *
 * An INLINE box is exempt, and this one was found by running a second engine rather than by reasoning:
 * CSS `overflow` does not apply to inline non-replaced elements, and per CSSOM `clientWidth` is 0 for
 * them. Firefox returns that 0 while Chromium reports a box, so every `<label>` on the page looked like
 * a 176px overflow in Firefox and like nothing at all in Chromium. The engine difference is real; the
 * defect was in the rule, which was asking a question an inline box cannot answer.
 */
export const hasContentOverflow = ({
    accountedNegativeInlineMargin,
    clientWidth,
    display,
    overflowX,
    scrollWidth
}: ContentOverflowMeasurement): boolean =>
    display !== 'inline' &&
    overflowX !== 'auto' &&
    overflowX !== 'scroll' &&
    scrollWidth - clientWidth - accountedNegativeInlineMargin > CONTENT_OVERFLOW_TOLERANCE_PX;

/**
 * Height is required of every control except inline text (an inline link takes its height from the
 * line box, so demanding 44 there would flag ordinary prose). Width is required only of icon-only
 * controls: a labelled button is as wide as its label and that is fine.
 */
export const hasInsufficientControlTarget = ({
    display,
    hasTextLabel,
    height,
    width
}: ControlSizeMeasurement): boolean =>
    (display !== 'inline' && Math.round(height) < CONTROL_MIN_SIZE_PX) ||
    (!hasTextLabel && Math.round(width) < CONTROL_MIN_SIZE_PX);

export const getLabelMeasureCh = ({ chWidth, contentWidth }: WrappedLabelMeasurement): number =>
    chWidth > 0 ? contentWidth / chWidth : 0;

export const hasNarrowWrappedLabel = (measurement: WrappedLabelMeasurement): boolean =>
    measurement.lineCount > 1 && getLabelMeasureCh(measurement) < WRAPPED_LABEL_MIN_MEASURE_CH;

/**
 * The document gets NO tolerance. One pixel of horizontal page scroll is visible to the user as a
 * broken page, and unlike an element there is no rounding to forgive.
 */
export const hasDocumentOverflow = (scrollWidth: number, clientWidth: number): boolean =>
    scrollWidth > clientWidth;
