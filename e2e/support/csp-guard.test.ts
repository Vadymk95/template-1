import { describe, expect, it, vi } from 'vitest';

import {
    CSP_REPORT_FUNCTION,
    formatCspViolation,
    isCspConsoleFinding,
    isCspEventFinding,
    isCspViolation,
    isNativeSelectAttrReport,
    listenForCspViolations,
    type CspViolationEvent
} from './csp-guard';

describe('isCspViolation', () => {
    it('matches the Chromium script-block error', () => {
        expect(
            isCspViolation(
                'error',
                "Refused to load the script 'http://127.0.0.1:4173/assets/index.js' because it violates the following Content Security Policy directive: \"script-src 'none'\"."
            )
        ).toBe(true);
    });

    it('matches the Firefox wording with hyphens', () => {
        expect(
            isCspViolation(
                'error',
                "Content-Security-Policy: The page's settings blocked the loading of a resource"
            )
        ).toBe(true);
    });

    it('matches a report-only violation, which is still a finding', () => {
        expect(
            isCspViolation(
                'error',
                '[Report Only] Refused to apply inline style because it violates the following Content Security Policy directive'
            )
        ).toBe(true);
    });

    it('ignores unrelated console errors and non-error messages', () => {
        expect(
            isCspViolation(
                'error',
                'Failed to load resource: the server responded with a status of 404'
            )
        ).toBe(false);
        expect(isCspViolation('log', 'Content Security Policy is enabled')).toBe(false);
        expect(isCspViolation('warning', 'Content Security Policy directive ignored')).toBe(false);
    });
});

describe('formatCspViolation', () => {
    it('names the directive, the blocked resource and where it came from', () => {
        expect(
            formatCspViolation({
                effectiveDirective: 'script-src-elem',
                blockedURI: 'https://cdn.example.com/x.js',
                sourceFile: 'http://127.0.0.1:4173/assets/index.js',
                lineNumber: 4,
                disposition: 'enforce'
            })
        ).toBe(
            'securitypolicyviolation: script-src-elem blocked https://cdn.example.com/x.js at http://127.0.0.1:4173/assets/index.js:4'
        );
    });

    it('says so when an inline or eval violation has no blocked URI, and marks report-only', () => {
        expect(
            formatCspViolation({
                effectiveDirective: 'script-src',
                blockedURI: '',
                sourceFile: '',
                lineNumber: 0,
                disposition: 'report'
            })
        ).toBe('securitypolicyviolation [report-only]: script-src blocked (inline or eval)');
    });
});

describe('listenForCspViolations', () => {
    it('forwards a securitypolicyviolation event, with its target, to the exposed function', () => {
        const report = vi.fn();
        Object.assign(window, { [CSP_REPORT_FUNCTION]: report });
        listenForCspViolations(CSP_REPORT_FUNCTION);

        // jsdom has no SecurityPolicyViolationEvent; the listener reads plain properties off the event.
        const fields = {
            effectiveDirective: 'script-src',
            blockedURI: 'eval',
            sourceFile: 'http://127.0.0.1:4173/assets/index.js',
            lineNumber: 4,
            disposition: 'enforce'
        };
        document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), fields));

        // Raised on the document itself: no element is involved, so there is no tag to report.
        expect(report).toHaveBeenCalledExactlyOnceWith({ ...fields, targetTag: '' });

        // Raised on an element, as a browser does for a refused inline style: the event bubbles up to the
        // document, and the report names the element's tag in lower case.
        const select = document.body.appendChild(document.createElement('select'));
        select.dispatchEvent(
            Object.assign(new Event('securitypolicyviolation', { bubbles: true }), {
                ...fields,
                effectiveDirective: 'style-src-attr'
            })
        );

        expect(report).toHaveBeenCalledTimes(2);
        expect(report).toHaveBeenLastCalledWith({
            ...fields,
            effectiveDirective: 'style-src-attr',
            targetTag: 'select'
        });
        select.remove();
    });
});

/** A WebKit native-select report, as measured on a bare page under the shipped policy. */
const nativeSelectReport: CspViolationEvent = {
    effectiveDirective: 'style-src-attr',
    blockedURI: 'inline',
    sourceFile: '',
    lineNumber: 1,
    disposition: 'enforce',
    targetTag: 'select'
};

