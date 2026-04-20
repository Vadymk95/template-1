import { Component, type ErrorInfo, type FunctionComponent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';
import { logger } from '@/lib/logger';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

interface ErrorFallbackProps {
    isDev: boolean;
    error?: Error;
    onReset: () => void;
    onReload: () => void;
}

const ErrorFallback: FunctionComponent<ErrorFallbackProps> = ({
    isDev,
    error,
    onReset,
    onReload
}) => {
    const { t } = useTranslation('errors');

    return (
        <section
            role="alert"
            aria-live="assertive"
            className="flex min-h-screen flex-col items-center justify-center p-4"
        >
            <div className="max-w-md space-y-4 text-center">
                <h1 className="text-2xl font-bold">{t('boundary.title')}</h1>
                <p className="text-muted-foreground">{t('boundary.description')}</p>

                {isDev && error && (
                    <details className="mt-4 text-left">
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                            {t('boundary.devDetails')}
                        </summary>
                        <pre className="mt-2 overflow-auto rounded-md bg-muted p-4 text-xs">
                            {error.message}
                            {'\n\n'}
                            {error.stack}
                        </pre>
                    </details>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button onClick={onReset} variant="default">
                        {t('boundary.tryAgain')}
                    </Button>
                    <Button onClick={onReload} variant="outline">
                        {t('boundary.reload')}
                    </Button>
                </div>
            </div>
        </section>
    );
};

class ErrorBoundaryComponent extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        logger.error('React ErrorBoundary caught an error', {
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack ?? undefined
        });
        // To add Sentry: Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: undefined });
    };

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <ErrorFallback
                    isDev={import.meta.env.DEV}
                    error={this.state.error}
                    onReset={this.handleReset}
                    onReload={this.handleReload}
                />
            );
        }

        return this.props.children;
    }
}

export const ErrorBoundary = ErrorBoundaryComponent;
