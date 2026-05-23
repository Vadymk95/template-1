/**
 * Dev-only runtime guards: suppress false-positive errors that don't affect
 * production. Wire from `main.tsx` early (before React boots) so handlers
 * are registered before any TanStack Query observer subscribes.
 *
 * Extend this with additional dev-only handlers as needed.
 */
export const installDevGuards = (): void => {
    if (!import.meta.env.DEV) return;

    // React 19 + StrictMode double-mount causes TanStack Query observers to
    // unsubscribe immediately after subscribing, which aborts in-flight fetches
    // via AbortController. The browser surfaces this as
    // "AbortError: signal is aborted without reason" — dev-mode noise; prod
    // unaffected (no StrictMode double-mount outside dev builds).
    // Source: https://github.com/TanStack/query/discussions/6034
    window.addEventListener('unhandledrejection', (event) => {
        if (event.reason instanceof DOMException && event.reason.name === 'AbortError') {
            event.preventDefault();
        }
    });
};
