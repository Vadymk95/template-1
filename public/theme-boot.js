/*
 * Theme boot — runs before the first paint, from <head>, as an external file so a nonce-based CSP
 * (`script-src 'self'`) allows it without `'unsafe-inline'`. It applies the same decision
 * `src/hooks/theme/useTheme.ts` makes later (localStorage `theme` → light / dark / system → OS
 * preference), so the page never paints the light tokens and then flips to dark after hydration.
 * Keep the storage key equal to STORAGE_KEYS.THEME in `src/store/keys.ts`.
 */
(function () {
    try {
        const stored = window.localStorage.getItem('theme');
        const dark =
            stored === 'dark' ||
            (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
    } catch {
        /* storage blocked (private mode, strict cookies): the app's hook decides after mount */
    }
})();
