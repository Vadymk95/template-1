import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildChildEnv, findFreePort } from './run-on-free-port.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/run-on-free-port.mjs');

/** Holds a real port on all interfaces so the probe meets a genuinely busy socket. */
const occupyPort = () =>
    new Promise((resolveServer) => {
        const server = createServer();
        server.listen(0, () => {
            resolveServer(server);
        });
    });

let heldServer = null;

afterEach(async () => {
    if (heldServer) {
        await new Promise((resolveClose) => heldServer.close(resolveClose));
        heldServer = null;
    }
});

describe('findFreePort', () => {
    it('returns the base port when it is free', async () => {
        // A port the OS just assigned and released is free again the moment the server closes.
        const server = await occupyPort();
        const base = server.address().port;
        await new Promise((resolveClose) => server.close(resolveClose));
        expect(await findFreePort(base)).toBe(base);
    });

    it('skips a busy base port and lands on the next free one', async () => {
        heldServer = await occupyPort();
        const base = heldServer.address().port;
        const port = await findFreePort(base);
        expect(port).toBeGreaterThan(base);
        expect(port).toBeLessThanOrEqual(base + 20);
    });

    it('throws with a diagnostic when nothing in range is free, instead of hanging', async () => {
        const neverFree = () => Promise.resolve(false);
        await expect(findFreePort(3000, neverFree)).rejects.toThrow(/runaway process/);
    });
});

describe('buildChildEnv', () => {
    it('sets PORT and PLAYWRIGHT_BASE_URL in agreement and keeps the rest', () => {
        const env = buildChildEnv({ HOME: '/home/x' }, 3105);
        expect(env.PORT).toBe('3105');
        expect(env.PLAYWRIGHT_BASE_URL).toBe('http://localhost:3105');
        expect(env.HOME).toBe('/home/x');
    });
});

describe('run-on-free-port CLI', () => {
    it('hands the child the reassigned port when the base is busy, and says so', async () => {
        heldServer = await occupyPort();
        const base = heldServer.address().port;
        const output = execFileSync(
            'node',
            [
                SCRIPT,
                'node',
                '-e',
                'console.log(process.env.PORT, process.env.PLAYWRIGHT_BASE_URL)'
            ],
            { encoding: 'utf8', env: { ...process.env, PORT: String(base) } }
        );
        expect(output).toContain(`Port ${String(base)} is busy`);
        const reassigned = base + 1;
        expect(output).toContain(`${String(reassigned)} http://localhost:${String(reassigned)}`);
    });

    it('passes the child’s failing exit code through untouched', () => {
        let code = 0;
        try {
            execFileSync('node', [SCRIPT, 'node', '-e', 'process.exit(3)'], {
                encoding: 'utf8',
                env: { ...process.env, PORT: '0' }
            });
        } catch (error) {
            code = error.status;
        }
        // PORT=0 probes from 0, which the OS treats as "assign one" and always grants — the
        // child still runs and its own exit code must be the verdict.
        expect(code).toBe(3);
    });

    it('rejects a call with no command instead of spinning on nothing', () => {
        let verdict = { status: 0, output: '' };
        try {
            execFileSync('node', [SCRIPT], { encoding: 'utf8' });
        } catch (error) {
            verdict = {
                status: error.status,
                output: `${error.stdout ?? ''}${error.stderr ?? ''}`
            };
        }
        expect(verdict.status).toBe(2);
        expect(verdict.output).toContain('Usage:');
    });
});
