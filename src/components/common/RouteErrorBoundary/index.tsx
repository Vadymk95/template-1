import type { FunctionComponent } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { Button } from '@/components/ui';
import { logger } from '@/lib/logger';

/**
 * Router error boundary — `t()` may be unavailable; copy matches I18nInitErrorFallback (English-only).
 */
export const RouteErrorBoundary: FunctionComponent = () => {
    const error = useRouteError();

    const isResponse = isRouteErrorResponse(error);
    const status = isResponse ? error.status : undefined;
    const statusText = isResponse ? error.statusText : undefined;

    const message = error instanceof Error ? error.message : String(error);
    logger.error('[route]', {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        status,
        statusText
    });

    const handleRetry = () => {
        window.location.reload();
    };

    return (
        <section
            role="alert"
            aria-live="assertive"
            className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground"
        >
            <div className="max-w-md space-y-4 text-center">
                <h1 className="text-2xl font-bold">Something went wrong</h1>
                {status !== undefined ? (
                    <p className="text-muted-foreground">
                        {status}
                        {statusText ? ` ${statusText}` : ''}
                    </p>
                ) : (
                    <p className="text-muted-foreground">
                        The page failed to load. You can try again or reload the app.
                    </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button type="button" variant="default" onClick={handleRetry}>
                        Try again
                    </Button>
                </div>
            </div>
        </section>
    );
};
