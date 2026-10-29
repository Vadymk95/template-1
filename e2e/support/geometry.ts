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

/** Sub-pixel rounding is normal; a real overflow is wider (or taller) than that, on either axis. */
export const CONTENT_OVERFLOW_TOLERANCE_PX = 1;

/**
 * How far a line of text may overhang its own line box on the block axis, as a share of the font size.
 * A glyph's content area (ascent plus descent) is usually taller than the font size, so under a tight
 * line height the text box pokes out of the line box and the engine counts that in `scrollHeight`.
 * Measured on a bare page, 36px text in a 36px line box reads 2px over in Chromium, 1px in Firefox and
 * 0 in WebKit; Inter in the 40px line box of a heading reads 2px over in Chromium. A real spill is
 * a whole line or more (264px for a wrapped label in a one-line box, in all three engines).
 */
export const LINE_BOX_OVERHANG_EM = 0.25;

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

export interface BlockOverflowMeasurement {
    clientHeight: number;
    /** Computed `display`. An inline box is exempt — see `hasBlockOverflow`. */
    display: string;
    /** Computed `font-size` in px, which sizes the line-box overhang `hasBlockOverflow` forgives. */
    fontSize: number;
    overflowY: string;
    scrollHeight: number;
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
 * The block-axis twin of `hasContentOverflow`: an element whose content is TALLER than its box. A fixed
 * height, a `max-h-*` or a clipped wrapper that a long label wrapped past is invisible to the
 * inline-axis rule, because nothing is wider and `scrollWidth` still equals `clientWidth`, while the
 * text paints over whatever sits below it or is cut off.
 *
 * Same exemptions, for the same reasons: `overflow-y: auto | scroll` is an explicit decision to scroll,
 * and an inline box has no content area to answer with. `hidden` is NOT exempt, because clipped
 * content is lost content, and that is the failure this rule exists to see.
 *
 * The tolerance is wider than on the inline axis, by `LINE_BOX_OVERHANG_EM` of the font size: a flat
 * pixel flagged every heading set in a tight line height, which is how the font is drawn, not content
 * that does not fit. The allowance follows the box's own font size, so a large heading is forgiven
 * more than small text. A deliberate clamp (`line-clamp`, or a fixed height with `overflow: hidden`)
 * needs an explicit exemption at the call site, never a wider tolerance.
 */
export const hasBlockOverflow = ({
    clientHeight,
    display,
    fontSize,
    overflowY,
    scrollHeight
}: BlockOverflowMeasurement): boolean =>
    display !== 'inline' &&
    overflowY !== 'auto' &&
    overflowY !== 'scroll' &&
    scrollHeight - clientHeight > CONTENT_OVERFLOW_TOLERANCE_PX + LINE_BOX_OVERHANG_EM * fontSize;

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
