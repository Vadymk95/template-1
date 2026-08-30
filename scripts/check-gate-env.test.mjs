import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// transform URL, so the file-URL form throws ERR_INVALID_URL_SCHEME rather than finding the script.
const SCRIPT = resolve(process.cwd(), 'scripts/check-gate-env.mjs');

const runPreflight = (extraArgs = []) => {
    try {
        const output = execFileSync('node', [SCRIPT, ...extraArgs], { encoding: 'utf8' });
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

    it('without --kill-port a busy port only REFUSES — manual runs never kill anything', async () => {
        held = await listenOn(4173);
        const verdict = runPreflight();
        expect(verdict.code).toBe(1);
        /* The holder here is THIS vitest process; surviving the run is the assertion. */
        expect(verdict.output).toContain('--kill-port');
    });

    it('--kill-port clears a stray listener and proceeds, naming the pid it killed', async () => {
        /* The holder is a SEPARATE child process, never the suite's own server: the gate kills the
           port's owner, and killing the suite would prove the wrong thing the hard way. */
        const { spawn } = await import('node:child_process');
        const holder = spawn(
            'node',
            [
                '-e',
                'require("net").createServer().listen(4173, () => {}); setInterval(() => {}, 1000)'
            ],
            { stdio: 'ignore' }
        );
        await new Promise((resolvePromise) => {
            const probe = () => {
                const socket = createServer();
                socket.once('error', () => {
                    resolvePromise(null);
                });
                socket.once('listening', () => {
                    socket.close(() => setTimeout(probe, 50));
                });
                socket.listen(4173);
            };
            probe();
        });

        const verdict = runPreflight(['--kill-port']);
        try {
            expect(verdict.code).toBe(0);
            expect(verdict.output).toContain('Cleared port 4173');
            expect(verdict.output).toContain(String(holder.pid));
        } finally {
            try {
                holder.kill('SIGKILL');
            } catch {
                /* already dead — the expected case */
            }
        }
    });

    it('--kill-port on a FREE port stays silent and passes', () => {
        const verdict = runPreflight(['--kill-port']);
        expect(verdict.code).toBe(0);
        expect(verdict.output).not.toContain('Cleared');
    });
});
