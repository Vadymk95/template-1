import type { FunctionComponent } from 'react';

/**
 * Placeholder for lazy route transitions rendered inside `<Main />`.
 * It must not own full-page height/layout, otherwise first lazy navigation can
 * briefly create overflow and flash a scrollbar.
 */
export const RouteSkeleton: FunctionComponent = () => (
    <div className="w-full py-4" aria-hidden="true">
        <div className="mx-auto h-9 w-full max-w-md rounded-md bg-muted motion-safe:animate-pulse" />
        <div className="mx-auto mt-4 min-h-[40vh] w-full max-w-lg rounded-lg bg-muted/70 motion-safe:animate-pulse" />
        <div className="mx-auto mt-6 h-4 w-full max-w-40 rounded bg-muted/80 motion-safe:animate-pulse" />
    </div>
);
