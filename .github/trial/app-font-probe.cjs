// Trial only: does the BUILT app render the same boxes on every engine and viewport, in this job?
// Starts `vite preview` on its own port (4399, so the 4173 server of later steps is untouched),
// measures the page per engine and viewport, and prints one summary line and one boxes line each.
// Every output line starts with FONT-PROBE-APP. Always exits 0: an error is printed, never thrown.
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

const PORT = 4399;
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const ENGINES = ['chromium', 'firefox', 'webkit'];
const VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 1440, height: 900 }
];
const BOX_SELECTOR = 'h1,h2,h3,p,a,button,label,li';
const BOX_LIMIT = 25;
const START_TIMEOUT_MS = 60_000;
const MOUNT_TIMEOUT_MS = 15_000;

const emit = (tag, message) => {
    process.stdout.write(`${`${tag} ${message}`.replaceAll('\n', ' | ')}\n`);
};

const log = (message) => {
    emit('FONT-PROBE-APP', message);
};

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

const startPreview = () => {
    const child = spawn(
        'npm',
        ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
        { detached: true, stdio: 'ignore' }
    );
    const state = { child, failed: null };
    child.on('error', (error) => {
        state.failed = firstLine(error);
    });
    child.on('exit', (code) => {
        state.failed ??= `preview exited with code ${String(code)}`;
    });
    child.unref();
    return state;
};

/** Kills the whole process group, so npm, its shell and vite all go. */
const stopPreview = ({ child }) => {
    try {
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        // The group is already gone.
    }
};

const isUp = async () => {
    try {
        const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
        return response.status === 200;
    } catch {
        return false;
    }
};

const waitForPreview = async (state) => {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (state.failed) throw new Error(state.failed);
        if (await isUp()) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`no HTTP 200 from ${BASE_URL} within ${String(START_TIMEOUT_MS / 1000)} s`);
};

/** Runs in the page: Inter faces loaded, the document size and the first visible boxes. */
const measurePage = ({ selector, limit }) => {
    const round = (value) => Math.round(value * 10) / 10;
    const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden'
        );
    };
    const boxes = [...document.querySelectorAll(selector)]
        .filter(isVisible)
        .slice(0, limit)
        .map((element) => {
            const rect = element.getBoundingClientRect();
            return [element.tagName.toLowerCase(), round(rect.width), round(rect.height)];
        });
    const interLoaded = [...document.fonts].filter(
        (face) => face.family.includes('Inter') && face.status === 'loaded'
    ).length;
    return {
        interLoaded,
        doc: `${String(document.documentElement.scrollWidth)}x${String(document.documentElement.scrollHeight)}`,
        boxes
    };
};

const platformFonts = async (page, selector) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return null;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const list = fonts.map((font) => `${font.familyName}(${font.glyphCount})`).join('+');
    return `${selector}=${list.replaceAll(' ', '_')}`;
};

const chromiumFonts = async (page) => {
    const found = [];
    for (const selector of ['h1', 'p']) {
        const entry = await platformFonts(page, selector);
        if (entry) found.push(entry);
    }
    return found.length > 0 ? found.join(';') : '-';
};

const probeViewport = async (browser, engine, viewport) => {
    const size = `${String(viewport.width)}x${String(viewport.height)}`;
    const context = await browser.newContext({ viewport });
    try {
        const page = await context.newPage();
        await page.goto(BASE_URL);
        try {
            await page.waitForSelector('h1', { state: 'visible', timeout: MOUNT_TIMEOUT_MS });
        } catch {
            log(`${engine} ${size} error: app did not mount (no visible h1 in 15 s)`);
            return;
        }
        await page.evaluate(() => document.fonts.ready.then(() => true));
        const measured = await page.evaluate(measurePage, {
            selector: BOX_SELECTOR,
            limit: BOX_LIMIT
        });
        const json = JSON.stringify(measured.boxes);
        const hash = createHash('sha256').update(json).digest('hex').slice(0, 12);
        const cdp = engine === 'chromium' ? await chromiumFonts(page) : 'n/a';
        log(
            `${engine} ${size} inter_loaded=${String(measured.interLoaded)} doc=${measured.doc} boxes=${hash} cdp=${cdp}`
        );
        emit('FONT-PROBE-APP-BOXES', `${engine} ${size} ${json}`);
    } catch (error) {
        log(`${engine} ${size} error: ${firstLine(error)}`);
    } finally {
        await context.close().catch(() => undefined);
    }
};

const probeEngine = async (playwright, engine) => {
    let browser;
    try {
        browser = await playwright[engine].launch();
        for (const viewport of VIEWPORTS) {
            await probeViewport(browser, engine, viewport);
        }
    } catch (error) {
        log(`${engine} launch error: ${firstLine(error)}`);
    } finally {
        await browser?.close().catch(() => undefined);
    }
};

const main = async () => {
    const state = startPreview();
    try {
        await waitForPreview(state);
        const playwright = require('playwright-core');
        for (const engine of ENGINES) {
            await probeEngine(playwright, engine);
        }
    } catch (error) {
        log(`probe error: ${firstLine(error)}`);
    } finally {
        stopPreview(state);
    }
};

main().catch((error) => {
    log(`probe error: ${firstLine(error)}`);
});
