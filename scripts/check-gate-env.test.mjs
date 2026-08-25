import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// transform URL, so the file-URL form throws ERR_INVALID_URL_SCHEME rather than finding the script.
const SCRIPT = resolve(process.cwd(), 'scripts/check-gate-env.mjs');

const runPreflight = () => {
    try {
        const output = execFileSync('node', [SCRIPT], { encoding: 'utf8' });
        return { code: 0, output };
    } catch (error) {
        return {
            code: error.status ?? 1,
            output: `${error.stdout ?? ''}${error.stderr ?? ''}`
        };
    }
};

const listenOn = async (port) =>
    new Promise((resolvePromise, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(port, () => {
            resolvePromise(server);
        });
    });

let held = null;

afterEach(async () => {
    await new Promise((resolvePromise) => held?.close(resolvePromise) ?? resolvePromise(null));
    held = null;
});

describe('gate preflight', () => {
    it('passes while the preview port is free', () => {
        expect(runPreflight().code).toBe(0);
    });

    it('sees a taken preview port on any interface, and prints the command that frees it', async () => {
        /* Probing `127.0.0.1` alone reports a port FREE while a server is plainly holding it —
           a guard that cannot see the thing it guards. */
        held = await listenOn(4173);
        const verdict = runPreflight();
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain('Port 4173 is busy');
        expect(verdict.output).toContain('lsof -ti tcp:4173');
    });
});
