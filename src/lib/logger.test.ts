import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type { logger as loggerInstance } from './logger';

type Logger = typeof loggerInstance;
type ConsoleSpy = MockInstance<(...args: unknown[]) => void>;
type ConsoleMethod = 'debug' | 'info' | 'warn' | 'error';

const CONSOLE_METHODS: ConsoleMethod[] = ['debug', 'info', 'warn', 'error'];
const FROZEN_NOW = '2026-10-09T08:00:00.000Z';
const RESET_STYLE = 'color: inherit; font-weight: normal';

// The module reads PROD and MODE once, at import time, so each environment needs a
// fresh module instance. Stubbing the env and re-importing is the public way to get one.
const loadLogger = async (env: { mode: string; prod: boolean }): Promise<Logger> => {
    vi.stubEnv('MODE', env.mode);
    vi.stubEnv('PROD', env.prod);
    vi.resetModules();
    return (await import('./logger')).logger;
};

const loadTestLogger = (): Promise<Logger> => loadLogger({ mode: 'test', prod: false });
const loadDevLogger = (): Promise<Logger> => loadLogger({ mode: 'development', prod: false });
const loadProdLogger = (): Promise<Logger> => loadLogger({ mode: 'production', prod: true });

describe('logger', () => {
    let spies: Record<ConsoleMethod, ConsoleSpy>;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(FROZEN_NOW));
        spies = {
            debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
            info: vi.spyOn(console, 'info').mockImplementation(() => {}),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
            error: vi.spyOn(console, 'error').mockImplementation(() => {})
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    const totalConsoleCalls = (): number =>
        CONSOLE_METHODS.reduce((sum, method) => sum + spies[method].mock.calls.length, 0);

    describe('in the test environment', () => {
        it('stays silent for debug, info and warn so test output stays clean', async () => {
            const logger = await loadTestLogger();

            logger.debug('d');
            logger.info('i');
            logger.warn('w');

            expect(totalConsoleCalls()).toBe(0);
        });

        it('still reports errors, because a swallowed error hides a real failure', async () => {
            const logger = await loadTestLogger();

            logger.error('boom', { code: 'E_TEST' });

            expect(spies.error).toHaveBeenCalledTimes(1);
            expect(spies.error.mock.calls[0]).toContain('boom');
        });
    });

    describe('in development', () => {
        it.each(CONSOLE_METHODS)(
            'routes %s to the console method of the same name',
            async (level) => {
                const logger = await loadDevLogger();

                logger[level]('hello');

                expect(spies[level]).toHaveBeenCalledTimes(1);
                expect(totalConsoleCalls()).toBe(1);
            }
        );

        it('prints an upper-cased level tag and the timestamp, then the message', async () => {
            const logger = await loadDevLogger();

            logger.warn('disk almost full');

            const [prefix, levelStyle, resetStyle, message] = spies.warn.mock.calls[0] as string[];
            expect(prefix).toBe(`%c[WARN]%c ${FROZEN_NOW}`);
            expect(levelStyle).toContain('font-weight: bold');
            expect(resetStyle).toBe(RESET_STYLE);
            expect(message).toBe('disk almost full');
        });

        it('styles every level differently so levels are tellable apart at a glance', async () => {
            const logger = await loadDevLogger();

            for (const level of CONSOLE_METHODS) logger[level]('x');

            const styles = CONSOLE_METHODS.map(
                (level) => (spies[level].mock.calls[0] as string[])[1]
            );
            expect(new Set(styles).size).toBe(CONSOLE_METHODS.length);
        });

        it('passes the context object through as the last argument', async () => {
            const logger = await loadDevLogger();
            const context = { userId: 7, retry: false };

            logger.info('loaded', context);

            const args = spies.info.mock.calls[0];
            expect(args.at(-1)).toBe(context);
            expect(args).toHaveLength(5);
        });

        it('adds no trailing argument when there is no context', async () => {
            const logger = await loadDevLogger();

            logger.error('plain');

            const args = spies.error.mock.calls[0];
            expect(args).toHaveLength(4);
            expect(args.at(-1)).toBe('plain');
        });

        it('treats an empty context object as a context, not as absent', async () => {
            const logger = await loadDevLogger();
            const context = {};

            logger.debug('empty', context);

            expect(spies.debug.mock.calls[0].at(-1)).toBe(context);
        });
    });

    describe('in production', () => {
        it('drops debug and info entirely', async () => {
            const logger = await loadProdLogger();

            logger.debug('d');
            logger.info('i');

            expect(totalConsoleCalls()).toBe(0);
        });

        it('emits warn as one structured JSON line on console.warn', async () => {
            const logger = await loadProdLogger();

            logger.warn('slow response', { ms: 1200 });

            expect(spies.warn).toHaveBeenCalledTimes(1);
            expect(spies.warn.mock.calls[0]).toHaveLength(1);
            expect(JSON.parse(spies.warn.mock.calls[0][0] as string)).toEqual({
                level: 'warn',
                message: 'slow response',
                context: { ms: 1200 },
                ts: FROZEN_NOW
            });
            expect(spies.error).not.toHaveBeenCalled();
        });

        it('emits error as one structured JSON line on console.error', async () => {
            const logger = await loadProdLogger();

            logger.error('request failed', { status: 503 });

            expect(spies.error).toHaveBeenCalledTimes(1);
            expect(spies.error.mock.calls[0]).toHaveLength(1);
            expect(JSON.parse(spies.error.mock.calls[0][0] as string)).toEqual({
                level: 'error',
                message: 'request failed',
                context: { status: 503 },
                ts: FROZEN_NOW
            });
            expect(spies.warn).not.toHaveBeenCalled();
        });

        it('leaves the context key out of the JSON when none is given', async () => {
            const logger = await loadProdLogger();

            logger.error('no context');

            const entry = JSON.parse(spies.error.mock.calls[0][0] as string) as Record<
                string,
                unknown
            >;
            expect(Object.keys(entry).sort()).toEqual(['level', 'message', 'ts']);
        });

        it('carries no console styling directives, which would be noise in a log aggregator', async () => {
            const logger = await loadProdLogger();

            logger.warn('plain text');

            expect(spies.warn.mock.calls[0][0]).not.toContain('%c');
        });
    });
});
