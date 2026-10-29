import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PORT_RECHECK_MS, isPortBusy } from './check-gate-env.mjs';
import { quietPort } from './quiet-ports.mjs';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// transform URL, so the file-URL form throws ERR_INVALID_URL_SCHEME rather than finding the script.
const SCRIPT = resolve(process.cwd(), 'scripts/check-gate-env.mjs');

const PORT_FREE = quietPort('check-gate-env', 0);
const PORT_BUSY = quietPort('check-gate-env', 1);
const PORT_HOLDER = quietPort('check-gate-env', 2);
const PORT_FREE_FOR_KILL = quietPort('check-gate-env', 3);

/* Every case runs the preflight against a port of its own (GATE_PREFLIGHT_PORT), never the real
   4173: vitest workers, verify-measure's own preview and a gate running in another lane all share
   that port, and a suite that binds it was flaky 1 run in 3 for exactly that reason. The ports come
   from this checkout's quiet window (scripts/quiet-ports.mjs), one per role: a `listen(0)` port
   belongs to the OS's ephemeral range, where parallel tests meet each other's sockets.
   `stdio` pipes stderr: without it execFileSync echoes the child's stderr into the parent, so a green
   run printed "Gate preflight failed" blocks from the cases that expect a refusal.
   `process.execPath`, not `node`: a case may hand the child a PATH that holds no binaries at all. */
const runPreflight = (port, extraArgs = [], envOverrides = {}) => {
    try {
        const output = execFileSync(process.execPath, [SCRIPT, ...extraArgs], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GATE_PREFLIGHT_PORT: String(port), ...envOverrides }
        });
        return { code: 0, output };
    } catch (error) {
        return {
            code: error.status ?? 1,
            output: `${error.stdout ?? ''}${error.stderr ?? ''}`
        };
    }
};

const listenOn = async (port, host) =>
    new Promise((resolvePromise, reject) => {
        const server = createServer();
        server.once('error', reject);
        const ready = () => {
            resolvePromise(server);
        };
        if (host === undefined) server.listen(port, ready);
        else server.listen(port, host, ready);
    });

/* Two capabilities some cases assume without saying so. Each is probed ONCE per file and a case that
   needs a missing one is skipped with the reason printed, never run into a crash or skipped silently:
   - a bindable IPv6 loopback: Docker's default network namespace sets `disable_ipv6=1` on `lo`, so
     binding `::1` throws EADDRNOTAVAIL;
   - `lsof`: a stock Debian image has none, and only the case that kills a real stray needs it (the
     missing-lsof refusal below is proven with an empty PATH on every host). */
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
const lsofProblem = spawnSync('lsof', ['-v'], { stdio: 'ignore' }).error?.code ?? null;
if (ipv6LoopbackProblem !== null) {
    console.warn(
        `check-gate-env.test: SKIPPING the IPv6-loopback case, this host cannot bind ::1 (${ipv6LoopbackProblem}).`
    );
}
if (lsofProblem !== null) {
    console.warn(
        `check-gate-env.test: SKIPPING the stray-listener kill case, lsof is not runnable on this host (${lsofProblem}); install it (apt-get install lsof) to run it.`
    );
}

const itWithLsof = it.skipIf(lsofProblem !== null);
const itWithIpv6Loopback = it.skipIf(ipv6LoopbackProblem !== null);

let held = null;

afterEach(async () => {
    await new Promise((resolvePromise) => held?.close(resolvePromise) ?? resolvePromise(null));
    held = null;
});

/* A look answers "is this port free?" the way the real one does, so `false` is a busy look. The looks
   and the gap between them are injected: these cases open no socket and run no timer, and a one-off
   busy look (a socket another process holds for a millisecond) is exactly what they need to stage. */
