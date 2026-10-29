import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearGroup,
    commandCarries,
    groupIsAlive,
    readProcess,
    reapStaleGroup,
    recordGroup,
    startsMatch,
    stopGroup
} from './server-group.mjs';

const START = 'Thu Oct 29 14:13:04 2026';
const ARGS = ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '3000', '--strictPort'];
// What the process title of an npm wrapper settles to once npm has parsed its arguments: the `--`
// separator is gone and every other argument stays. Measured on a real wrapper, not assumed.
const SETTLED_COMMAND = 'npm run dev --host 127.0.0.1 --port 3000 --strictPort';
const FILE = '.probe/server.json';
const LEADER = 4242;
const OWNER = 777;

const failure = (code) => Object.assign(new Error(code), { code });

/* A process table in a few lines. `groups` are the process groups that exist and `processes` the
   plain processes (the owner of a record is one). Signal 0 only asks. SIGKILL always ends a group;
   any other signal ends it only when `endsOn` names it, so a server that ignores SIGTERM is
   `endsOn: 'SIGKILL'`. */
const makeWorld = ({ groups = [], processes = [], endsOn = 'SIGTERM' } = {}) => {
    const liveGroups = new Set(groups);
    const liveProcesses = new Set(processes);
    const kill = vi.fn((target, signal) => {
        if (signal === 0) {
            const exists = target < 0 ? liveGroups.has(-target) : liveProcesses.has(target);
            if (!exists) {
                throw failure('ESRCH');
            }
            return true;
        }
        if (!liveGroups.has(-target)) {
            throw failure('ESRCH');
        }
        if (signal === endsOn || signal === 'SIGKILL') {
            liveGroups.delete(-target);
        }
        return true;
    });
    const sent = () => kill.mock.calls.filter(([, signal]) => signal !== 0);
    return { kill, sent, liveGroups };
};

const memoryFiles = (initial = {}) => {
    const files = new Map(Object.entries(initial));
    return {
        files,
        read: (file) => {
            if (!files.has(file)) {
                throw failure('ENOENT');
            }
            return files.get(file);
        },
        write: vi.fn((file, text) => {
            files.set(file, text);
        }),
        remove: vi.fn((file) => {
            files.delete(file);
        })
    };
};

const recordText = (overrides = {}) =>
    JSON.stringify({
        pid: LEADER,
        port: 3000,
        args: ARGS,
        owner: OWNER,
        start: START,
        ...overrides
    });

describe('groupIsAlive', () => {
    it('asks about the whole group with signal 0, which delivers nothing', () => {
        const kill = vi.fn();

        expect(groupIsAlive(LEADER, kill)).toBe(true);
        expect(kill).toHaveBeenCalledExactlyOnceWith(-LEADER, 0);
    });

    it('says no for a group that is gone', () => {
        const kill = vi.fn(() => {
            throw failure('ESRCH');
        });

        expect(groupIsAlive(LEADER, kill)).toBe(false);
    });

    it('says yes for a group it may not signal, because it exists', () => {
        const kill = vi.fn(() => {
            throw failure('EPERM');
        });

        expect(groupIsAlive(LEADER, kill)).toBe(true);
    });
});

describe('startsMatch', () => {
    /* `ps` prints a start time to the second, and some procps builds derive it from the boot time,
       so two reads of one process can differ by a second. Two seconds is a different process. */
    it('accepts the same start time', () => {
        expect(startsMatch(START, START)).toBe(true);
    });

    it('accepts a read that is one second off', () => {
        expect(startsMatch(START, 'Thu Oct 29 14:13:05 2026')).toBe(true);
        expect(startsMatch(START, 'Thu Oct 29 14:13:03 2026')).toBe(true);
    });

    it('refuses a start two seconds away', () => {
        expect(startsMatch(START, 'Thu Oct 29 14:13:06 2026')).toBe(false);
    });

    it('falls back to the text itself when a start time does not parse as a date', () => {
        expect(startsMatch('boot+12', 'boot+12')).toBe(true);
        expect(startsMatch('boot+12', 'boot+13')).toBe(false);
    });

    it('refuses a record that has no start time', () => {
        expect(startsMatch(null, START)).toBe(false);
        expect(startsMatch(undefined, START)).toBe(false);
        expect(startsMatch(START, '')).toBe(false);
    });
});

