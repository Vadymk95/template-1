import type { FunctionComponent } from 'react';

/**
 * Placeholder layout for lazy route transitions — reserves header/main/footer regions
 * to reduce CLS while Suspense resolves.
 */
export const RouteSkeleton: FunctionComponent = () => (
    <div className="flex min-h-screen flex-col bg-background" aria-hidden="true">
        <div className="border-b bg-card py-4">
            <div className="container mx-auto h-6 max-w-[12rem] rounded-md bg-muted motion-safe:animate-pulse" />
        </div>
        <div className="container mx-auto flex flex-1 flex-col justify-center gap-4 py-12">
            <div className="mx-auto h-9 w-full max-w-md rounded-md bg-muted motion-safe:animate-pulse" />
            <div className="mx-auto min-h-[40vh] w-full max-w-lg rounded-lg bg-muted/70 motion-safe:animate-pulse" />
        </div>
        <div className="mt-auto border-t bg-card py-6">
            <div className="container mx-auto h-4 max-w-[8rem] rounded bg-muted/80 motion-safe:animate-pulse" />
        </div>
    </div>
);
