/**
 * Class contracts for links in the app chrome (header, footer, any persistent bar).
 *
 * They exist as shared constants rather than as literals in each component because the touch-target
 * rule they encode is easy to get subtly wrong, and a second copy is where it gets lost. Measured
 * before this module existed: the header's nav links rendered at 39.5×20 and the brand at 207.9×24 on
 * every route and every width — below WCAG 2.5.8's 24px minimum for the nav links, and well below the
 * 44px comfortable touch target the geometry harness asserts.
 */

/**
 * `min-h-11` is 44px, and `inline-flex items-center` is what makes it apply at all: min-height is
 * ignored on an inline box, so the same class on a bare `<a>` outside a flex row silently does
 * nothing. Keeping the display mode in the SAME constant is the only way the pair cannot be
 * separated by a later edit.
 */
export const CHROME_LINK_BASE = 'inline-flex min-h-11 items-center';

/**
 * The brand link. `min-w-0` lets it shrink inside the header row instead of pushing the navigation
 * out of the viewport; the truncation itself belongs to an inner element, because `text-overflow`
 * does not apply to a flex container.
 */
export const CHROME_BRAND_LINK = `${CHROME_LINK_BASE} min-w-0 text-base font-semibold tracking-tight`;

/** The inner span of the brand link, where the ellipsis actually happens. */
export const CHROME_BRAND_LABEL = 'truncate';

export const chromeNavLinkClass = ({ isActive }: { isActive: boolean }): string =>
    `${CHROME_LINK_BASE} text-sm transition-colors hover:text-foreground ${
        isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
    }`;
