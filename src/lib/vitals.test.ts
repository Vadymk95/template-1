import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metric } from 'web-vitals';

import { logger } from '@/lib/logger';
import { subscribeWebVitals as subscribeAttribution } from '@/lib/webVitals/subscribeAttribution';
import { subscribeWebVitals as subscribeStandard } from '@/lib/webVitals/subscribeStandard';

import { reportWebVitals } from './vitals';

vi.mock('@/lib/webVitals/subscribeStandard', () => ({ subscribeWebVitals: vi.fn() }));
vi.mock('@/lib/webVitals/subscribeAttribution', () => ({ subscribeWebVitals: vi.fn() }));

const ATTRIBUTION_FLAG = 'VITE_WEB_VITALS_ATTRIBUTION';

const metric = { name: 'LCP', value: 1234, id: 'v5-1' } as Metric;

describe('reportWebVitals', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.mocked(subscribeStandard).mockResolvedValue(undefined);
        vi.mocked(subscribeAttribution).mockResolvedValue(undefined);
        warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.mocked(subscribeStandard).mockReset();
        vi.mocked(subscribeAttribution).mockReset();
    });

    describe('which subscriber it loads', () => {
        it('uses the standard subscriber when the attribution flag is unset', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, undefined);
            const reporter = vi.fn();

            reportWebVitals(reporter);

            await vi.waitFor(() => {
                expect(subscribeStandard).toHaveBeenCalledWith(reporter);
            });
            expect(subscribeAttribution).not.toHaveBeenCalled();
        });

        it('uses the attribution subscriber when the flag is exactly "true"', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, 'true');
            const reporter = vi.fn();

            reportWebVitals(reporter);

            await vi.waitFor(() => {
                expect(subscribeAttribution).toHaveBeenCalledWith(reporter);
            });
            expect(subscribeStandard).not.toHaveBeenCalled();
        });

        it.each(['false', 'TRUE', '1', ''])(
            'uses the standard subscriber when the flag is %j, since only "true" opts in',
            async (value) => {
                vi.stubEnv(ATTRIBUTION_FLAG, value);

                reportWebVitals(vi.fn());

                await vi.waitFor(() => {
                    expect(subscribeStandard).toHaveBeenCalledTimes(1);
                });
                expect(subscribeAttribution).not.toHaveBeenCalled();
            }
        );

        it('subscribes exactly once per call', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, undefined);

            reportWebVitals(vi.fn());

            await vi.waitFor(() => {
                expect(subscribeStandard).toHaveBeenCalledTimes(1);
            });
            expect(warnSpy).not.toHaveBeenCalled();
        });
    });

    describe('the default reporter', () => {
        const defaultReporterOf = async (): Promise<(m: Metric) => void> => {
            vi.stubEnv(ATTRIBUTION_FLAG, undefined);
            reportWebVitals();
            await vi.waitFor(() => {
                expect(subscribeStandard).toHaveBeenCalledTimes(1);
            });
            return vi.mocked(subscribeStandard).mock.calls[0][0];
        };

        it('is handed to the subscriber when the caller passes none', async () => {
            expect(typeof (await defaultReporterOf())).toBe('function');
        });

        it('prints the metric name and payload to the console during development', async () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const reporter = await defaultReporterOf();

            reporter(metric);

            expect(logSpy).toHaveBeenCalledTimes(1);
            expect(logSpy).toHaveBeenCalledWith('[vitals] LCP', metric);
        });

        it('prints nothing in a production build, where it is only a stand-in', async () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const reporter = await defaultReporterOf();
            vi.stubEnv('DEV', false);

            reporter(metric);

            expect(logSpy).not.toHaveBeenCalled();
        });
    });

    describe('when the subscriber fails', () => {
        it('does not throw to the caller, because vitals must never break the app', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, undefined);
            vi.mocked(subscribeStandard).mockRejectedValue(new Error('chunk 404'));

            expect(() => {
                reportWebVitals(vi.fn());
            }).not.toThrow();

            // Let the rejection settle inside this test so it cannot leak into the next one.
            await vi.waitFor(() => {
                expect(warnSpy).toHaveBeenCalledTimes(1);
            });
        });

        it('warns with the failure reason and the standard build marker', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, undefined);
            vi.mocked(subscribeStandard).mockRejectedValue(new Error('chunk 404'));

            reportWebVitals(vi.fn());

            await vi.waitFor(() => {
                expect(warnSpy).toHaveBeenCalledTimes(1);
            });
            expect(warnSpy).toHaveBeenCalledWith(
                '[vitals] failed to load or run web-vitals subscriber',
                { attribution: false, reason: 'chunk 404' }
            );
        });

        it('marks the warning as attribution when that build was requested', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, 'true');
            vi.mocked(subscribeAttribution).mockRejectedValue(new Error('chunk 404'));

            reportWebVitals(vi.fn());

            await vi.waitFor(() => {
                expect(warnSpy).toHaveBeenCalledTimes(1);
            });
            expect(warnSpy).toHaveBeenCalledWith(
                '[vitals] failed to load or run web-vitals subscriber',
                { attribution: true, reason: 'chunk 404' }
            );
        });

        it('stringifies a rejection that is not an Error', async () => {
            vi.stubEnv(ATTRIBUTION_FLAG, undefined);
            vi.mocked(subscribeStandard).mockRejectedValue('offline');

            reportWebVitals(vi.fn());

            await vi.waitFor(() => {
                expect(warnSpy).toHaveBeenCalledTimes(1);
            });
            expect(warnSpy).toHaveBeenCalledWith(
                '[vitals] failed to load or run web-vitals subscriber',
                { attribution: false, reason: 'offline' }
            );
        });
    });
});
