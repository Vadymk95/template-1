type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

const IS_PROD = import.meta.env.PROD;
const IS_TEST = import.meta.env.MODE === 'test';

// In prod: only warn/error bubble up — wire to Sentry/Datadog in componentDidCatch or global handler
// In test: suppress everything except errors (keeps test output clean)
// In dev: all levels shown
const SILENT_IN: Record<LogLevel, boolean> = {
    debug: IS_PROD || IS_TEST,
    info: IS_PROD || IS_TEST,
    warn: IS_TEST,
    error: false
};

const LEVEL_STYLE: Record<LogLevel, string> = {
    debug: 'color: #6b7280; font-weight: normal',
    info: 'color: #2563eb; font-weight: normal',
    warn: 'color: #d97706; font-weight: bold',
    error: 'color: #dc2626; font-weight: bold'
};

const log = (level: LogLevel, message: string, context?: LogContext): void => {
    if (SILENT_IN[level]) return;

    const ts = new Date().toISOString();

    if (IS_PROD) {
        // Structured JSON — paste into Sentry.captureMessage / send to log aggregator
        // Wire up in src/lib/sentry.ts when ready (see .cursor/docs/enterprise-upgrade.md)
        const entry = JSON.stringify({ level, message, context, ts });
        if (level === 'error') {
            // eslint-disable-next-line no-console
            console.error(entry);
        } else {
            // eslint-disable-next-line no-console
            console.warn(entry);
        }
        return;
    }

    // Dev: browser-styled output
    const prefix = `%c[${level.toUpperCase()}]%c ${ts}`;
    const reset = 'color: inherit; font-weight: normal';

    if (context !== undefined) {
        // eslint-disable-next-line no-console
        console[level](prefix, LEVEL_STYLE[level], reset, message, context);
    } else {
        // eslint-disable-next-line no-console
        console[level](prefix, LEVEL_STYLE[level], reset, message);
    }
};

export const logger = {
    debug: (message: string, context?: LogContext): void => {
        log('debug', message, context);
    },
    info: (message: string, context?: LogContext): void => {
        log('info', message, context);
    },
    warn: (message: string, context?: LogContext): void => {
        log('warn', message, context);
    },
    error: (message: string, context?: LogContext): void => {
        log('error', message, context);
    }
};
