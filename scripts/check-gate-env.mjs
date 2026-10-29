#!/usr/bin/env node
/**
 * Preflight for the full gate: refuse to start a run that cannot succeed, and print the command
 * that fixes it — a preflight that says "something is missing" has moved the puzzle, not solved it.
 *
 * One check, on purpose. This template's build validates no required environment (a clean clone
 * must pass the gate), so there is no env leg here — a check that cannot fail would only claim
 * coverage. What CAN kill the run late is the e2e port: the gate's Playwright starts `vite preview`
 * on 4173 with `--strictPort` and `reuseExistingServer: false`, so anything already listening there
 * fails the suite minutes in — or, before that rule, silently measured a preview from another branch.
 *
 * Detection never needs a tool: a port is busy when something answers on a loopback or the bind
 * fails. `lsof` is used for one thing only, finding the pids to kill under `--kill-port`, and a host
 * without it (a stock Debian image has none; macOS ships it) is told so, with the port and the
 * install line, instead of being told the port "could not be cleared".
 */
import { spawnSync } from 'node:child_process';
import { connect, createServer } from 'node:net';

import { isEntryPoint } from './is-entry-point.mjs';

/* The preview port the gate's Playwright run binds (playwright.config.ts). GATE_PREFLIGHT_PORT is a
   test seam only: the suite points the preflight at a port of its own so it never touches the
   machine's real 4173 — a suite that binds the gate's own port races every other lane for it. */
const PORT = Number(process.env.GATE_PREFLIGHT_PORT ?? 4173);

/**
 * --kill-port: the PUSH GATE owns the machine while it runs — heavy stages are serialised at the
 * push by rule, so anything still listening on the gate's port is a stray from an earlier lane (a
 * leftover preview). The gate clears it and says what it killed. Parallel agent lanes do the
 * OPPOSITE: they move to a free port (scripts/run-on-free-port.mjs) and never kill a server they
 * did not start. Without the flag this preflight only refuses, for manual runs.
 */
const shouldKillPort = process.argv.includes('--kill-port');

const sleep = (ms) =>
    new Promise((resolvePromise) => {
        setTimeout(resolvePromise, ms);
    });

/**
 * The pids listening on `port`, or the reason `lsof` could not look. "Nobody listens" and "cannot
 * look" are different answers: a spawn that never ran (ENOENT) must not read as an empty port.
 */
const listeningPids = (port) => {
    const result = spawnSync('lsof', ['-ti', `tcp:${String(port)}`, '-sTCP:LISTEN'], {
        encoding: 'utf8'
    });
    if (result.error) {
        return { pids: [], lookupError: result.error };
    }
    if (result.status !== 0 || !result.stdout) {
        return { pids: [] };
    }
    const pids = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .map(Number)
        .filter((pid) => pid !== process.pid);
    return { pids };
};

/** What to tell a host where `lsof` cannot run: the port, the cause, the install line. */
const lsofUnavailableHint = (port, lookupError) =>
    `--kill-port needs lsof to find what holds port ${String(port)}, and lsof cannot run here (${String(lookupError.code ?? lookupError.message)}).\n` +
    `      Install it (Debian/Ubuntu: apt-get install lsof; macOS ships it) and run again, or free port ${String(port)} by hand.`;

const CONNECT_TIMEOUT_MS = 300;

/**
 * Something answers here: the port is taken for anyone who dials it by name. Any connect error
 * (ECONNREFUSED, or EADDRNOTAVAIL on a host with no `::1`, such as a container whose loopback has
 * IPv6 disabled) means nobody answers on that family; it is never thrown.
 */
const someoneAnswers = async (host, port) =>
    new Promise((resolve) => {
        const socket = connect({ host, port });
        const settle = (answered) => {
            socket.destroy();
            resolve(answered);
        };
        socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
            settle(false);
        });
        socket.once('connect', () => {
            settle(true);
        });
        socket.once('error', () => {
            settle(false);
        });
    });

/*
 * Both loopback families, then the bind — the same probe `run-on-free-port.mjs` uses, and for the
 * same two reasons: 127.0.0.1 alone misses a server bound on all interfaces, and a bind alone misses
 * one bound on `[::1]` only, which is what a dev server run by hand often is. Playwright reaches ::1
 * first when it fetches `http://localhost:<port>`, so a bind-only probe passes the preflight and the
 * suite then refuses minutes later.
 */
const portIsFree = async (port) => {
    for (const host of ['127.0.0.1', '::1']) {
        if (await someoneAnswers(host, port)) {
            return false;
        }
    }
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });
        server.listen(port);
    });
};

/** How long the second look waits. A socket that is open for a moment is gone well inside it. */
export const PORT_RECHECK_MS = 150;

/*
 * Busy only when two looks, PORT_RECHECK_MS apart, both find the port busy. One look cannot tell a
 * server from a socket another process holds for a millisecond: scripts/run-on-free-port.mjs binds
 * every port it walks, and macOS hands out `listen(0)` ports in sequence, so a parallel test or lane
 * can be caught mid-bind. Read as a stray, it fails the gate (or, under --kill-port, makes it
 * signal a process that is not a stray). A port that is free on the first look is free; the second
 * look only ever overturns a busy one. `isFree` and `wait` are injected so the cases need no socket.
 */
export const isPortBusy = async (
    port,
    { isFree = portIsFree, wait = sleep, gapMs = PORT_RECHECK_MS } = {}
) => {
    if (await isFree(port)) {
        return false;
    }
    await wait(gapMs);
    return !(await isFree(port));
};

const main = async () => {
    if (await isPortBusy(PORT)) {
        let cleared = false;
        let lookupError = null;
        if (shouldKillPort) {
            const lookup = listeningPids(PORT);
            const { pids } = lookup;
            lookupError = lookup.lookupError ?? null;
            for (const pid of pids) {
                try {
                    process.kill(pid, 'SIGTERM');
                } catch {
                    // Already gone, or not ours to signal — the re-probe below is the verdict.
                }
            }
            if (pids.length > 0) {
                await sleep(1500);
                if (!(await isPortBusy(PORT))) {
                    cleared = true;
                    console.log(
                        `Cleared port ${String(PORT)}: killed stray listener pid ${pids.join(', ')} (the push gate owns its port; parallel lanes use run-on-free-port instead).`
                    );
                }
            }
        }

        if (!cleared) {
            console.error('\nGate preflight failed:\n');
            console.error(
                `  - Port ${String(PORT)} is busy, and the gate's \`vite preview\` needs it (strictPort).\n` +
                    `      A leftover preview from an earlier run is the common case.\n` +
                    (lookupError
                        ? `      ${lsofUnavailableHint(PORT, lookupError)}\n`
                        : shouldKillPort
                          ? `      --kill-port could not clear it — look: lsof -nP -iTCP:${String(PORT)} -sTCP:LISTEN\n`
                          : `      The push gate clears its own port (--kill-port); by hand: lsof -ti tcp:${String(PORT)} -sTCP:LISTEN | xargs kill\n`)
            );
            process.exit(1);
        }
    }
};

// Run only as the entry point, so the cases can import `isPortBusy`.
if (isEntryPoint(import.meta.url)) {
    await main();
}
