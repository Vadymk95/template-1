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
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

/* The preview port the gate's Playwright run binds (playwright.config.ts). GATE_PREFLIGHT_PORT is a
   test seam only: the suite points the preflight at an ephemeral port so it never touches the
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

const listeningPids = (port) => {
    const result = spawnSync('lsof', ['-ti', `tcp:${String(port)}`, '-sTCP:LISTEN'], {
        encoding: 'utf8'
    });
    if (result.status !== 0 || !result.stdout) {
        return [];
    }
    return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .map(Number)
        .filter((pid) => pid !== process.pid);
};

const portIsFree = async (port) =>
    new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => {
            resolve(false);
        });
        server.once('listening', () => {
            server.close(() => {
                resolve(true);
            });
        });
        // ALL interfaces, the way the preview server binds. Probing 127.0.0.1 alone reports a
        // port free while a server is plainly holding it.
        server.listen(port);
    });

if (!(await portIsFree(PORT))) {
    let cleared = false;
    if (shouldKillPort) {
        const pids = listeningPids(PORT);
        for (const pid of pids) {
            try {
                process.kill(pid, 'SIGTERM');
            } catch {
                // Already gone, or not ours to signal — the re-probe below is the verdict.
            }
        }
        if (pids.length > 0) {
            await sleep(1500);
            if (await portIsFree(PORT)) {
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
                (shouldKillPort
                    ? `      --kill-port could not clear it — look: lsof -nP -iTCP:${String(PORT)} -sTCP:LISTEN\n`
                    : `      The push gate clears its own port (--kill-port); by hand: lsof -ti tcp:${String(PORT)} -sTCP:LISTEN | xargs kill\n`)
        );
        process.exit(1);
    }
}
