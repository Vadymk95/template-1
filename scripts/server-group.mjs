/**
 * A server started in a process group of its own, and the record that lets a later run clean up
 * after a run that died without stopping it. Nothing here knows which server it is: the caller hands
 * in the pid of the group leader, the port, and the arguments the leader was started with.
 *
 * Why a record. A dev or preview server is started `detached`, so it leads a process group of its own
 * and a negative pid signals the whole group: the wrapper AND the workers it started, where signalling
 * the wrapper alone leaves the workers listening on the port. The same fact means a terminal's Ctrl-C
 * does not reach the group, and nothing reaches it when its parent is killed outright: a SIGKILL or a
 * power cut runs no cleanup, so the group outlives the run and keeps its port. A signal handler cannot
 * cover that case; a file the next run reads can.
 *
 * What the file may be used for. A pid alone proves nothing: pids are reused, and a group signalled by
 * pid could belong to anyone, a server another checkout started on purpose included. So a recorded
 * group is stopped only when ALL of these hold: the run that recorded it is gone, the group exists,
 * the process at that pid started when the record says it did, and its command line carries every
 * argument the leader was started with. Anything else is left alone, with one line saying why.
 * Nothing is ever signalled by port or by program name.
 *
 * Stopping waits asynchronously on purpose. Measured: when the process that stops a group is the
 * parent of its leader, the leader stays a zombie until the event loop reaps it, a zombie still
 * answers signal 0, and a synchronous wait therefore sees a dead group as alive for its whole length.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** How long a group gets to leave after SIGTERM before it is killed, and how often it is looked at. */
export const TERM_GRACE_MS = 3000;
export const POLL_MS = 100;

/** `ps` prints a start time to the second, and two reads of one process can differ by one. */
const START_TOLERANCE_MS = 1000;

const defaultKill = (target, signal) => process.kill(target, signal);

const readText = (file) => readFileSync(file, 'utf8');

const writeText = (file, text) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
};

const removeFile = (file) => {
    rmSync(file, { force: true });
};

/**
 * Whether a negative pid may be handed to `kill`: it addresses a group, so it has to be a real
 * leader's. `-1` would address every process the user may signal and `-0` is the caller's own group.
 */
const isGroupLeader = (pid) => Number.isInteger(pid) && pid > 1;

const exists = (target, kill) => {
    try {
        kill(target, 0);
        return true;
    } catch (error) {
        // EPERM: it exists and belongs to someone else. Only ESRCH (and anything stranger) means gone.
        return error?.code === 'EPERM';
    }
};

/** Signal 0 delivers nothing and only asks, so this is safe to call on any pid. */
export const groupIsAlive = (pid, kill = defaultKill) => exists(-pid, kill);

/**
 * Whether two start times read from `ps` are one process. Written as a tolerance because some procps
 * builds derive the time from the boot time, so one process can read a second apart; a start two
 * seconds away is another process. A time that does not parse as a date is compared as text.
 */
export const startsMatch = (recorded, live) => {
    if (
        typeof recorded !== 'string' ||
        typeof live !== 'string' ||
        recorded === '' ||
        live === ''
    ) {
        return false;
    }
    if (recorded === live) {
        return true;
    }
    return Math.abs(Date.parse(recorded) - Date.parse(live)) <= START_TOLERANCE_MS;
};

/**
 * Whether the command line of a live process carries every argument its leader was started with, each
 * as a whole word. The arguments, not the command that `ps` printed at start, because that text is not
 * stable: measured on an npm wrapper, `ps` showed `node <path>/npm run dev -- --port N` for the first
 * milliseconds, a bare `npm` a moment later and `npm run dev --port N` from then on, the `--` gone.
 * So the separator is not asked for, and an empty list confirms nothing.
 */
export const commandCarries = (command, args) => {
    if (typeof command !== 'string' || !Array.isArray(args)) {
        return false;
    }
    const wanted = args.filter((argument) => argument !== '--');
    const words = new Set(command.split(/\s+/).filter(Boolean));
    return wanted.length > 0 && wanted.every((argument) => words.has(argument));
};

/**
 * The start time and the command line `ps` reports for a pid, or null when it reports nothing: no such
 * process, or no `ps` (Windows, minimal containers), in which case nothing can be confirmed and
 * nothing is signalled. `LC_ALL=C` keeps the start time spelled the same on every run.
 */
export const readProcess = (pid, run = spawnSync) => {
    const column = (name) => {
        const result = run('ps', ['-ww', '-o', `${name}=`, '-p', String(pid)], {
            encoding: 'utf8',
            env: { ...process.env, LC_ALL: 'C' }
        });
        return result.status === 0 && typeof result.stdout === 'string' ? result.stdout.trim() : '';
    };
    const start = column('lstart');
    const command = column('command');
    return start === '' || command === '' ? null : { start, command };
};

/**
 * Writes the record of a group the caller has just started. `start` is read from `ps` here, right
 * after the spawn: it is fixed for the life of the process, unlike the command text. A group whose
 * start time could not be read is recorded with `start: null`, which no later run will confirm.
 */
export const recordGroup = (
    file,
    { pid, port, args },
    { identify = readProcess, write = writeText, owner = process.pid } = {}
) => {
    const record = { pid, port, args, owner, start: identify(pid)?.start ?? null };
    write(file, `${JSON.stringify(record)}\n`);
    return record;
};

/**
 * Removes the file, whatever it holds, for a caller that has already judged the record. It never
 * throws: a record that stays is read by the next run, which finds the group gone.
 */
const dropRecord = (file, remove) => {
    try {
        remove(file);
    } catch {
        // see above: a leftover record costs one silent cleanup next time, a throw here would mask the real error
    }
};

