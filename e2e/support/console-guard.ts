/**
 * What a production page load must not do, as pure predicates the Vitest sibling pins.
 *
 * Two defects hide from every other check because the page still renders: a bundler chunk config
 * that pulls CSS into a JS chunk (the browser then fetches a `.css` file through `<script src>`, and
 * under `X-Content-Type-Options: nosniff` refuses it with a console error on every page), and any
 * other error a visitor never sees but a console does. The CSP guard in `./test.ts` matches policy
 * wording only, so a refused-by-MIME-type script passes it. A third defect is silent for a different
 * reason: a `preconnect` or `dns-prefetch` to another origin opens a connection, and tells that host
 * the visitor is here, before anything asked for it; on a build that self-hosts its fonts and loads
 * no third-party resource it is a leak with no use. The spec that wires these to a page is
 * `e2e/smoke.spec.ts`; the fixture is not automatic because a route that calls an API with no server
 * behind it legitimately logs a failed request.
 */

/** A console message that fails the load: the level a refused script and an uncaught error use. */
export const isConsoleFailure = (type: string): boolean => type === 'error';

/**
 * The `src` of every script whose URL path ends in `.css`. Only the path counts: a query, a hash
 * or a `css` segment elsewhere in the URL is not a stylesheet. An inline script reports an empty
 * `src` and is skipped.
 */
export const stylesheetScriptSources = (sources: readonly string[]): string[] =>
    sources.filter(
        (source) =>
            source !== '' &&
            new URL(source, 'http://localhost').pathname.toLowerCase().endsWith('.css')
    );

/**
 * The `href` of every `preconnect` or `dns-prefetch` hint that points away from `pageOrigin`. The
 * `rel` is a token list, so `preconnect dns-prefetch` counts; `preload` and `stylesheet` links are
 * not hints, and a hint at the page's own origin costs nothing.
 */
export const thirdPartyHintHrefs = (
    hints: readonly { rel: string; href: string }[],
    pageOrigin: string
): string[] =>
    hints
        .filter(({ rel, href }) => {
            const tokens = rel.toLowerCase().split(/\s+/);
            return (
                (tokens.includes('preconnect') || tokens.includes('dns-prefetch')) &&
                new URL(href, pageOrigin).origin !== pageOrigin
            );
        })
        .map(({ href }) => href);
