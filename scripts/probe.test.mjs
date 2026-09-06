import { describe, expect, it, vi } from 'vitest';

import {
    hasRenderedContent,
    measureInPage,
    parseProbeArgs,
    slugForPath,
    waitForContent,
    waitForServer
} from './probe.mjs';

describe('parseProbeArgs', () => {
    it('defaults to the root path and the three-width sweep', () => {
        expect(parseProbeArgs([])).toEqual({ path: '/', widths: [390, 768, 1440], useDev: false });
    });

    it('takes the path first and any widths after it', () => {
        expect(parseProbeArgs(['/login', '390', '1440'])).toEqual({
            path: '/login',
            widths: [390, 1440],
            useDev: false
        });
    });

    it('reads --dev from anywhere in the arguments without eating the path', () => {
        expect(parseProbeArgs(['--dev', '/login'])).toEqual({
            path: '/login',
            widths: [390, 768, 1440],
            useDev: true
        });
    });

    it('refuses a non-numeric width instead of silently probing one viewport', () => {
        // A NaN width would reach setViewportSize and throw somewhere far from the cause.
        expect(() => parseProbeArgs(['/login', 'wide'])).toThrow(/positive numbers/);
    });

    it('refuses a zero width', () => {
        expect(() => parseProbeArgs(['/login', '0'])).toThrow(/positive numbers/);
    });
});

describe('waitForServer', () => {
    /* Written after the first live run failed on ERR_CONNECTION_REFUSED: `page.goto` does not retry
       a refused connection, so a probe with no explicit wait dies before the server finishes
       booting — and the comment that claimed Playwright would retry was the actual defect. */
    it('returns as soon as the server answers', async () => {
        let calls = 0;
        const attempt = await waitForServer(
            () => {
                calls += 1;
                return Promise.resolve(calls === 3);
            },
            { attempts: 10, delayMs: 0 }
        );
        expect(attempt).toBe(3);
    });

    it('throws with a readable reason rather than probing a dead server forever', async () => {
        await expect(
            waitForServer(() => Promise.resolve(false), { attempts: 2, delayMs: 0 })
        ).rejects.toThrow(/never answered/);
    });
});

describe('waitForContent', () => {
    /* The SPA sibling reported "0 controls, 0 headings" on its first live run: `load` fires before
       the app mounts, so the probe measured an empty shell and printed it like data. These cases pin
       both halves — wait for content, and when none comes, SAY so rather than report zeros. */
    const empty = { controls: 0, headings: 0 };
    const mounted = { controls: 5, headings: 1 };

    it('returns as soon as content appears, without waiting out the attempts', async () => {
        let reads = 0;
        const result = await waitForContent(
            () => {
                reads += 1;
                return Promise.resolve(reads < 3 ? empty : mounted);
            },
            { attempts: 20, delayMs: 0 }
        );
        expect(result.rendered).toBe(true);
        expect(reads).toBe(3);
    });

    it('gives up and reports NOT rendered rather than passing an empty page off as a measurement', async () => {
        const result = await waitForContent(() => Promise.resolve(empty), {
            attempts: 3,
            delayMs: 0
        });
        expect(result.rendered).toBe(false);
        expect(result.measurement).toEqual(empty);
    });

    it('counts a heading-only page as rendered — not every route has a control', () => {
        expect(hasRenderedContent({ controls: 0, headings: 1 })).toBe(true);
        expect(hasRenderedContent({ controls: 1, headings: 0 })).toBe(true);
        expect(hasRenderedContent(empty)).toBe(false);
    });
});

describe('slugForPath', () => {
    it('turns a route into a scannable file stem', () => {
        expect(slugForPath('/account/settings')).toBe('account-settings');
    });

    it('keeps the root readable rather than empty', () => {
        expect(slugForPath('/')).toBe('root');
    });

    it('ignores a trailing slash so two spellings of one route share a file', () => {
        expect(slugForPath('/login/')).toBe('login');
    });
});

describe('measureInPage', () => {
    /* The function runs inside the browser, so these cases hand it a stub `document`. What is worth
       pinning is the ARITHMETIC: an overflow reported as a negative number, or a "smallest control"
       picked by width instead of height, is the class of defect that makes a probe reading quietly
       wrong while still looking like data. */
    // The jsdom environment exposes `document` as a getter-only global, so a plain assignment throws;
    // `vi.stubGlobal` redefines the property and `unstubAllGlobals` restores the original.
    const withDocument = (documentStub, run) => {
        vi.stubGlobal('document', documentStub);
        try {
            return run();
        } finally {
            vi.unstubAllGlobals();
        }
    };

    const rect = (width, height) => ({ getBoundingClientRect: () => ({ width, height }) });

    const stubDocument = ({ scrollWidth, clientWidth, controls = [], headings = 0 }) => ({
        documentElement: { scrollWidth, clientWidth },
        title: 'stub',
        querySelectorAll: (selector) =>
            selector.startsWith('h1') ? { length: headings } : controls
    });

    it('reports overflow as the positive difference, never a negative number', () => {
        const measurement = withDocument(
            stubDocument({ scrollWidth: 418, clientWidth: 390 }),
            measureInPage
        );
        expect(measurement.horizontalOverflowPx).toBe(28);
    });

    it('clamps a page narrower than its viewport to zero overflow', () => {
        const measurement = withDocument(
            stubDocument({ scrollWidth: 380, clientWidth: 390 }),
            measureInPage
        );
        expect(measurement.horizontalOverflowPx).toBe(0);
    });

    it('picks the SHORTEST control, because the touch floor is about height', () => {
        const measurement = withDocument(
            stubDocument({
                scrollWidth: 390,
                clientWidth: 390,
                controls: [rect(200, 48), rect(40, 40), rect(300, 56)]
            }),
            measureInPage
        );
        expect(measurement.smallestControl).toBe('40x40');
    });

    it('says "none" rather than crashing when every control measures zero', () => {
        const measurement = withDocument(
            stubDocument({ scrollWidth: 390, clientWidth: 390, controls: [rect(0, 0)] }),
            measureInPage
        );
        expect(measurement.smallestControl).toBe('none');
    });

    it('counts the controls it found, so a probe of an empty page is visibly empty', () => {
        const measurement = withDocument(
            stubDocument({ scrollWidth: 390, clientWidth: 390, controls: [], headings: 2 }),
            measureInPage
        );
        expect(measurement.controls).toBe(0);
        expect(measurement.headings).toBe(2);
    });
});