/**
 * Stops a whole group: SIGTERM, a bounded wait that looks again after each pause, then SIGKILL for
 * whatever is still there. SIGTERM goes out before the first await, so a caller that is exiting
 * still delivers it. Resolves to `'terminated'` or `'killed'` when the group was there to stop,
 * `'gone'` when it had already left, and `'unreachable'` when it could not be signalled at all
 * (a refused pid, no permission, no groups on this platform), where nothing is escalated.
 */
export const stopGroup = async (
    pid,
    {
        kill = defaultKill,
        isAlive = (leader) => groupIsAlive(leader, kill),
        wait = delay,
        termMs = TERM_GRACE_MS,
        pollMs = POLL_MS
    } = {}
) => {
    if (!isGroupLeader(pid)) {
        return 'unreachable';
    }
    try {
        kill(-pid, 'SIGTERM');
    } catch (error) {
        return error?.code === 'ESRCH' ? 'gone' : 'unreachable';
    }
    for (let waited = 0; waited < termMs; waited += pollMs) {
        await wait(Math.min(pollMs, termMs - waited));
        if (!isAlive(pid)) {
            return 'terminated';
        }
    }
    try {
        kill(-pid, 'SIGKILL');
    } catch {
        // it left between the last look and now, which is the outcome SIGKILL was for
    }
    return 'killed';
};

/** The record, or null when it is not one: every field is checked, because the pid ends up behind a minus sign. */
const parseRecord = (text) => {
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    const { pid, port, args, owner, start } = value ?? {};
    const valid =
        isGroupLeader(pid) &&
        Number.isInteger(port) &&
        Number.isInteger(owner) &&
        owner > 0 &&
        Array.isArray(args) &&
        args.length > 0 &&
        args.every((argument) => typeof argument === 'string') &&
        (start === null || typeof start === 'string');
    return valid ? { pid, port, args, owner, start } : null;
};

/**
 * Removes the record, but only when it is the record of the group led by `pid`. The file is shared
 * by every run in a checkout and the last to start owns it, so a run that is ending can find the
 * record of one that started after it, and removing that would leave its group with nothing to be
 * found by if that run is then killed outright. A file that is missing, unreadable or not a complete
 * record is left alone as well: nothing in it shows that it is this run's, and the next run discards
 * what cannot be used. It never throws: a record that stays is read by the next run, which settles
 * the group.
 */
export const clearGroup = (file, pid, { read = readText, remove = removeFile } = {}) => {
    let text;
    try {
        text = read(file);
    } catch {
        // no file, or none that can be read: nothing here shows that the record is this run's
        return;
    }
    const record = parseRecord(text);
    if (record !== null && record.pid === pid) {
        dropRecord(file, remove);
    }
};

/**
 * Stops the group a dead run left behind, if there is one and it is provably the same group.
 * Resolves to what happened, so a caller and a test can tell the cases apart:
 *   `'none'`          there is no record: silent
 *   `'discarded'`     the record is unreadable or unusable: removed, one line
 *   `'owner-running'` the run that recorded it is still alive, so it is not stale: kept, one line
 *   `'gone'`          the group had already left (a power cut, or it ended on its own): removed, silent
 *   `'not-ours'`      something lives at that pid but start time or command differ (the pid was
 *                     reused): nothing signalled, removed, one line
 *   `'terminated'` | `'killed'` | `'unreachable'`   see stopGroup: one line; the record is removed
 *                     unless another run has recorded its own group meanwhile
 * `self` is the calling process: a record that names it as owner is stale, because the pid of a dead
 * owner was handed to it.
 */
export const reapStaleGroup = async ({
    file,
    self = process.pid,
    kill = defaultKill,
    isAlive = (leader) => groupIsAlive(leader, kill),
    identify = readProcess,
    read = readText,
    remove = removeFile,
    wait = delay,
    termMs = TERM_GRACE_MS,
    pollMs = POLL_MS,
    log = console.log
}) => {
    const discard = (reason) => {
        dropRecord(file, remove);
        log(`removed a server record that cannot be used (${file}): ${reason}.`);
        return 'discarded';
    };

    let text;
    try {
        text = read(file);
    } catch (error) {
        return error?.code === 'ENOENT' ? 'none' : discard('it could not be read');
    }
    const record = parseRecord(text);
    if (record === null) {
        return discard('it is not a complete record');
    }

    if (record.owner !== self && exists(record.owner, kill)) {
        log(
            `left the server group of pid ${String(record.pid)} alone: the process that started it (pid ${String(record.owner)}) is still running.`
        );
        return 'owner-running';
    }
    if (!isAlive(record.pid)) {
        dropRecord(file, remove);
        return 'gone';
    }

    const live = identify(record.pid);
    if (
        live === null ||
        !startsMatch(record.start, live.start) ||
        !commandCarries(live.command, record.args)
    ) {
        dropRecord(file, remove);
        log(
            `left process group ${String(record.pid)} alone: it is not the server the record describes (its start time or command differ), so nothing was signalled.`
        );
        return 'not-ours';
    }

    const outcome = await stopGroup(record.pid, { kill, isAlive, wait, termMs, pollMs });
    // The stop can take the whole grace period, so a run that started meanwhile owns the file now.
    clearGroup(file, record.pid, { read, remove });
    const where = `(pid ${String(record.pid)}, port ${String(record.port)})`;
    if (outcome === 'terminated') {
        log(`stopped the server group a dead run left behind ${where}.`);
    } else if (outcome === 'killed') {
        log(
            `stopped the server group a dead run left behind ${where} with SIGKILL, because it ignored SIGTERM for ${String(termMs)} ms.`
        );
    } else if (outcome === 'unreachable') {
        log(`could not signal the server group ${where}, so it was left running.`);
    }
    return outcome;
};
