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
}

/**
 * Name of the function the fixture exposes to every page and frame. It lives on `window`, so the
 * constant keeps the fixture and the in-page listener from drifting apart.
 */
export const CSP_REPORT_FUNCTION = '__reportCspViolation';

export const formatCspViolation = ({
    effectiveDirective,
    blockedURI,
    sourceFile,
    lineNumber,
    disposition
}: CspViolationEvent): string => {
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
            disposition: event.disposition
        });
    });
};