const WEBKIT_GENERIC_LINE =
    "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";

describe('isNativeSelectAttrReport', () => {
    it('recognises a refused inline style attribute targeted at a select', () => {
        expect(isNativeSelectAttrReport(nativeSelectReport)).toBe(true);
    });

    it('does not recognise the same directive on any other element', () => {
        for (const targetTag of ['div', 'input', 'option', '']) {
            expect(
                isNativeSelectAttrReport({ ...nativeSelectReport, targetTag }),
                `<${targetTag}> must stay a finding`
            ).toBe(false);
        }
    });

    it('does not recognise another directive on a select', () => {
        for (const effectiveDirective of ['style-src-elem', 'style-src', 'script-src-attr']) {
            expect(
                isNativeSelectAttrReport({ ...nativeSelectReport, effectiveDirective }),
                `${effectiveDirective} on a select must stay a finding`
            ).toBe(false);
        }
    });

    // The measured report blocks `inline` and has no source position; a select report that differs in
    // either is not the native one.
    it('does not recognise a select report that blocks anything but inline', () => {
        for (const blockedURI of ['', 'eval', 'data', 'https://cdn.example.com/x.css']) {
            expect(
                isNativeSelectAttrReport({ ...nativeSelectReport, blockedURI }),
                `blockedURI ${JSON.stringify(blockedURI)} on a select must stay a finding`
            ).toBe(false);
        }
    });

    it('does not recognise a select report that names a source file', () => {
        expect(
            isNativeSelectAttrReport({
                ...nativeSelectReport,
                sourceFile: 'http://127.0.0.1:4173/assets/index.js'
            })
        ).toBe(false);
    });
});

describe('isCspEventFinding', () => {
    it('lets WebKit report its own native select, and only in WebKit', () => {
        expect(isCspEventFinding('webkit', nativeSelectReport)).toBe(false);
        // The same event elsewhere is an inline style someone wrote on a select.
        expect(isCspEventFinding('chromium', nativeSelectReport)).toBe(true);
        expect(isCspEventFinding('firefox', nativeSelectReport)).toBe(true);
    });

    it('still fails every other violation in WebKit', () => {
        expect(isCspEventFinding('webkit', { ...nativeSelectReport, targetTag: 'div' })).toBe(true);
        expect(isCspEventFinding('webkit', { ...nativeSelectReport, blockedURI: 'eval' })).toBe(
            true
        );
        expect(
            isCspEventFinding('webkit', {
                ...nativeSelectReport,
                sourceFile: 'http://127.0.0.1:4173/assets/index.js'
            })
        ).toBe(true);
        expect(
            isCspEventFinding('webkit', {
                ...nativeSelectReport,
                effectiveDirective: 'style-src-elem',
                targetTag: 'style'
            })
        ).toBe(true);
        expect(
            isCspEventFinding('webkit', {
                ...nativeSelectReport,
                effectiveDirective: 'script-src-elem',
                targetTag: 'script'
            })
        ).toBe(true);
    });
});

describe('isCspConsoleFinding', () => {
    it('drops the generic refused-stylesheet line in WebKit only', () => {
        expect(isCspConsoleFinding('webkit', 'error', WEBKIT_GENERIC_LINE)).toBe(false);
        expect(isCspConsoleFinding('chromium', 'error', WEBKIT_GENERIC_LINE)).toBe(true);
        expect(isCspConsoleFinding('firefox', 'error', WEBKIT_GENERIC_LINE)).toBe(true);
    });

    it('still fails any other policy line in WebKit', () => {
        expect(
            isCspConsoleFinding(
                'webkit',
                'error',
                "Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy."
            )
        ).toBe(true);
        expect(
            isCspConsoleFinding(
                'webkit',
                'error',
                "Refused to load the image 'https://cdn.example.com/x.png' because it violates the following Content Security Policy directive: \"img-src 'self' data:\"."
            )
        ).toBe(true);
    });

    it('keeps the rules of isCspViolation: only an error that names the policy', () => {
        expect(isCspConsoleFinding('webkit', 'log', 'Content Security Policy is enabled')).toBe(
            false
        );
        expect(isCspConsoleFinding('chromium', 'error', 'Failed to load resource: 404')).toBe(
            false
        );
    });
});
