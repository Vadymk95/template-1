import { describe, expect, it, vi } from 'vitest';

import {
    CSP_REPORT_FUNCTION,
    formatCspViolation,
    isCspViolation,
    listenForCspViolations
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
    it('forwards a securitypolicyviolation event to the exposed function', () => {
        const report = vi.fn();
        Object.assign(window, { [CSP_REPORT_FUNCTION]: report });
        listenForCspViolations(CSP_REPORT_FUNCTION);

        // jsdom has no SecurityPolicyViolationEvent; the listener reads plain properties off the event.
        const event = Object.assign(new Event('securitypolicyviolation'), {
            effectiveDirective: 'script-src',
            blockedURI: 'eval',
            sourceFile: 'http://127.0.0.1:4173/assets/index.js',
            lineNumber: 4,
            disposition: 'enforce'
        });
        document.dispatchEvent(event);

        expect(report).toHaveBeenCalledExactlyOnceWith({
            effectiveDirective: 'script-src',
            blockedURI: 'eval',
            sourceFile: 'http://127.0.0.1:4173/assets/index.js',
            lineNumber: 4,
            disposition: 'enforce'
        });
    });
});
