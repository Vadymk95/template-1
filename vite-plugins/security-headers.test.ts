import { describe, expect, it, vi } from 'vitest';

import {
    buildCsp,
    buildSecurityHeaders,
    renderHeadersFile,
    securityHeaders
} from './security-headers';

/** The set the template promises. Removing one from the source must turn this file red. */
const REQUIRED_HEADERS = [
    'Content-Security-Policy',
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Frame-Options',
    'Cross-Origin-Opener-Policy'
];

const directiveOf = (csp: string, name: string): string | undefined =>
    csp.split('; ').find((directive) => directive.split(' ')[0] === name);

describe('buildSecurityHeaders', () => {
    it('ships every header the template promises, each with a value', () => {
        const headers = buildSecurityHeaders();

        for (const name of REQUIRED_HEADERS) {
            expect(headers[name], name).toBeTruthy();
        }
        expect(Object.keys(headers).sort()).toEqual([...REQUIRED_HEADERS].sort());
    });

    it('pins the values that carry the protection', () => {
        const headers = buildSecurityHeaders();

        expect(headers['X-Content-Type-Options']).toBe('nosniff');
        expect(headers['X-Frame-Options']).toBe('DENY');
        expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
        expect(headers['Strict-Transport-Security']).toMatch(/^max-age=\d{7,}/);
        expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    });
});

describe('buildCsp', () => {
    it('denies by default and allows only the own origin for scripts, styles, fonts and requests', () => {
        const csp = buildCsp();

        expect(directiveOf(csp, 'default-src')).toBe("default-src 'none'");
        expect(directiveOf(csp, 'script-src')).toBe("script-src 'self'");
        expect(directiveOf(csp, 'style-src')).toBe("style-src 'self'");
        expect(directiveOf(csp, 'font-src')).toBe("font-src 'self'");
        expect(directiveOf(csp, 'connect-src')).toBe("connect-src 'self'");
        expect(directiveOf(csp, 'img-src')).toBe("img-src 'self' data:");
    });

    it('blocks framing, base-tag and form-target hijacking in the header', () => {
        const csp = buildCsp();

        expect(directiveOf(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
        expect(directiveOf(csp, 'base-uri')).toBe("base-uri 'self'");
        expect(directiveOf(csp, 'form-action')).toBe("form-action 'self'");
    });

    it('never opens inline or eval execution', () => {
        const csp = buildCsp({ apiUrl: 'https://api.example.com/v1' });

        expect(csp).not.toContain('unsafe-inline');
        expect(csp).not.toContain('unsafe-eval');
        expect(csp).not.toContain('*');
    });

    it('adds the origin, not the path, of an absolute API url to connect-src', () => {
        const csp = buildCsp({ apiUrl: 'https://api.example.com/v1/deals?x=1' });

        expect(directiveOf(csp, 'connect-src')).toBe("connect-src 'self' https://api.example.com");
    });

    it.each([undefined, '', '/api', 'not a url'])(
        'adds nothing to connect-src for the same-origin or unusable value %j',
        (apiUrl) => {
            expect(directiveOf(buildCsp({ apiUrl }), 'connect-src')).toBe("connect-src 'self'");
        }
    );
});

describe('renderHeadersFile', () => {
    it('renders one path block that carries every header (Netlify / Cloudflare Pages format)', () => {
        const headers = buildSecurityHeaders();
        const lines = renderHeadersFile(headers).split('\n');

        expect(lines[0]).toBe('/*');
        for (const [name, value] of Object.entries(headers)) {
            expect(lines).toContain(`  ${name}: ${value}`);
        }
        expect(lines.slice(1, -1).every((line) => line.startsWith('  '))).toBe(true);
    });
});

describe('securityHeaders plugin', () => {
    it('sets every header on a preview response and then continues the chain', () => {
        const plugin = securityHeaders();
        const use = vi.fn();
        const hook = plugin.configurePreviewServer;
        const configure = typeof hook === 'function' ? hook : hook?.handler;
        if (!configure) throw new Error('configurePreviewServer is not defined');

        void configure.call({} as never, { middlewares: { use } } as never);

        expect(use).toHaveBeenCalledOnce();
        const middleware = use.mock.calls[0]?.[0] as (
            request: unknown,
            response: { setHeader: (name: string, value: string) => void },
            next: () => void
        ) => void;
        const setHeader = vi.fn();
        const next = vi.fn();
        middleware({}, { setHeader }, next);

        const sent = Object.fromEntries(setHeader.mock.calls as [string, string][]);
        expect(sent).toEqual(buildSecurityHeaders());
        expect(next).toHaveBeenCalledOnce();
    });

    it('emits dist/_headers from the same source at build', () => {
        const plugin = securityHeaders({ apiUrl: 'https://api.example.com' });
        const emitFile = vi.fn();
        const hook = plugin.generateBundle;
        const generate = typeof hook === 'function' ? hook : hook?.handler;
        if (!generate) throw new Error('generateBundle is not defined');

        void generate.call({ emitFile } as never, {} as never, {}, false);

        expect(emitFile).toHaveBeenCalledWith({
            type: 'asset',
            fileName: '_headers',
            source: renderHeadersFile(buildSecurityHeaders({ apiUrl: 'https://api.example.com' }))
        });
    });
});
