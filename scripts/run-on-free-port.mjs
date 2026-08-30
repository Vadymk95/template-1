#!/usr/bin/env node
/**
 * Runs a command on a FREE port: busy base port -> take the next one, and say so.
 *
 * This is the parallel-lane half of the port discipline. Several agent lanes share one machine;
 * when one holds 3000 with a dev server, the others must not fight it, kill it, or silently
 * measure it — they go to the next free port. The child gets PORT and PLAYWRIGHT_BASE_URL so
 * both Next (dev/start) and Playwright agree on where the run lives. Playwright kills the server
 * it starts, so a lane cleans up after itself; a server it did NOT start is not its to kill —
 * the push gate is the only lane allowed to clear its own port (check-gate-env --kill-port).
 *
 * Usage: node scripts/run-on-free-port.mjs <command> [args...]
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const PROBE_LIMIT = 20;

const portIsFree = async (port) =>
    new Promise((resolvePort) => {
        const server = createServer();
        server.once('error', () => {
            resolvePort(false);
        });
        server.once('listening', () => {
            server.close(() => {
                resolvePort(true);
            });
        });
        // ALL interfaces, the way `next start` binds: a 127.0.0.1-only probe reports the port
        // free while a dev server plainly holds it.
        server.listen(port);
    });

export const findFreePort = async (basePort, isFree = portIsFree) => {
    for (let candidate = basePort; candidate < basePort + PROBE_LIMIT; candidate += 1) {
        if (await isFree(candidate)) {
            return candidate;
        }
    }
    throw new Error(
        `No free port within ${String(PROBE_LIMIT)} of ${String(basePort)} — that is not a busy port, that is a runaway process. Look: lsof -nP -iTCP:${String(basePort)}-${String(basePort + PROBE_LIMIT)} -sTCP:LISTEN`
    );
};

export const buildChildEnv = (environment, port) => ({
    ...environment,
    PORT: String(port),
    PLAYWRIGHT_BASE_URL: `http://localhost:${String(port)}`
});

const main = async () => {
    const [command, ...commandArgs] = process.argv.slice(2);
    if (!command) {
        console.error('Usage: node scripts/run-on-free-port.mjs <command> [args...]');
        process.exit(2);
    }

    const basePort = Number(process.env.PORT ?? 3000);
    const port = await findFreePort(basePort);
    if (port !== basePort) {
        console.log(`Port ${String(basePort)} is busy — this lane runs on ${String(port)}.`);
    }

    const result = spawnSync(command, commandArgs, {
        stdio: 'inherit',
        shell: false,
        env: buildChildEnv(process.env, port)
    });
    process.exit(result.status ?? 1);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    await main();
}
