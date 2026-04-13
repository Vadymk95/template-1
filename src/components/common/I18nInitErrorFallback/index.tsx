/**
 * Rendered when i18next fails before translations load. `t()` is unavailable — copy is fixed English.
 */
import { Button } from '@/components/ui';

export const I18nInitErrorFallback = () => (
    <section
        role="alert"
        aria-live="assertive"
        className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-foreground"
    >
        <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold">Unable to load translations</h1>
            <p className="text-muted-foreground">
                Check your network connection and try again. If the problem persists, contact
                support.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                        window.location.reload();
                    }}
                >
                    Reload page
                </Button>
            </div>
        </div>
    </section>
);