describe('isPortBusy', () => {
    const lookingAt = (...answers) => {
        const isFree = vi.fn();
        for (const answer of answers) isFree.mockResolvedValueOnce(answer);
        return isFree;
    };
    const instantWait = () => vi.fn().mockResolvedValue(undefined);

    it('looks again about 150 ms later', () => {
        expect(PORT_RECHECK_MS).toBe(150);
    });

    it('calls a port free after one look when that look finds it free', async () => {
        const isFree = lookingAt(true);
        const wait = instantWait();

        expect(await isPortBusy(PORT_FREE, { isFree, wait })).toBe(false);
        expect(isFree).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });

    it('does not call a port busy for one busy look: the second look finds it free', async () => {
        const isFree = lookingAt(false, true);
        const wait = instantWait();

        expect(await isPortBusy(PORT_FREE, { isFree, wait })).toBe(false);
        expect(isFree).toHaveBeenCalledTimes(2);
    });

    it('calls a port busy when two looks, a gap apart, both find it busy', async () => {
        const isFree = lookingAt(false, false);
        const wait = instantWait();

        expect(await isPortBusy(PORT_BUSY, { isFree, wait })).toBe(true);
        expect(isFree).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledExactlyOnceWith(PORT_RECHECK_MS);
    });

    it('waits between the two looks, never before the first', async () => {
        const isFree = lookingAt(false, false);
        const wait = instantWait();

        await isPortBusy(PORT_BUSY, { isFree, wait });

        const [firstLook, secondLook] = isFree.mock.invocationCallOrder;
        const [gap] = wait.mock.invocationCallOrder;
        expect(firstLook).toBeLessThan(gap);
        expect(gap).toBeLessThan(secondLook);
    });

    it('asks about the same port on both looks', async () => {
        const isFree = lookingAt(false, false);

        await isPortBusy(PORT_BUSY, { isFree, wait: instantWait() });

        expect(isFree).toHaveBeenNthCalledWith(1, PORT_BUSY);
        expect(isFree).toHaveBeenNthCalledWith(2, PORT_BUSY);
    });

    it('sees a port a real socket holds, with the real look', async () => {
        held = await listenOn(PORT_BUSY);

        expect(await isPortBusy(PORT_BUSY)).toBe(true);
    });

    it('sees a free port as free, with the real look', async () => {
        expect(await isPortBusy(PORT_FREE)).toBe(false);
    });

    /* The cases above prove the rule; this one proves the preflight uses it. A single look is
       the same call with one answer, and no socket a test can hold for a millisecond tells the two
       apart through the command line, so the wiring is read from the source: the check and the
       re-probe after a kill both go through isPortBusy, and nothing looks once on its own. */
    it('is what the preflight asks, for the check and for the re-probe after a kill', () => {
        const source = readFileSync(SCRIPT, 'utf8');

        expect(source.match(/await isPortBusy\(PORT\)/g)).toHaveLength(2);
        expect(source).not.toMatch(/\bportIsFree\(/);
    });
});

describe('gate preflight', () => {
    it('passes while the preview port is free', () => {
        expect(runPreflight(PORT_FREE).code).toBe(0);
    });

    it('sees a taken preview port on any interface, and prints the command that frees it', async () => {
        /* Probing `127.0.0.1` alone reports a port FREE while a server is plainly holding it —
           a guard that cannot see the thing it guards. */
        held = await listenOn(PORT_BUSY);
        const verdict = runPreflight(PORT_BUSY);
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain(`Port ${String(PORT_BUSY)} is busy`);
        expect(verdict.output).toContain(`lsof -ti tcp:${String(PORT_BUSY)}`);
    });

    it('without --kill-port a busy port only REFUSES — manual runs never kill anything', async () => {
        held = await listenOn(PORT_BUSY);
        const verdict = runPreflight(PORT_BUSY);
        expect(verdict.code).toBe(1);
        /* The holder here is THIS vitest process; surviving the run is the assertion. */
        expect(verdict.output).toContain('--kill-port');
    });

    itWithLsof('--kill-port clears a stray listener and names the pid it killed', async () => {
        /* The holder is a SEPARATE child process, never the suite's own server: the gate kills the
           port's owner, and killing the suite would prove the wrong thing the hard way. */
        const { spawn } = await import('node:child_process');
        const holder = spawn(
            'node',
            [
                '-e',
                `require("net").createServer().on("error", () => process.exit(2)).listen(${String(PORT_HOLDER)}, () => {}); setInterval(() => {}, 1000)`
            ],
            { stdio: 'ignore' }
        );
        /* Readiness is a CLIENT connect, never a bind: a probe that binds the port it waits for
           races the holder for it, and a holder that loses that race exits on EADDRINUSE — the
           probe then finds the port free forever and the case times out. */
        await new Promise((resolvePromise, reject) => {
            const probe = () => {
                if (holder.exitCode !== null) {
                    reject(
                        new Error(
                            `holder exited with ${String(holder.exitCode)} before listening on ${String(PORT_HOLDER)}`
                        )
                    );
                    return;
                }
                let connected = false;
                const socket = connect(PORT_HOLDER, () => {
                    connected = true;
                    socket.destroy();
                    resolvePromise(null);
                });
                socket.on('error', () => {
                    if (!connected) {
                        setTimeout(probe, 50);
                    }
                });
            };
            probe();
        });

        const verdict = runPreflight(PORT_HOLDER, ['--kill-port']);
        try {
            expect(verdict.code).toBe(0);
            expect(verdict.output).toContain(`Cleared port ${String(PORT_HOLDER)}`);
            expect(verdict.output).toContain(String(holder.pid));
        } finally {
            try {
                holder.kill('SIGKILL');
            } catch {
                /* already dead — the expected case */
            }
        }
    });

    /* A hand-run dev server often binds the IPv6 loopback alone, and a bind-only probe cannot see
       it: the preflight passed and the suite refused minutes later, on a sibling repo, 2026-09-13. */
    itWithIpv6Loopback('sees a listener bound to the IPv6 loopback alone', async () => {
        held = await listenOn(PORT_BUSY, '::1');
        const verdict = runPreflight(PORT_BUSY);
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain(`Port ${String(PORT_BUSY)} is busy`);
    });

    it('--kill-port on a FREE port stays silent and passes', () => {
        const verdict = runPreflight(PORT_FREE_FOR_KILL, ['--kill-port']);
        expect(verdict.code).toBe(0);
        expect(verdict.output).not.toContain('Cleared');
    });

    /* `lsof` finds the pids to kill and nothing else. Every case below hands the child a PATH that
       holds no binary, so it runs the same on a host that has lsof and on one that does not. */
    describe('on a host without lsof', () => {
        let emptyBin;
        let withoutLsof;

        beforeEach(() => {
            emptyBin = mkdtempSync(join(tmpdir(), 'gate-env-no-lsof-'));
            withoutLsof = { PATH: emptyBin };
        });

        afterEach(() => {
            rmSync(emptyBin, { recursive: true, force: true });
        });

        it('still sees a taken port: detection never shells out', async () => {
            held = await listenOn(PORT_BUSY);
            const verdict = runPreflight(PORT_BUSY, [], withoutLsof);
            expect(verdict.code).toBe(1);
            expect(verdict.output).toContain(`Port ${String(PORT_BUSY)} is busy`);
        });

        it('--kill-port fails loud: the port, the cause and the install line', async () => {
            held = await listenOn(PORT_BUSY);
            const verdict = runPreflight(PORT_BUSY, ['--kill-port'], withoutLsof);
            expect(verdict.code).toBe(1);
            expect(verdict.output).toContain(`Port ${String(PORT_BUSY)} is busy`);
            expect(verdict.output).toContain('ENOENT');
            expect(verdict.output).toContain('apt-get install lsof');
            expect(verdict.output).not.toContain('could not clear it');
            expect(verdict.output).not.toContain('Cleared');
        });

        it('--kill-port on a FREE port needs no lsof and stays silent', () => {
            const verdict = runPreflight(PORT_FREE_FOR_KILL, ['--kill-port'], withoutLsof);
            expect(verdict.code).toBe(0);
            expect(verdict.output).not.toContain('lsof');
        });
    });

    /* A refusal is a PASSING case here. Node's execFileSync copies the child's stderr onto its own
       process.stderr unless `stdio` is given, which once printed "Gate preflight failed" blocks
       inside green runs and taught readers to filter the gate's output. */
    it('keeps the stderr of an expected refusal off this process', async () => {
        held = await listenOn(PORT_BUSY);
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        let verdict;
        let echoed;
        try {
            verdict = runPreflight(PORT_BUSY);
            // Read before the restore: restoring a spy also clears what it recorded.
            echoed = [...spy.mock.calls];
        } finally {
            spy.mockRestore();
        }
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain(`Port ${String(PORT_BUSY)} is busy`);
        expect(echoed).toEqual([]);
    });
});
