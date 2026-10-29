import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { quietPort } from './quiet-ports.mjs';
import { buildChildEnv, findFreePort } from './run-on-free-port.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/run-on-free-port.mjs');

/* Every child captures its output. `execFileSync` copies the child's stderr onto the test run's
   unless `stdio` is given, so the usage line a case provokes would land in every log; the cases
   read the captured text back for their assertions. */
const CAPTURE = ['ignore', 'pipe', 'pipe'];

/* The base every case starts from, in this checkout's quiet window (scripts/quiet-ports.mjs). Not
   `listen(0)`: the OS hands those out from its ephemeral range, in sequence on macOS, so the
   neighbours a walk from there lands on belong to other tests and processes. */
const BASE = quietPort('run-on-free-port');

/** Holds a real port so the probe meets a genuinely busy socket; `host` narrows which family. */
const occupyPort = (host) =>
    new Promise((resolveServer, rejectServer) => {
        const server = createServer();
        server.once('error', rejectServer);
        const ready = () => {
            resolveServer(server);
        };
        if (host === undefined) server.listen(BASE, ready);
        else server.listen(BASE, host, ready);
    });

/* A bindable IPv6 loopback is a capability, not a given: Docker's default network namespace sets
   `disable_ipv6=1` on `lo`, and binding `::1` there throws EADDRNOTAVAIL. Probed ONCE per file; the
   case that needs it is skipped with the reason printed, never run into a crash or skipped silently.
   Port 0 on purpose: only the capability is probed, and the socket closes before any case runs. */
const ipv6LoopbackProblem = await new Promise((resolveProbe) => {
    const probe = createServer();
    probe.once('error', (error) => {
        resolveProbe(String(error.code ?? error.message));
    });
    probe.listen(0, '::1', () => {
        probe.close(() => {
            resolveProbe(null);
        });
    });
});
if (ipv6LoopbackProblem !== null) {
    console.warn(
        `run-on-free-port.test: SKIPPING the IPv6-loopback case, this host cannot bind ::1 (${ipv6LoopbackProblem}).`
    );
}
const itWithIpv6Loopback = it.skipIf(ipv6LoopbackProblem !== null);

let heldServer = null;

afterEach(async () => {
    if (heldServer) {
        await new Promise((resolveClose) => heldServer.close(resolveClose));
        heldServer = null;
    }
});

describe('findFreePort', () => {
    it('returns the base port when it is free', async () => {
        expect(await findFreePort(BASE)).toBe(BASE);
    });

    it('holds its ports below both ephemeral ranges, where no parallel test or browser takes one', async () => {
        heldServer = await occupyPort();
        expect(heldServer.address().port).toBeLessThan(32_768);
    });

    it('skips a busy base port and lands on the next free one', async () => {
        heldServer = await occupyPort();
        const base = heldServer.address().port;
        const port = await findFreePort(base);
        expect(port).toBeGreaterThan(base);
        expect(port).toBeLessThanOrEqual(base + 20);
    });

    /*
     * The case that cost a whole gate on a sibling repo, 2026-09-13: a dev server on the IPv6
     * loopback ONLY. A bind on the unspecified address still succeeds there, so a bind-only probe
     * called the port free — while Playwright, which fetches `http://localhost:<port>` and reaches
     * ::1 first, refused with "already used".
     */
    itWithIpv6Loopback(
        'sees an IPv6-loopback-only listener, which a bind probe does not',
        async () => {
            heldServer = await occupyPort('::1');
            const base = heldServer.address().port;
            expect(await findFreePort(base)).toBeGreaterThan(base);
        }
    );

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
            { encoding: 'utf8', env: { ...process.env, PORT: String(base) }, stdio: CAPTURE }
        );
        /* The lane lands on the NEXT FREE port, not necessarily base + 1: a listener this suite
           does not know about may sit on a neighbour, and a fixed `base + 1` assertion was flaky
           when the base was an OS-assigned port whose neighbours any process could take. Read the
           port the script announced and check the child received the same one. */
        const announced = output.match(/is busy — this lane runs on (\d+)\./);
        expect(announced, output).not.toBeNull();
        const reassigned = Number(announced[1]);
        expect(reassigned).toBeGreaterThan(base);
        expect(reassigned).toBeLessThanOrEqual(base + 20);
        expect(output).toContain(`${String(reassigned)} http://localhost:${String(reassigned)}`);
    });

    it('passes the child’s failing exit code through untouched', () => {
        let code = 0;
        try {
            execFileSync('node', [SCRIPT, 'node', '-e', 'process.exit(3)'], {
                encoding: 'utf8',
                env: { ...process.env, PORT: String(BASE) },
                stdio: CAPTURE
            });
        } catch (error) {
            code = error.status;
        }
        // The port is free, so the child runs and its own exit code must be the verdict.
        expect(code).toBe(3);
    });

    it('says why when the command never starts, and still fails', () => {
        let verdict = { status: 0, output: '' };
        try {
            execFileSync(process.execPath, [SCRIPT, 'no-such-binary-on-this-host'], {
                encoding: 'utf8',
                stdio: CAPTURE,
                env: { ...process.env, PORT: String(BASE) }
            });
        } catch (error) {
            verdict = {
                status: error.status,
                output: `${error.stdout ?? ''}${error.stderr ?? ''}`
            };
        }
        expect(verdict.status).toBe(1);
        expect(verdict.output).toContain('Could not start `no-such-binary-on-this-host`');
        expect(verdict.output).toContain('ENOENT');
    });

    it('rejects a call with no command instead of spinning on nothing', () => {
        let verdict = { status: 0, output: '' };
        try {
            execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: CAPTURE });
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
