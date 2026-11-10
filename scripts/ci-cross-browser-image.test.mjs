import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractRunSteps } from './docs-check.mjs';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there.
const ROOT = process.cwd();
const CI_PATH = '.github/workflows/ci.yml';
const LOCK_PATH = 'package-lock.json';
const LOCK_KEY = 'node_modules/@playwright/test';

const IMAGE =
    'mcr.microsoft.com/playwright:v${{ needs.playwright-image.outputs.version }}-resolute';
const PLAIN_VERSION = /^\d+\.\d+\.\d+$/;

const ci = readFileSync(path.join(ROOT, CI_PATH), 'utf8');

/** The lines of one top-level job: from its `    <name>:` key up to the next 4-space-indented line. */
const jobLines = (text, name) => {
    const lines = text.split('\n');
    const start = lines.indexOf(`    ${name}:`);
    if (start === -1) return null;
    let end = start + 1;
    while (end < lines.length && !/^ {4}\S/.test(lines[end])) end += 1;
    return lines.slice(start, end);
};

const withoutComments = (lines) => lines.filter((line) => !line.trim().startsWith('#'));

/** A key of the job itself (8 spaces), not of a step. */
const jobKey = (lines, key) => lines.find((line) => line.startsWith(`        ${key}:`))?.trim();

/** The lines nested under the job key `key`. */
const nestedUnder = (lines, key) => {
    const start = lines.findIndex((line) => line.startsWith(`        ${key}:`));
    if (start === -1) return [];
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === '' || /^ {9,}\S/.test(lines[end])))
        end += 1;
    return lines.slice(start + 1, end).map((line) => line.trim());
};

const crossBrowser = jobLines(ci, 'cross-browser');
const imageJob = jobLines(ci, 'playwright-image');

describe('the cross-browser job runs in the official Playwright image', () => {
    it('finds the cross-browser job in ci.yml', () => {
        expect(
            crossBrowser,
            `${CI_PATH} has no \`cross-browser:\` job at 4-space indent; keep the job name, the required check is called that`
        ).not.toBeNull();
    });

    it('runs in the image whose tag is the locked version on the runner Ubuntu release', () => {
        const container = nestedUnder(crossBrowser ?? [], 'container');
        expect(
            container,
            `cross-browser must run in \`container: image: ${IMAGE}\`; the image ships the browsers and the libraries, so the job installs nothing from apt`
        ).toContain(`image: ${IMAGE}`);
        expect(
            container,
            'cross-browser needs `options: --user 1001` under `container:`; 1001 is the runner uid, so checkout and setup-node write the workspace as before'
        ).toContain('options: --user 1001');
    });

    it('needs the version job and still runs when it fails, so a missing image fails the required check', () => {
        expect(
            jobKey(crossBrowser ?? [], 'needs'),
            'cross-browser needs `needs: playwright-image` to read the image tag'
        ).toBe('needs: playwright-image');
        expect(
            jobKey(crossBrowser ?? [], 'if'),
            'cross-browser needs `if: ${{ !cancelled() }}`: a job skipped because a needed job failed reports success, and cross-browser is a required check'
        ).toBe('if: ${{ !cancelled() }}');
    });

    it('reads the version from the lock file in a job that exports it as `version`', () => {
        expect(
            imageJob,
            `${CI_PATH} needs a \`playwright-image:\` job before cross-browser that reads the locked @playwright/test version`
        ).not.toBeNull();
        const lines = withoutComments(imageJob ?? []);
        const output = lines.find((line) =>
            /^\s+version: \$\{\{ steps\.[\w-]+\.outputs\.version \}\}$/.test(line)
        );
        expect(
            output,
            'the playwright-image job must declare `outputs:` `version: ${{ steps.<id>.outputs.version }}`'
        ).toBeDefined();
        const stepId = /steps\.([\w-]+)\./.exec(output ?? '')?.[1];
        expect(
            lines.some((line) => line.trim() === `id: ${stepId}`),
            `the playwright-image job declares its output from step \`${String(stepId)}\`, but no step has \`id: ${String(stepId)}\``
        ).toBe(true);

        const run = extractRunSteps(imageJob.join('\n')).map(({ command }) => command);
        expect(
            run.some(
                (command) =>
                    command.includes(`.packages["${LOCK_KEY}"].version`) &&
                    command.includes(LOCK_PATH)
            ),
            `a run line of playwright-image must read .packages["${LOCK_KEY}"].version from ${LOCK_PATH}: the lock file is the one source of the version`
        ).toBe(true);
        expect(
            run.some((command) => /version=.*>>\s*"?\$GITHUB_OUTPUT"?/.test(command)),
            'a run line of playwright-image must write `version=...` to "$GITHUB_OUTPUT", or the output stays empty'
        ).toBe(true);
    });

    it('installs nothing from apt in the job', () => {
        const runs = extractRunSteps((crossBrowser ?? []).join('\n')).map(({ command }) => command);
        const offending = runs.filter((command) =>
            /\b(apt|apt-get|sudo|install-deps)\b/.test(command)
        );
        expect(
            offending,
            'cross-browser runs apt, sudo or install-deps; the image carries the libraries, and a package install on the runner is the stall this job left'
        ).toEqual([]);
    });
});

describe('the lock file keeps the key the version job reads', () => {
    it(`has a plain x.y.z version at packages["${LOCK_KEY}"]`, () => {
        const lock = JSON.parse(readFileSync(path.join(ROOT, LOCK_PATH), 'utf8'));
        const version = lock.packages?.[LOCK_KEY]?.version;
        expect(
            PLAIN_VERSION.test(String(version)),
            `${LOCK_PATH} has no plain x.y.z version at packages["${LOCK_KEY}"] (got ${String(version)}); the playwright-image job reads exactly that key, so change its jq path in ${CI_PATH} with the lock layout`
        ).toBe(true);
    });
});