describe('commandCarries', () => {
    it('accepts the title npm settles to, where the separator is gone', () => {
        expect(commandCarries(SETTLED_COMMAND, ARGS)).toBe(true);
    });

    it('accepts the full command line a wrapper starts with, interpreter path and all', () => {
        const early = `node /opt/node/bin/npm ${ARGS.join(' ')}`;

        expect(commandCarries(early, ARGS)).toBe(true);
    });

    it('refuses the same program on another port', () => {
        expect(commandCarries(SETTLED_COMMAND.replace('3000', '3001'), ARGS)).toBe(false);
    });

    it('wants whole words: a port that is a prefix of the live one is not it', () => {
        expect(commandCarries('npm run dev --port 30001', ['run', 'dev', '--port', '3000'])).toBe(
            false
        );
    });

    it('refuses an empty command and an empty argument list, which confirm nothing', () => {
        expect(commandCarries('', ARGS)).toBe(false);
        expect(commandCarries(SETTLED_COMMAND, [])).toBe(false);
    });
});

describe('readProcess', () => {
    const ps = (answers) =>
        vi.fn(
            (_command, args) => answers[args[args.indexOf('-o') + 1]] ?? { status: 1, stdout: '' }
        );
    const answers = {
        'lstart=': { status: 0, stdout: `${START}\n` },
        'command=': { status: 0, stdout: `${SETTLED_COMMAND}\n` }
    };

    it('reads the start time and the command of a pid from ps', () => {
        const run = ps(answers);

        expect(readProcess(LEADER, run)).toEqual({ start: START, command: SETTLED_COMMAND });
        expect(run).toHaveBeenCalledWith(
            'ps',
            expect.arrayContaining(['-ww', '-p', String(LEADER)]),
            expect.objectContaining({ encoding: 'utf8' })
        );
    });

    it('asks in the C locale, so a start time is spelled the same on every run', () => {
        const run = ps(answers);

        readProcess(LEADER, run);

        expect(run.mock.calls[0][2].env.LC_ALL).toBe('C');
    });

    it('answers null for a pid ps does not know', () => {
        expect(readProcess(LEADER, ps({}))).toBeNull();
    });

    it('answers null where ps cannot run at all', () => {
        const run = vi.fn(() => ({ error: failure('ENOENT'), status: null, stdout: null }));

        expect(readProcess(LEADER, run)).toBeNull();
    });
});

