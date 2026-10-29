/**
 * Ports for tests that bind, hold or walk real sockets.
 *
 * Why not `listen(0)`: the OS hands those out from its ephemeral range (Linux 32768-60999, macOS
 * 49152-65535), and macOS hands them out in sequence. A test that takes one and then walks its
 * neighbours (`findFreePort` in scripts/run-on-free-port.mjs binds each candidate for about a
 * millisecond) lands on ports that are live for another test, a browser or the gate preflight, and
 * each side then reads the other as a stray server.
 *
 * What this hands out instead: ports from 10000-19999, below both ephemeral ranges. The block
 * 20000-29999 is left alone because other tools' tests on the same machine use it.
 *
 * Two checkouts that run tests at once must not hold the same ports, so each checkout gets its own
 * window of WINDOW_SIZE ports, picked by a hash of its path: 100 windows, so two checkouts share one
 * about once in a hundred. Inside the window each test file that binds sockets takes a lane of its
 * own, because vitest runs the files of one checkout in parallel. A new file adds a lane below,
 * inside the window; quiet-ports.test.mjs refuses a lane that overlaps another or leaves the window.
 */
import { createHash } from 'node:crypto';

export const QUIET_FIRST = 10_000;
export const QUIET_LAST = 19_999;
export const WINDOW_SIZE = 100;

export const LANES = Object.freeze({
    'check-gate-env': { offset: 0, size: 10 },
    'run-on-free-port': { offset: 10, size: 30 },
    probe: { offset: 40, size: 10 },
    'check-lock-age': { offset: 50, size: 10 }
});

const WINDOWS = (QUIET_LAST - QUIET_FIRST + 1) / WINDOW_SIZE;

/** The first port of the window this checkout owns; `root` is the checkout's path. */
export const windowStart = (root = process.cwd()) =>
    QUIET_FIRST +
    (createHash('sha256').update(root).digest().readUInt32BE(0) % WINDOWS) * WINDOW_SIZE;

/** The port at `index` in the lane named for a test file, inside this checkout's window. */
export const quietPort = (lane, index = 0, root = process.cwd()) => {
    const slot = LANES[lane];
    if (slot === undefined) {
        throw new RangeError(`quietPort: no lane called "${lane}"; add one to LANES.`);
    }
    if (!Number.isInteger(index) || index < 0 || index >= slot.size) {
        throw new RangeError(
            `quietPort: index ${String(index)} is outside the ${String(slot.size)} ports of lane "${lane}".`
        );
    }
    return windowStart(root) + slot.offset + index;
};
