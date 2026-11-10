// Trial only: which font each engine draws for the page's stack, so the Playwright image and the
// runner can be compared. Every output line starts with FONT-PROBE. Always exits 0: a failed engine
// is printed, never thrown, so the probe cannot turn a job red.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const STACKS = {
    page: 'Inter, ui-sans-serif, system-ui, sans-serif',
    dejavu: "'DejaVu Sans'",
    liberation: "'Liberation Sans'",
    wqy: "'WenQuanYi Zen Hei'",
    freesans: 'FreeSans'
};
const TEXT = 'The quick brown fox jumps over the lazy dog 0123456789';

const log = (message) => {
    process.stdout.write(`${`FONT-PROBE ${message}`.replaceAll('\n', ' | ')}\n`);
};

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

const html = `<html lang="en"><body>${Object.entries(STACKS)
    .map(
        ([key, stack]) =>
            `<div><span id="${key}" style="font: 16px ${stack}; white-space: nowrap">${TEXT}</span></div>`
    )
    .join('')}</body></html>`;

const release = () => {
    try {
        const line = readFileSync('/etc/os-release', 'utf8')
            .split('\n')
            .find((entry) => entry.startsWith('PRETTY_NAME='));
        return line ? line.slice('PRETTY_NAME='.length).replaceAll('"', '') : 'unknown';
    } catch (error) {
        return `unreadable (${firstLine(error)})`;
    }
};

const fcMatch = (pattern) => {
    try {
        return execFileSync('fc-match', [pattern], { encoding: 'utf8' }).trim();
    } catch (error) {
        return `unavailable (${firstLine(error)})`;
    }
};

const widthsOf = (page) =>
    page.evaluate(
        (keys) =>
            Object.fromEntries(
                keys.map((key) => [
                    key,
                    Math.round(document.getElementById(key).getBoundingClientRect().width * 10) / 10
                ])
            ),
        Object.keys(STACKS)
    );

const chromiumFonts = async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '#page'
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((font) => `${font.familyName}(${font.glyphCount})`).join(',');
};

const probe = async (name, type) => {
    let browser;
    try {
        browser = await type.launch();
        const page = await browser.newPage();
        await page.setContent(html);
        const widths = await widthsOf(page);
        const same = Object.entries(widths)
            .filter(([key, width]) => key !== 'page' && width === widths.page)
            .map(([key]) => key);
        const platform = name === 'chromium' ? ` cdp=${await chromiumFonts(page)}` : '';
        log(
            `${name} page=${widths.page} same-as=[${same.join(',')}] all=${JSON.stringify(widths)}${platform}`
        );
    } catch (error) {
        log(`${name} failed: ${firstLine(error)}`);
    } finally {
        await browser?.close().catch(() => undefined);
    }
};

const main = async () => {
    log(`os=${release()}`);
    log(`fc-match sans-serif:lang=en -> ${fcMatch('sans-serif:lang=en')}`);
    log(`fc-match system-ui:lang=en -> ${fcMatch('system-ui:lang=en')}`);
    const playwright = require('playwright-core');
    for (const name of ['chromium', 'firefox', 'webkit']) {
        await probe(name, playwright[name]);
    }
};

main().catch((error) => {
    log(`probe failed: ${firstLine(error)}`);
});