describe('recordGroup', () => {
    it('writes what a later run needs to recognise the group: pid, port, arguments, owner, start', () => {
        const disk = memoryFiles();
        const identify = vi.fn(() => ({ start: START, command: 'not recorded' }));

        const record = recordGroup(
            FILE,
            { pid: LEADER, port: 3000, args: ARGS },
            { identify, write: disk.write, owner: OWNER }
        );

        const expected = { pid: LEADER, port: 3000, args: ARGS, owner: OWNER, start: START };
        expect(JSON.parse(disk.files.get(FILE))).toEqual(expected);
        expect(record).toEqual(expected);
        expect(identify).toHaveBeenCalledWith(LEADER);
    });

    it('names the process that is writing it as the owner by default', () => {
        const disk = memoryFiles();

        recordGroup(
            FILE,
            { pid: LEADER, port: 3000, args: ARGS },
            { identify: () => null, write: disk.write }
        );

        expect(JSON.parse(disk.files.get(FILE)).owner).toBe(process.pid);
    });

    it('records no start time where ps cannot say, and no later run will confirm that group', () => {
        const disk = memoryFiles();

        recordGroup(
            FILE,
            { pid: LEADER, port: 3000, args: ARGS },
            { identify: () => null, write: disk.write, owner: OWNER }
        );

        expect(JSON.parse(disk.files.get(FILE)).start).toBeNull();
    });

    it('creates the folder of the record when it is not there yet', () => {
        const root = mkdtempSync(join(tmpdir(), 'server-group-'));
        try {
            const file = join(root, 'nested', 'deeper', 'server.json');

            recordGroup(file, { pid: LEADER, port: 3000, args: ARGS }, { identify: () => null });

            expect(existsSync(file)).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('clearGroup', () => {
    /* Every run in a checkout shares one file and the last to start owns it. A run that is ending
       removes the record of ITS group and nothing else: after a SIGKILL the record another run wrote
       since is the only way that run's group can ever be found again. */
    it('removes the record of the group it is given and does not mind that it is already gone', () => {
        const root = mkdtempSync(join(tmpdir(), 'server-group-'));
        try {
            const file = join(root, 'server.json');
            recordGroup(file, { pid: LEADER, port: 3000, args: ARGS }, { identify: () => null });

            clearGroup(file, LEADER);
            expect(existsSync(file)).toBe(false);
            expect(() => {
                clearGroup(file, LEADER);
            }).not.toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves a record that names another group, because another run wrote it since', () => {
        const root = mkdtempSync(join(tmpdir(), 'server-group-'));
        try {
            const file = join(root, 'server.json');
            recordGroup(
                file,
                { pid: LEADER + 1, port: 3001, args: ARGS },
                { identify: () => null }
            );

            clearGroup(file, LEADER);

            expect(existsSync(file)).toBe(true);
            expect(JSON.parse(readFileSync(file, 'utf8')).pid).toBe(LEADER + 1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    const cannotRead = (code) => () => {
        throw failure(code);
    };

    it.each([
        ['no file at all', cannotRead('ENOENT')],
        ['a file it cannot read', cannotRead('EACCES')],
        ['half-written JSON', () => '{"pid": 4242'],
        ['an empty file', () => ''],
        ['JSON that is not a record', () => 'null']
    ])(
        'removes nothing where there is %s: it cannot show the record is its own',
        (_label, read) => {
            const remove = vi.fn();

            clearGroup(FILE, LEADER, { read, remove });

            expect(remove).not.toHaveBeenCalled();
        }
    );

    it('removes nothing when it has no pid to match, whatever the file holds', () => {
        const remove = vi.fn();

        clearGroup(FILE, undefined, { read: () => '', remove });
        clearGroup(FILE, undefined, { read: () => recordText(), remove });

        expect(remove).not.toHaveBeenCalled();
    });

    it('never throws: a record that cannot be removed is for the next run to find', () => {
        const remove = vi.fn(() => {
            throw failure('EACCES');
        });

        expect(() => {
            clearGroup(FILE, LEADER, { read: () => recordText(), remove });
        }).not.toThrow();
        expect(remove).toHaveBeenCalledWith(FILE);
    });
});

describe('stopGroup', () => {
    const wait = () => vi.fn(() => Promise.resolve());

    it('signals the whole group and stops there when SIGTERM is enough', async () => {
        const world = makeWorld({ groups: [LEADER] });

        await expect(stopGroup(LEADER, { kill: world.kill, wait: wait() })).resolves.toBe(
            'terminated'
        );

        expect(world.sent()).toEqual([[-LEADER, 'SIGTERM']]);
    });

    it('sends SIGTERM before it waits for anything, so a process that exits first still got it', async () => {
        const world = makeWorld({ groups: [LEADER] });
        const pause = vi.fn(() => {
            expect(world.sent()).toEqual([[-LEADER, 'SIGTERM']]);
            return Promise.resolve();
        });

        await stopGroup(LEADER, { kill: world.kill, wait: pause });

        expect(pause).toHaveBeenCalled();
    });

    it('looks again after each pause and stops waiting as soon as the group is gone', async () => {
        const world = makeWorld({ groups: [LEADER], endsOn: 'SIGKILL' });
        const pause = wait();
        const isAlive = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

        const outcome = await stopGroup(LEADER, {
            kill: world.kill,
            isAlive,
            wait: pause,
            termMs: 3000,
            pollMs: 100
        });

        expect(outcome).toBe('terminated');
        expect(pause.mock.calls).toEqual([[100], [100]]);
        expect(world.sent()).toEqual([[-LEADER, 'SIGTERM']]);
    });

    it('escalates to SIGKILL when the group is still there once the grace period is spent', async () => {
        const world = makeWorld({ groups: [LEADER], endsOn: 'SIGKILL' });
        const pause = wait();

        const outcome = await stopGroup(LEADER, {
            kill: world.kill,
            wait: pause,
            termMs: 300,
            pollMs: 100
        });

        expect(outcome).toBe('killed');
        expect(world.sent()).toEqual([
            [-LEADER, 'SIGTERM'],
            [-LEADER, 'SIGKILL']
        ]);
        expect(world.liveGroups.has(LEADER)).toBe(false);
        expect(pause.mock.calls).toEqual([[100], [100], [100]]);
    });

    it('never waits longer than the grace period, whatever the poll interval divides into', async () => {
        const world = makeWorld({ groups: [LEADER], endsOn: 'SIGKILL' });
        const pause = wait();

        await stopGroup(LEADER, { kill: world.kill, wait: pause, termMs: 250, pollMs: 100 });

        expect(pause.mock.calls).toEqual([[100], [100], [50]]);
    });

    it('does not mind a group that left between the last look and SIGKILL', async () => {
        const kill = vi.fn((_target, signal) => {
            if (signal === 'SIGKILL') {
                throw failure('ESRCH');
            }
            return true;
        });

        await expect(
            stopGroup(LEADER, { kill, isAlive: () => true, wait: wait(), termMs: 200, pollMs: 100 })
        ).resolves.toBe('killed');
    });

    it('reports a group that is already gone and does not wait', async () => {
        const world = makeWorld({ groups: [] });
        const pause = wait();

        await expect(stopGroup(LEADER, { kill: world.kill, wait: pause })).resolves.toBe('gone');

        expect(pause).not.toHaveBeenCalled();
    });

    it('gives up quietly on a group it may not signal, with no escalation', async () => {
        const kill = vi.fn(() => {
            throw failure('EPERM');
        });
        const pause = wait();

        await expect(stopGroup(LEADER, { kill, wait: pause })).resolves.toBe('unreachable');

        expect(kill).toHaveBeenCalledTimes(1);
        expect(pause).not.toHaveBeenCalled();
    });

    /* A negative pid addresses a group, so the pid has to be a real group leader's: 1 would
       address every process the user may signal, 0 the caller's own group. */
    it.each([0, 1, -3, 2.5, Number.NaN, '4242', undefined])(
        'refuses to signal anything for the pid %s',
        async (pid) => {
            const kill = vi.fn();

            await expect(stopGroup(pid, { kill, wait: wait() })).resolves.toBe('unreachable');

            expect(kill).not.toHaveBeenCalled();
        }
    );
});

describe('reapStaleGroup', () => {
    /* A probe that is killed outright (SIGKILL, a power cut) runs no cleanup, and its detached server
       group outlives it. The record it wrote lets the next run stop that group, but only when it is
       provably the same one: a pid is reused, and a group signalled by pid alone could be anyone's. */
    const harness = ({
        world = makeWorld({ groups: [LEADER] }),
        record = recordText(),
        live = { start: START, command: SETTLED_COMMAND },
        self = 9000,
        ...overrides
    } = {}) => {
        const disk = memoryFiles(record === null ? {} : { [FILE]: record });
        const log = vi.fn();
        const identify = vi.fn(() => live);
        const pause = vi.fn(() => Promise.resolve());
        const run = () =>
            reapStaleGroup({
                file: FILE,
                self,
                kill: world.kill,
                identify,
                wait: pause,
                read: disk.read,
                remove: disk.remove,
                log,
                termMs: 300,
                pollMs: 100,
                ...overrides
            });
        return { run, world, disk, log, identify, pause };
    };

    it('does nothing, and says nothing, when there is no record', async () => {
        const h = harness({ record: null });

        await expect(h.run()).resolves.toBe('none');

        expect(h.world.kill).not.toHaveBeenCalled();
        expect(h.disk.remove).not.toHaveBeenCalled();
        expect(h.log).not.toHaveBeenCalled();
    });

    it('removes the record of a group that is already gone, signalling nothing', async () => {
        const h = harness({ world: makeWorld({ groups: [] }) });

        await expect(h.run()).resolves.toBe('gone');

        expect(h.world.sent()).toEqual([]);
        expect(h.identify).not.toHaveBeenCalled();
        expect(h.disk.files.has(FILE)).toBe(false);
        expect(h.log).not.toHaveBeenCalled();
    });

    it('stops the group a dead run left behind, with SIGTERM when that is enough', async () => {
        const h = harness();

        await expect(h.run()).resolves.toBe('terminated');

        expect(h.identify).toHaveBeenCalledWith(LEADER);
        expect(h.world.sent()).toEqual([[-LEADER, 'SIGTERM']]);
        expect(h.disk.files.has(FILE)).toBe(false);
        expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/stopped.*4242.*3000/));
    });

    it('escalates to SIGKILL for a group that ignores SIGTERM, and says so', async () => {
        const h = harness({ world: makeWorld({ groups: [LEADER], endsOn: 'SIGKILL' }) });

        await expect(h.run()).resolves.toBe('killed');

        expect(h.world.sent()).toEqual([
            [-LEADER, 'SIGTERM'],
            [-LEADER, 'SIGKILL']
        ]);
        expect(h.disk.files.has(FILE)).toBe(false);
        expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/SIGKILL/));
    });

    /* Every run in a checkout shares one file and the last to start owns it. Stopping a group can
       take the whole grace period, and a probe that starts meanwhile writes its own record there:
       removing that one would leave its group with nothing to be found by if that probe is then
       killed outright. */
    it.each([
        ['terminated', 'SIGTERM'],
        ['killed', 'SIGKILL']
    ])(
        'keeps a record another run wrote while the group was being stopped (%s)',
        async (outcome, endsOn) => {
            const h = harness({ world: makeWorld({ groups: [LEADER], endsOn }) });
            const another = recordText({ pid: LEADER + 1, port: 3001, owner: OWNER + 1 });
            h.pause.mockImplementation(() => {
                h.disk.files.set(FILE, another);
                return Promise.resolve();
            });

            await expect(h.run()).resolves.toBe(outcome);

            expect(h.disk.files.get(FILE)).toBe(another);
            expect(h.log).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        [
            'another start time, so the pid was reused',
            { start: 'Thu Oct 29 16:40:00 2026', command: SETTLED_COMMAND }
        ],
        ['another command, so the pid was reused', { start: START, command: 'vim notes.txt' }],
        [
            'the same program on another port',
            { start: START, command: SETTLED_COMMAND.replace('3000', '3001') }
        ],
        ['a description ps cannot give', null]
    ])(
        'leaves a process alone that has %s: nothing signalled, record dropped',
        async (_label, live) => {
            const h = harness({ live });

            await expect(h.run()).resolves.toBe('not-ours');

            expect(h.world.sent()).toEqual([]);
            expect(h.world.liveGroups.has(LEADER)).toBe(true);
            expect(h.disk.files.has(FILE)).toBe(false);
            expect(h.log).toHaveBeenCalledTimes(1);
        }
    );

    it('cannot confirm a group whose record never had a start time, so it leaves it alone', async () => {
        const h = harness({ record: recordText({ start: null }) });

        await expect(h.run()).resolves.toBe('not-ours');

        expect(h.world.sent()).toEqual([]);
    });

    it('leaves the group of a live owner alone and keeps its record: it is not stale', async () => {
        const h = harness({ world: makeWorld({ groups: [LEADER], processes: [OWNER] }) });

        await expect(h.run()).resolves.toBe('owner-running');

        expect(h.world.sent()).toEqual([]);
        expect(h.identify).not.toHaveBeenCalled();
        expect(h.disk.files.has(FILE)).toBe(true);
        expect(h.log).toHaveBeenCalledTimes(1);
    });

    it('reads a record owned by the caller itself as stale: the dead owner pid was reused for it', async () => {
        const h = harness({
            self: OWNER,
            world: makeWorld({ groups: [LEADER], processes: [OWNER] })
        });

        await expect(h.run()).resolves.toBe('terminated');

        expect(h.world.sent()).toEqual([[-LEADER, 'SIGTERM']]);
    });

    it.each([
        ['half-written JSON', '{"pid": 42'],
        ['an empty file', ''],
        ['JSON that is not an object', 'null'],
        ['an array', '[]'],
        ['a record without arguments', recordText({ args: undefined })],
        ['a record with an empty argument list', recordText({ args: [] })],
        ['arguments that are not text', recordText({ args: ['run', 3000] })],
        ['a pid that is not a number', recordText({ pid: '4242' })],
        ['a fractional pid', recordText({ pid: 4242.5 })],
        ['the pid of init, which would address every process', recordText({ pid: 1 })],
        ['pid 0, which would address the caller own group', recordText({ pid: 0 })],
        ['a negative pid', recordText({ pid: -4242 })],
        ['an owner that is not a pid', recordText({ owner: 0 })],
        ['a start time that is not text', recordText({ start: 12 })]
    ])('discards %s without signalling anything', async (_label, text) => {
        const h = harness({ record: text });

        await expect(h.run()).resolves.toBe('discarded');

        expect(h.world.kill).not.toHaveBeenCalled();
        expect(h.disk.files.has(FILE)).toBe(false);
        expect(h.log).toHaveBeenCalledTimes(1);
    });

    it('treats a record it cannot read like a corrupt one', async () => {
        const h = harness({
            read: () => {
                throw failure('EACCES');
            }
        });

        await expect(h.run()).resolves.toBe('discarded');

        expect(h.disk.remove).toHaveBeenCalledWith(FILE);
        expect(h.world.kill).not.toHaveBeenCalled();
    });

    it('reports a group it may not signal and drops the record', async () => {
        const kill = vi.fn((target, signal) => {
            if (signal === 0) {
                if (target < 0) {
                    return true;
                }
                throw failure('ESRCH');
            }
            throw failure('EPERM');
        });
        const h = harness({ kill });

        await expect(h.run()).resolves.toBe('unreachable');

        expect(h.disk.files.has(FILE)).toBe(false);
        expect(h.log).toHaveBeenCalledTimes(1);
    });
});

// Where `ps` cannot describe a process (Windows, a minimal container) the module confirms nothing and
// signals nothing, so there is no behaviour here to measure.
const psAnswers = process.platform !== 'win32' && readProcess(process.pid) !== null;

describe.skipIf(!psAnswers)('against real processes', () => {
    /* The cases above pin the decisions; these pin the facts they rest on, measured rather than
       assumed: `ps` spells a start time that `Date.parse` reads, a detached child leads a group of
       its own, and a group whose leader is this process's child is only seen to be gone once the
       event loop has reaped it, which is why stopping a group waits asynchronously. */
    const started = [];
    const folders = [];

    afterEach(() => {
        for (const pid of started.splice(0)) {
            try {
                process.kill(-pid, 'SIGKILL');
            } catch {
                // already gone, which is what the cases want
            }
        }
        for (const folder of folders.splice(0)) {
            rmSync(folder, { recursive: true, force: true });
        }
    });

    // Ends by itself after 20 s, so a case that dies before its cleanup leaves nothing behind.
    const startGroup = () => {
        const marker = `server-group-case-${String(process.pid)}-${String(Date.now())}`;
        const child = spawn(
            process.execPath,
            ['-e', 'setTimeout(() => {}, 20000)', marker, '--port', '1'],
            { detached: true, stdio: 'ignore' }
        );
        started.push(child.pid);
        return { pid: child.pid, args: [marker, '--port', '1'] };
    };
    const recordFile = () => {
        const folder = mkdtempSync(join(tmpdir(), 'server-group-'));
        folders.push(folder);
        return join(folder, 'server.json');
    };
    const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

    it('reads this process from ps in a form the start comparison understands', () => {
        const info = readProcess(process.pid);

        expect(info?.command).toBeTruthy();
        expect(Number.isFinite(Date.parse(info?.start ?? ''))).toBe(true);
        expect(startsMatch(info?.start, readProcess(process.pid)?.start)).toBe(true);
    });

    it('stops a real group that a dead owner left behind, and the record goes with it', async () => {
        const { pid, args } = startGroup();
        const file = recordFile();
        recordGroup(file, { pid, port: 1, args }, { owner: deadPid() });
        expect(groupIsAlive(pid)).toBe(true);

        const outcome = await reapStaleGroup({ file, log: vi.fn() });

        expect(outcome).toBe('terminated');
        expect(groupIsAlive(pid)).toBe(false);
        expect(existsSync(file)).toBe(false);
    });

    it('leaves a real group alone when the recorded start time is not its own', async () => {
        const { pid, args } = startGroup();
        const file = recordFile();
        recordGroup(file, { pid, port: 1, args }, { owner: deadPid() });
        const record = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...record, start: 'Mon Jan  1 00:00:00 2001' }));

        const outcome = await reapStaleGroup({ file, log: vi.fn() });

        expect(outcome).toBe('not-ours');
        expect(groupIsAlive(pid)).toBe(true);
    });

    it('leaves a real group alone while the process that recorded it is still running', async () => {
        const { pid, args } = startGroup();
        const file = recordFile();
        recordGroup(file, { pid, port: 1, args }, { owner: process.pid });

        const outcome = await reapStaleGroup({ file, self: process.pid + 1, log: vi.fn() });

        expect(outcome).toBe('owner-running');
        expect(groupIsAlive(pid)).toBe(true);
    });
});
