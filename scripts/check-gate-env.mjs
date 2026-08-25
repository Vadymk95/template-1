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
import { createServer } from 'node:net';

const PORT = 4173;

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
    console.error('\nGate preflight failed:\n');
    console.error(
        `  - Port ${String(PORT)} is busy, and the gate's \`vite preview\` needs it (strictPort).\n` +
            `      A leftover preview from an earlier run is the common case.\n` +
            `      Find it:  lsof -ti tcp:${String(PORT)}\n` +
            `      Free it:  lsof -ti tcp:${String(PORT)} | xargs kill\n`
    );
    process.exit(1);
}
