import type { Plugin } from 'vite';

/**
 * Default security response headers: the single source of truth.
 *
 * Three consumers read this one module, so they cannot drift apart:
 * - `vite preview` sends the headers on every response, so the production-mode e2e suite runs
 *   under the policy and fails on a CSP violation (`e2e/support/test.ts`);
 * - the build emits `dist/_headers` from it, the file Netlify and Cloudflare Pages read from the
 *   publish directory (other hosts: `SECURITY_REQUIREMENTS.md` carries the nginx and Vercel recipes);
 * - `vite-plugins/security-headers.test.ts` pins the set.
 *
 * `vite dev` is deliberately left out: HMR needs an inline preamble script and a websocket, and the
 * dev-only MSW worker (`src/mocks/`, never in `dist`) lives there, so the production policy needs
 * no hole for either.
 */

export interface SecurityHeadersOptions {
    /**
     * Value of `VITE_API_URL`. When it is an absolute URL its origin joins `connect-src`; a path
     * (same origin) or no value needs nothing, `'self'` already covers it.
     */
    apiUrl?: string | undefined;
}

const SELF = "'self'";
const NONE = "'none'";

/**
 * Deny by default (`default-src 'none'`), then allow exactly what the app loads: its own origin
 * (scripts, styles, locale files, bundled fonts) and `data:` images. No `'unsafe-inline'` and no
 * `'unsafe-eval'`: `index.html` has no inline script or style (`public/theme-boot.js` is external).
 */
export const buildCsp = ({ apiUrl }: SecurityHeadersOptions = {}): string => {
    const connectSrc = [SELF];
    if (apiUrl !== undefined && URL.canParse(apiUrl)) {
        connectSrc.push(new URL(apiUrl).origin);
    }

    const directives: Record<string, string[]> = {
        'default-src': [NONE],
        'script-src': [SELF],
        'style-src': [SELF],
        'img-src': [SELF, 'data:'],
        'font-src': [SELF],
        'connect-src': connectSrc,
        'base-uri': [SELF],
        'form-action': [SELF],
        // Only effective as a header; a `<meta>` CSP ignores it.
        'frame-ancestors': [NONE]
    };

    return Object.entries(directives)
        .map(([name, sources]) => [name, ...sources].join(' '))
        .join('; ');
};

export const buildSecurityHeaders = (
    options: SecurityHeadersOptions = {}
): Record<string, string> => ({
    'Content-Security-Policy': buildCsp(options),
    // No `preload`: joining the browsers' preload list is a separate, hard-to-undo decision.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Legacy twin of `frame-ancestors 'none'` for browsers that predate CSP level 2.
    'X-Frame-Options': 'DENY',
    // `same-origin` breaks `window.open` popups that must talk back to the opener (some OAuth flows);
    // relax to `same-origin-allow-popups` if the product needs one.
    'Cross-Origin-Opener-Policy': 'same-origin'
});

/** The Netlify / Cloudflare Pages `_headers` format: a path line, then indented `Name: value` lines. */
export const renderHeadersFile = (headers: Record<string, string>): string =>
    ['/*', ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`), ''].join('\n');

export const securityHeaders = (options: SecurityHeadersOptions = {}): Plugin => {
    const headers = buildSecurityHeaders(options);

    return {
        name: 'security-headers',
        configurePreviewServer(server) {
            // Registered directly (not as a returned post hook) so it runs before the static server
            // and the SPA fallback, which makes the headers part of every response.
            server.middlewares.use((_request, response, next) => {
                for (const [name, value] of Object.entries(headers)) {
                    response.setHeader(name, value);
                }
                next();
            });
        },
        generateBundle() {
            this.emitFile({
                type: 'asset',
                fileName: '_headers',
                source: renderHeadersFile(headers)
            });
        }
    };
};
