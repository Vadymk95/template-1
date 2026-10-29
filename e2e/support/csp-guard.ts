/**
 * What counts as a Content-Security-Policy violation in a browser test, and how it is reported.
 *
 * Two sources feed the guard in `./test.ts`, because neither alone is trustworthy across engines:
 * - the console: each engine prints its own wording (Chromium: "...violates the following Content
 *   Security Policy directive", Firefox: "Content-Security-Policy: The page's settings blocked...")
 *   and not every blocked action is logged as a console error in every engine;
 * - the `securitypolicyviolation` event: the standard signal, the same in every engine, carrying the
 *   directive and the blocked resource. It also fires for a blocked action the page code catches and
 *   swallows (an `eval` probe inside `try/catch`), which no page error or failed request would show.
 *
 * Pure on purpose, like the other `e2e/support` helpers: the matching and formatting are unit-tested
 * in Vitest (`csp-guard.test.ts`), while the fixture that wires them to a page lives in `./test.ts`.
 */
const CSP_MESSAGE = /content[- ]security[- ]policy/i;

export const isCspViolation = (type: string, text: string): boolean =>
    type === 'error' && CSP_MESSAGE.test(text);

/** The fields of a `SecurityPolicyViolationEvent` the guard reports (serialisable across the page boundary). */
export interface CspViolationEvent {
    effectiveDirective: string;
    blockedURI: string;
    sourceFile: string;
    lineNumber: number;
    disposition: string;
    /** Lower-case tag name of the element the violation is attached to; empty for the document itself. */
    targetTag: string;
}

/**
 * Name of the function the fixture exposes to every page and frame. It lives on `window`, so the
 * constant keeps the fixture and the in-page listener from drifting apart.
 */
export const CSP_REPORT_FUNCTION = '__reportCspViolation';

/**
 * WebKit reports its own native `<select>` as a `style-src-attr` violation: the control carries an
 * inline style, which a policy without `'unsafe-inline'` refuses. Measured on a bare page under the
 * shipped policy: one event per select, blocked inline, no source position, targeted at the `<select>`
 * itself, while Chromium and Firefox report nothing for a select. No code of the app causes it and none
 * can fix it, yet an inline style refused anywhere else (a `<div style>`, a `<style>` element) is a
 * real finding and keeps its own event, with its own target.
 *
 * One blind spot, known and accepted: a `style` attribute written on a `<select>` itself reports the
 * same way in WebKit and is hidden with it.
 */
export const isNativeSelectAttrReport = ({
    effectiveDirective,
    targetTag
}: Pick<CspViolationEvent, 'effectiveDirective' | 'targetTag'>): boolean =>
    effectiveDirective === 'style-src-attr' && targetTag === 'select';

const WEBKIT = 'webkit';

/**
 * WebKit's console line for ANY refused inline style or `<style>` element. It names neither the element
 * nor the directive, so the native select's line cannot be told from a real violation's. The event can
 * (it has the target), and WebKit raised one for every such refusal measured, so dropping the line in
 * WebKit loses no finding that the event path does not still report.
 */
const WEBKIT_INLINE_STYLE_REFUSAL =
    /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;

/**
 * Whether a `securitypolicyviolation` event fails the test in `engine` (Playwright's `browserName`).
 * Only WebKit's own report of a native select is let through, and only in WebKit: in another engine the
 * same event would be a real inline style on a select.
 */
export const isCspEventFinding = (engine: string, event: CspViolationEvent): boolean =>
    !(engine === WEBKIT && isNativeSelectAttrReport(event));

/** Whether a console message fails the test in `engine`; see `WEBKIT_INLINE_STYLE_REFUSAL`. */
export const isCspConsoleFinding = (engine: string, type: string, text: string): boolean =>
    isCspViolation(type, text) && !(engine === WEBKIT && WEBKIT_INLINE_STYLE_REFUSAL.test(text));

export const formatCspViolation = ({
    effectiveDirective,
    blockedURI,
    sourceFile,
    lineNumber,
    disposition
}: Omit<CspViolationEvent, 'targetTag'>): string => {
    // `blockedURI` is empty for inline and eval violations; say what was blocked, not nothing.
    const blocked = blockedURI === '' ? '(inline or eval)' : blockedURI;
    const origin = sourceFile === '' ? '' : ` at ${sourceFile}:${String(lineNumber)}`;
    const mode = disposition === 'report' ? ' [report-only]' : '';
    return `securitypolicyviolation${mode}: ${effectiveDirective} blocked ${blocked}${origin}`;
};

/**
 * Runs inside every page and frame before any page script (`page.addInitScript`). Must stay
 * self-contained: Playwright serialises the function body, so it cannot close over module scope.
 * The name is passed in for the same reason.
 */
export const listenForCspViolations = (reportFunction: string): void => {
    document.addEventListener('securitypolicyviolation', (event) => {
        const report = (window as unknown as Record<string, (v: CspViolationEvent) => unknown>)[
            reportFunction
        ];
        void report?.({
            effectiveDirective: event.effectiveDirective,
            blockedURI: event.blockedURI,
            sourceFile: event.sourceFile,
            lineNumber: event.lineNumber,
            disposition: event.disposition,
            targetTag: event.target instanceof Element ? event.target.tagName.toLowerCase() : ''
        });
    });
};
