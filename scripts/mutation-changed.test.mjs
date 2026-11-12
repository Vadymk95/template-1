// mutation-changed: Stryker on the lines a change touched. The Stryker runner is injected, so this
// suite never starts the real one; git runs for real, in throwaway repositories.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { inScope, killGraceFrom, parseDiff, run } from './mutation-changed.mjs';

const ROOT = process.cwd();
const LIVE_CONFIG_PATH = path.join(ROOT, 'stryker.config.json');
const liveConfigText = readFileSync(LIVE_CONFIG_PATH, 'utf8');
const liveConfig = JSON.parse(liveConfigText);

/* ----------------------------------------------------------------- scope matching */

// One row per pattern of the live `mutate` list: a path it matches and one it does not.
const SCOPE_ROWS = {
    'src/**/*.{ts,tsx}': ['src/lib/deep/a.tsx', 'src/lib/a.css'],
    '!src/**/*.test.*': ['src/lib/a.test.ts', 'src/lib/a.ts'],
    '!src/test/**': ['src/test/setup/a.ts', 'src/testing/a.ts'],
    '!src/env.ts': ['src/env.ts', 'src/lib/env.ts'],
    '!src/main.tsx': ['src/main.tsx', 'src/lib/main.tsx'],
    '!src/components/ui/**': ['src/components/ui/button.tsx', 'src/components/common/a.tsx'],
    '!src/pages/**/index.ts': ['src/pages/Home/index.ts', 'src/pages/Home/useHome.ts'],
    '!src/**/*.d.ts': ['src/types/a.d.ts', 'src/types/a.ts']
};

describe('inScope', () => {
    const [positive] = liveConfig.mutate;

    it('has a row for every pattern the live stryker config uses', () => {
        expect(
            Object.keys(SCOPE_ROWS),
            'stryker.config.json `mutate` changed: add or drop the matching row in SCOPE_ROWS'
        ).toEqual(liveConfig.mutate);
    });

    it.each(Object.entries(SCOPE_ROWS))('%s', (pattern, [matching, other]) => {
        if (pattern.startsWith('!')) {
            expect(inScope(matching, [positive, pattern])).toBe(false);
            expect(inScope(other, [positive, pattern])).toBe(true);
        } else {
            expect(inScope(matching, [pattern])).toBe(true);
            expect(inScope(other, [pattern])).toBe(false);
        }
    });

    it('lets a later positive pattern bring a path back, as the order of the list says', () => {
        expect(inScope('src/a.ts', ['src/**/*.ts', '!src/a.ts', 'src/a.ts'])).toBe(true);
    });
});

/* --------------------------------------------------------------------- diff parse */

describe('parseDiff', () => {
    it('reads the new-side ranges of every hunk and skips a hunk that only deletes', () => {
        const text = [
            'diff --git a/src/a.ts b/src/a.ts',
            'index 1..2 100644',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -2 +2 @@',
            '-old',
            '+++ looks like a header but is an added line',
            '@@ -5,2 +5,0 @@',
            '-gone',
            '-gone',
            '@@ -9,0 +8,3 @@',
            '+x',
            ''
        ].join('\n');
        expect(parseDiff(text)).toEqual([
            {
                file: 'src/a.ts',
                added: false,
                ranges: [
                    [2, 2],
                    [8, 10]
                ]
            }
        ]);
    });

    it('marks a new file and reads a name with a space or quotes', () => {
        const text = [
            'diff --git a/src/my a.ts b/src/my a.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/my a.ts\t',
            '@@ -0,0 +1,2 @@',
            '+a',
            '+b',
            'diff --git "a/src/q\\"x.ts" "b/src/q\\"x.ts"',
            '--- "a/src/q\\"x.ts"',
            '+++ "b/src/q\\"x.ts"',
            '@@ -1 +1 @@',
            ''
        ].join('\n');
        expect(parseDiff(text)).toEqual([
            { file: 'src/my a.ts', added: true, ranges: [[1, 2]] },
            { file: 'src/q"x.ts', added: false, ranges: [[1, 1]] }
        ]);
    });
});

/* ------------------------------------------------------------------ real git repos */

const repos = [];
const cleanEnv = () => {
    const env = { ...process.env, CI: '', GITHUB_ACTIONS: '' };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    return env;
};
const git = (cwd, args) =>
    execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (root, file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
};
const commit = (root) => {
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'step']);
    return git(root, ['rev-parse', 'HEAD']);
};
/** `n` numbered lines; `marks` replaces some of them by line number, `skip` drops one. */
const body = (n, marks = {}, skip = 0) =>
    Array.from({ length: n }, (_, i) => i + 1)
        .filter((line) => line !== skip)
        .map((line) => `export const v${line} = ${marks[line] ?? line};`)
        .join('\n') + '\n';

/** A repo whose first commit holds the live stryker config and two in-scope files. */
const makeRepo = () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mutation-changed-'));
    repos.push(root);
    git(root, ['init', '--quiet', '--initial-branch=master']);
    git(root, ['config', 'user.email', 'test@example.test']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    write(root, 'stryker.config.json', liveConfigText);
    write(root, 'src/lib/a.ts', body(10));
    write(root, 'src/lib/old.ts', body(10));
    return { root, base: commit(root) };
};

afterEach(() => {
    for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

const invoke = async (root, argv, { runner = vi.fn(async () => ({ code: 0 })), env = {} } = {}) => {
    const lines = [];
    const code = await run({
        argv,
        cwd: root,
        env,
        runner,
        out: (text) => lines.push(text),
        err: (text) => lines.push(text)
    });
    return { code, runner, text: lines.join('\n') };
};
const pickLines = async (root, base) => {
    const { text } = await invoke(root, ['--pick', '--base', base]);
    return text.split('\n');
};

describe('what gets mutated', () => {
    it('takes a new file whole', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/new.ts', body(4));
        commit(root);
        expect(await pickLines(root, base)).toContain('src/lib/new.ts');
    });

    it('takes one hunk of a changed file as a range', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/a.ts', body(10, { 3: '"x"' }));
        commit(root);
        const lines = await pickLines(root, base);
        expect(lines).toContain('src/lib/a.ts:3-3');
        expect(lines).not.toContain('src/lib/a.ts');
    });

    it('takes every hunk of one file, and a working-tree edit that is not committed', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/a.ts', body(10, { 2: '"x"', 9: '"y"' }));
        const lines = await pickLines(root, base);
        expect(lines).toContain('src/lib/a.ts:2-2');
        expect(lines).toContain('src/lib/a.ts:9-9');
    });

    it('gives nothing for a hunk that only deletes', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/a.ts', body(10, {}, 5));
        commit(root);
        const { code, text, runner } = await invoke(root, ['--base', base]);
        expect(code).toBe(0);
        expect(text).toMatch(/nothing/i);
        expect(runner).not.toHaveBeenCalled();
    });

    it('takes a renamed file at its new path, on the edited lines only', async () => {
        const { root, base } = makeRepo();
        git(root, ['mv', 'src/lib/old.ts', 'src/lib/renamed.ts']);
        write(root, 'src/lib/renamed.ts', body(10, { 4: '"x"' }));
        commit(root);
        const lines = await pickLines(root, base);
        expect(lines).toContain('src/lib/renamed.ts:4-4');
        expect(lines.some((line) => line.startsWith('src/lib/old.ts'))).toBe(false);
    });

    it('takes an untracked in-scope file whole', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/untracked.ts', body(3));
        expect(await pickLines(root, base)).toContain('src/lib/untracked.ts');
    });

    it('drops files out of scope: a test, a negated folder, a path outside the roots', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/a.test.ts', body(3));
        write(root, 'src/components/ui/button.tsx', body(3));
        write(root, 'scripts/tool.ts', body(3));
        write(root, 'README.md', 'text\n');
        commit(root);
        const { code, text, runner } = await invoke(root, ['--base', base]);
        expect(code).toBe(0);
        expect(text).toMatch(/nothing/i);
        expect(runner).not.toHaveBeenCalled();
    });

    it.each(['src/lib/a,b.ts', 'src/lib/(group)/c.ts'])(
        'reports %s as unable to be mutated by range, and does not drop it',
        async (file) => {
            const { root, base } = makeRepo();
            write(root, file, body(3));
            write(root, 'src/lib/fine.ts', body(3));
            commit(root);
            const lines = await pickLines(root, base);
            expect(lines).toContain('src/lib/fine.ts');
            expect(
                lines.some((line) => line.includes(file) && /cannot be mutated by range/.test(line))
            ).toBe(true);
            expect(lines).not.toContain(file);
        }
    );

    it('stops on a base that is not a commit', async () => {
        const { root } = makeRepo();
        const { code, text } = await invoke(root, ['--base', 'no-such-ref']);
        expect(code).not.toBe(0);
        expect(text).toMatch(/no-such-ref/);
    });
});

describe('boundaries', () => {
    it('runs nothing and exits 0 when nothing in scope changed', async () => {
        const { root, base } = makeRepo();
        write(root, 'README.md', 'text\n');
        commit(root);
        const { code, text, runner } = await invoke(root, ['--base', base]);
        expect(code).toBe(0);
        expect(text).toMatch(/nothing/i);
        expect(runner).not.toHaveBeenCalled();
    });

    it('runs at exactly the file cap and stops one above it', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/n1.ts', body(1));
        write(root, 'src/lib/n2.ts', body(1));
        commit(root);
        const at = await invoke(root, ['--base', base, '--max-files', '2']);
        expect(at.runner).toHaveBeenCalledTimes(1);

        const above = await invoke(root, ['--base', base, '--max-files', '1']);
        expect(above.code).toBe(0);
        expect(above.runner).not.toHaveBeenCalled();
        expect(above.text).toMatch(/2 files/);
        expect(above.text).toMatch(/the weekly run covers it/);
    });

    it('runs at exactly the line cap and stops one above it', async () => {
        const { root, base } = makeRepo();
        write(root, 'src/lib/n1.ts', body(5));
        commit(root);
        const at = await invoke(root, ['--base', base, '--max-lines', '5']);
        expect(at.runner).toHaveBeenCalledTimes(1);

        const above = await invoke(root, ['--base', base, '--max-lines', '4']);
        expect(above.code).toBe(0);
        expect(above.runner).not.toHaveBeenCalled();
        expect(above.text).toMatch(/5 lines/);
        expect(above.text).toMatch(/the weekly run covers it/);
    });
});

/* ------------------------------------------------------------------ the Stryker run */

const mutant = (
    status,
    line,
    column,
    mutatorName = 'ConditionalExpression',
    replacement = 'true'
) => ({
    id: `${line}:${column}`,
    mutatorName,
    replacement,
    status,
    location: { start: { line, column }, end: { line, column: column + 4 } }
});
const reportOf = (files) => ({
    schemaVersion: '2',
    thresholds: { high: 80, low: 60 },
    files: Object.fromEntries(
        Object.entries(files).map(([name, mutants]) => [
            name,
            { language: 'typescript', source: '', mutants }
        ])
    )
});
/** A runner that writes `report` where the config asks for it, like Stryker's json reporter. */
const reportRunner = (report, code = 0) =>
    vi.fn(async ({ config, cwd }) => {
        if (report) write(cwd, config.jsonReporter.fileName, JSON.stringify(report));
        return { code };
    });

const changedRepo = () => {
    const made = makeRepo();
    write(made.root, 'src/lib/a.ts', body(10, { 3: '"x"' }));
    commit(made.root);
    return made;
};

describe('the config handed to the runner', () => {
    it('is the repository config with exactly the four differences', async () => {
        const { root, base } = changedRepo();
        const runner = reportRunner(reportOf({}));
        await invoke(root, ['--base', base, '--concurrency', '2'], { runner });

        const { config, concurrency } = runner.mock.calls[0][0];
        expect(concurrency).toBe(2);
        expect(config.mutate).toEqual(['src/lib/a.ts:3-3']);
        expect(config.incremental).toBe(false);
        expect(config.jsonReporter.fileName).toMatch(/^reports\/.+\.json$/);
        expect(config.reporters).toContain('json');
        expect(config.thresholds.break).toBeNull();

        // Everything else is the live config: the runner, the vitest block with the forks pool, the
        // ignore patterns, the temp directory and the other thresholds.
        expect(config.testRunner).toBe('vitest');
        expect(config.vitest).toEqual({ configFile: 'vitest.config.ts', pool: 'forks' });
        expect(config.ignorePatterns).toEqual(liveConfig.ignorePatterns);
        const rest = (value) => {
            const copy = structuredClone(value);
            for (const key of ['mutate', 'incremental', 'reporters', 'jsonReporter']) {
                delete copy[key];
            }
            copy.thresholds = { ...copy.thresholds, break: undefined };
            return copy;
        };
        expect(rest(config)).toEqual(rest(liveConfig));
    });

    it('leaves stryker.config.json on disk untouched', async () => {
        const { root, base } = changedRepo();
        await invoke(root, ['--base', base], { runner: reportRunner(reportOf({})) });
        expect(readFileSync(LIVE_CONFIG_PATH, 'utf8')).toBe(liveConfigText);
        expect(readFileSync(path.join(root, 'stryker.config.json'), 'utf8')).toBe(liveConfigText);
        expect(existsSync(path.join(root, 'reports/stryker-incremental.json'))).toBe(false);
    });
});

describe('the report', () => {
    const mixed = reportOf({
        'src/lib/b.ts': [
            mutant('Ignored', 2, 1),
            mutant('Timeout', 4, 1),
            mutant('RuntimeError', 6, 1)
        ],
        'src/lib/a.ts': [
            mutant('Killed', 1, 1),
            mutant('Survived', 7, 5, 'EqualityOperator', '>=\n  extra'),
            mutant('Killed', 8, 1),
            mutant('NoCoverage', 3, 1, 'BlockStatement', '{}')
        ]
    });

    it('prints the counts, the score and the survivors sorted by path and line', async () => {
        const { root, base } = changedRepo();
        const summary = path.join(root, 'summary.md');
        const { code, text } = await invoke(root, ['--base', base], {
            runner: reportRunner(mixed),
            env: { GITHUB_STEP_SUMMARY: summary }
        });
        expect(code).toBe(0);
        const lines = text.split('\n');
        expect(lines[0]).toBe(
            'Mutants on the changed lines: 7 (2 killed, 1 timed out, 1 survived, 1 no coverage, 1 errors, 1 ignored); score 60.00%'
        );
        expect(lines[1]).toBe('src/lib/a.ts:3:1 NoCoverage BlockStatement -> {}');
        expect(lines[2]).toBe('src/lib/a.ts:7:5 Survived EqualityOperator -> >= extra');
        expect(lines[3]).toMatch(/equivalent mutant needs no test/);
        expect(lines).toHaveLength(4);

        const markdown = readFileSync(summary, 'utf8');
        expect(markdown).toContain('score 60.00%');
        expect(markdown).toContain('`src/lib/a.ts:7:5`');
        expect(markdown).toContain('equivalent mutant needs no test');
    });

    it('exits 0 whatever the score', async () => {
        const { root, base } = changedRepo();
        const allSurvive = reportOf({ 'src/lib/a.ts': [mutant('Survived', 3, 1)] });
        const { code, text } = await invoke(root, ['--base', base], {
            runner: reportRunner(allSurvive)
        });
        expect(code).toBe(0);
        expect(text).toMatch(/score 0\.00%/);
    });

    it('treats a report of errors only as a broken run', async () => {
        const { root, base } = changedRepo();
        const errors = reportOf({ 'src/lib/a.ts': [mutant('CompileError', 3, 1)] });
        const { code } = await invoke(root, ['--base', base], { runner: reportRunner(errors) });
        expect(code).not.toBe(0);
    });

    it('accepts a report with no mutant at all as nothing to judge', async () => {
        const { root, base } = changedRepo();
        const { code, text } = await invoke(root, ['--base', base], {
            runner: reportRunner(reportOf({}))
        });
        expect(code).toBe(0);
        expect(text).toMatch(/^Mutants on the changed lines: 0 /);
    });

    it('fails when Stryker wrote no report', async () => {
        const { root, base } = changedRepo();
        const { code, text } = await invoke(root, ['--base', base], {
            runner: reportRunner(null, 0)
        });
        expect(code).not.toBe(0);
        expect(text).toMatch(/no (readable )?report/i);
    });

    it('fails when the suite is red before any mutant (dry run, exit 1, no report)', async () => {
        const { root, base } = changedRepo();
        const { code, text } = await invoke(root, ['--base', base], {
            runner: reportRunner(null, 1)
        });
        expect(code).not.toBe(0);
        expect(text).toMatch(/dry run/i);
    });

    it('does not read an old report left by an earlier run', async () => {
        const { root, base } = changedRepo();
        write(root, 'reports/mutation-changed.json', JSON.stringify(mixed));
        const { code } = await invoke(root, ['--base', base], { runner: reportRunner(null, 0) });
        expect(code).not.toBe(0);
    });

    it('fails when Stryker exits non-zero even though a report exists', async () => {
        const { root, base } = changedRepo();
        const { code } = await invoke(root, ['--base', base], { runner: reportRunner(mixed, 1) });
        expect(code).not.toBe(0);
    });
});

describe('the time limit', () => {
    it('stops a run that never ends, prints the notice and exits 0', async () => {
        const { root, base } = changedRepo();
        let aborted = false;
        const runner = vi.fn(
            ({ signal }) =>
                new Promise(() => {
                    signal.addEventListener('abort', () => (aborted = true));
                })
        );
        const { code, text } = await invoke(root, ['--base', base, '--time-limit', '0.0005'], {
            runner
        });
        expect(code).toBe(0);
        expect(aborted).toBe(true);
        expect(text).toMatch(/did not finish in 0\.0005 minutes; the weekly run covers it/);
    });
});

describe('the grace before the hard kill', () => {
    it.each([
        [undefined, 5000],
        ['', 5000],
        ['abc', 5000],
        ['0', 5000],
        ['-5', 5000],
        ['1.5', 5000],
        ['300', 300]
    ])('reads %j as %i ms', (value, expected) => {
        expect(killGraceFrom({ MUTATION_KILL_GRACE_MS: value })).toBe(expected);
    });

    it('is 5000 ms when the variable is absent from the environment', () => {
        expect(killGraceFrom({})).toBe(5000);
    });

    it('reaches the runner as killGraceMs, from the variable or the default', async () => {
        const { root, base } = changedRepo();
        const seam = await invoke(root, ['--base', base], {
            runner: reportRunner(reportOf({})),
            env: { MUTATION_KILL_GRACE_MS: '300' }
        });
        expect(seam.runner.mock.calls[0][0].killGraceMs).toBe(300);

        const plain = await invoke(root, ['--base', base], { runner: reportRunner(reportOf({})) });
        expect(plain.runner.mock.calls[0][0].killGraceMs).toBe(5000);
    });
});

describe('the closing sentence', () => {
    const SURVIVOR_NOTE = /A survivor is a change the tests did not notice/;
    const ALL_CAUGHT = /Every judged mutant on the changed lines was caught/;
    const printed = async (report) => {
        const { root, base } = changedRepo();
        const summary = path.join(root, 'summary.md');
        const { text } = await invoke(root, ['--base', base], {
            runner: reportRunner(report),
            env: { GITHUB_STEP_SUMMARY: summary }
        });
        return { text, markdown: readFileSync(summary, 'utf8') };
    };

    it('explains survivors when one survived', async () => {
        const { text, markdown } = await printed(
            reportOf({ 'src/lib/a.ts': [mutant('Killed', 1, 1), mutant('Survived', 3, 1)] })
        );
        for (const output of [text, markdown]) {
            expect(output).toMatch(SURVIVOR_NOTE);
            expect(output).not.toMatch(ALL_CAUGHT);
        }
    });

    it('says every mutant was caught when there are mutants and none is open', async () => {
        const { text, markdown } = await printed(
            reportOf({ 'src/lib/a.ts': [mutant('Killed', 1, 1), mutant('Timeout', 3, 1)] })
        );
        for (const output of [text, markdown]) {
            expect(output).toMatch(ALL_CAUGHT);
            expect(output).not.toMatch(SURVIVOR_NOTE);
        }
    });

    it('prints the head line alone when there is no mutant', async () => {
        const { text, markdown } = await printed(reportOf({}));
        expect(text.split('\n')).toHaveLength(1);
        expect(markdown).not.toMatch(ALL_CAUGHT);
        expect(markdown).not.toMatch(SURVIVOR_NOTE);
    });
});

describe('listeners', () => {
    const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const counts = () => STOP_SIGNALS.map((name) => process.listenerCount(name));

    it.each([
        ['a finished run', () => reportRunner(reportOf({}))],
        ['a failed run', () => vi.fn(async () => Promise.reject(new Error('spawn failed')))],
        ['the time limit', () => vi.fn(() => new Promise(() => {}))]
    ])('are all removed after %s', async (_name, makeRunner) => {
        const { root, base } = changedRepo();
        const before = counts();
        await invoke(root, ['--base', base, '--time-limit', '0.0005'], { runner: makeRunner() });
        expect(counts()).toEqual(before);
    });
});

/* ------------------------------------------------- a signal sent to the script itself */

describe('a stop signal sent to the script', () => {
    // A stand-in for Stryker's binary: one child of its own, both PIDs written to a file, then it waits.
    const standIn = (ignoreTerm) => `
        const { spawn } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        const idle = 'setInterval(() => {}, 1000)';
        const ignore = ${ignoreTerm} ? "process.on('SIGTERM', () => {});" : '';
        const child = spawn(process.execPath, ['-e', ignore + idle], { stdio: 'ignore' });
        if (${ignoreTerm}) process.on('SIGTERM', () => {});
        writeFileSync(process.env.PID_FILE, JSON.stringify([process.pid, child.pid]));
        setInterval(() => {}, 1000);
    `;
    const alive = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    };
    const until = async (condition, ms) => {
        for (const end = Date.now() + ms; Date.now() < end;) {
            if (condition()) return true;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return condition();
    };

    // `timing.sinceFirstSignal` is filled with the milliseconds from the first signal to the script's exit.
    const exercise = async ({ ignoreTerm = false, signals, graceMs, timing = {} }) => {
        const { root } = changedRepo();
        write(root, 'src/lib/b.ts', body(3));
        write(root, 'node_modules/@stryker-mutator/core/bin/stryker.js', standIn(ignoreTerm));
        const pidFile = path.join(root, 'pids.json');
        const script = spawn(
            process.execPath,
            [path.join(ROOT, 'scripts/mutation-changed.mjs'), '--base', 'HEAD'],
            {
                cwd: root,
                env: {
                    ...cleanEnv(),
                    PID_FILE: pidFile,
                    ...(graceMs && { MUTATION_KILL_GRACE_MS: String(graceMs) })
                },
                stdio: 'ignore'
            }
        );
        let signalledAt;
        const exited = new Promise((resolve) =>
            script.on('close', (code) => {
                timing.sinceFirstSignal = Date.now() - signalledAt;
                resolve(code);
            })
        );
        let pids = [];
        try {
            expect(await until(() => existsSync(pidFile), 15_000)).toBe(true);
            await until(() => readFileSync(pidFile, 'utf8') !== '', 1000);
            pids = JSON.parse(readFileSync(pidFile, 'utf8'));
            for (const name of signals) {
                signalledAt ??= Date.now();
                script.kill(name);
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            const code = await Promise.race([
                exited,
                new Promise((resolve) => setTimeout(resolve, 12_000, 'still running'))
            ]);
            const gone = await until(() => pids.every((pid) => !alive(pid)), 2000);
            return { code, gone };
        } finally {
            for (const pid of [...pids, script.pid]) if (alive(pid)) process.kill(pid, 'SIGKILL');
        }
    };

    it.each([
        ['SIGTERM', 143],
        ['SIGINT', 130],
        ['SIGHUP', 129]
    ])(
        '%s stops the script and everything it started',
        async (name, code) => {
            expect(await exercise({ signals: [name] })).toEqual({ code, gone: true });
        },
        20_000
    );

    it('reaches a Stryker that ignores SIGTERM after the grace period, and survives a second signal', async () => {
        const timing = {};
        const result = await exercise({
            ignoreTerm: true,
            signals: ['SIGTERM', 'SIGINT'],
            // The grace must be clearly longer than the pause between the two signals, or the second can land after the listeners came off.
            graceMs: 1000,
            timing
        });
        expect(result).toEqual({ code: 143, gone: true });
        // The default grace is 5000 ms: a runner that ignores the seam exits after it.
        expect(timing.sinceFirstSignal).toBeLessThan(3500);
    }, 10_000);
});

describe('--pick', () => {
    it('prints the entries, writes their number to GITHUB_OUTPUT and never calls the runner', async () => {
        const { root, base } = changedRepo();
        write(root, 'src/lib/new.ts', body(2));
        const output = path.join(root, 'out.txt');
        const { code, text, runner } = await invoke(root, ['--pick', '--base', base], {
            env: { GITHUB_OUTPUT: output }
        });
        expect(code).toBe(0);
        expect(text.split('\n')).toEqual(['src/lib/a.ts:3-3', 'src/lib/new.ts']);
        expect(readFileSync(output, 'utf8')).toBe('count=2\n');
        expect(runner).not.toHaveBeenCalled();
    });

    it('writes count=0 when nothing is in scope or a cap is exceeded', async () => {
        const { root, base } = changedRepo();
        const output = path.join(root, 'out.txt');
        await invoke(root, ['--pick', '--base', base, '--max-lines', '0'], {
            env: { GITHUB_OUTPUT: output }
        });
        expect(readFileSync(output, 'utf8')).toBe('count=0\n');
    });
});

/* -------------------------------------------------------------------- the workflow */

describe('the mutation-changed workflow', () => {
    const WORKFLOW = '.github/workflows/mutation-changed.yml';
    const workflow = readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
    const lines = workflow.split('\n').filter((line) => !line.trim().startsWith('#'));
    const code = lines.join('\n');

    it('runs on the pull request events that change what is mutated', () => {
        expect(code).toMatch(
            /pull_request:\s*\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/
        );
        expect(code).not.toMatch(/^\s+(push|schedule|workflow_dispatch):/m);
    });

    it('cancels an older run of the same pull request', () => {
        expect(code).toMatch(/group: .*github\.event\.pull_request\.number/);
        expect(code).toMatch(/cancel-in-progress: true/);
    });

    it('may only read the contents', () => {
        const block = /^permissions:\n((?: {4}.+\n)+)/m.exec(code)?.[1];
        expect(block?.trim()).toBe('contents: read');
        expect(code.match(/^\s*permissions:/gm)).toHaveLength(1);
    });

    it('pins every action to a full SHA with a version comment', () => {
        const uses = workflow.split('\n').filter((line) => /^\s*-?\s*uses:/.test(line));
        expect(uses.length).toBeGreaterThanOrEqual(2);
        for (const line of uses) {
            expect(line, line).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
        }
    });

    it('checks out two commits without keeping credentials, with Node from .nvmrc', () => {
        expect(code).toMatch(/fetch-depth: 2\b/);
        expect(code).toMatch(/persist-credentials: false/);
        expect(code).toMatch(/node-version-file: \.nvmrc/);
        expect(code).toMatch(/timeout-minutes: 40\b/);
        expect(code).toMatch(/HUSKY: '0'/);
    });

    it('installs and mutates only when the pick step found entries, under the key the script writes', async () => {
        const { root, base } = changedRepo();
        const output = path.join(root, 'out.txt');
        await invoke(root, ['--pick', '--base', base], { env: { GITHUB_OUTPUT: output } });
        const key = /^(\w+)=/.exec(readFileSync(output, 'utf8'))?.[1];

        const pickId = /\bid: (\w+)\n\s+run: node scripts\/mutation-changed\.mjs --pick\b/.exec(
            code
        )?.[1];
        expect(pickId, 'the pick step needs an id and runs the script with --pick').toBeDefined();

        const guards = lines.filter((line) => /^\s+if: .*steps\./.test(line));
        expect(guards).toHaveLength(2);
        for (const guard of guards) {
            expect(guard).toContain(`steps.${pickId}.outputs.${key}`);
        }
        const install = code.indexOf('npm ci --ignore-scripts');
        const mutate = code.indexOf('npm run test:mutation:changed');
        const pick = code.indexOf('--pick');
        expect(pick).toBeGreaterThan(-1);
        expect(install).toBeGreaterThan(pick);
        expect(mutate).toBeGreaterThan(install);
    });

    it('keeps every run: on one line and lists each command in gate-tiers.json', () => {
        expect(workflow).not.toMatch(/^\s*(-\s+)?run:\s*[|>]/m);
        const tiers = JSON.parse(readFileSync(path.join(ROOT, 'scripts/gate-tiers.json'), 'utf8'));
        const allowed = new Set(tiers.ci.allowedRunSteps.map(({ run: command }) => command));
        const commands = lines.filter((line) => /^\s*(-\s+)?run:/.test(line));
        expect(commands.length).toBeGreaterThanOrEqual(3);
        for (const line of commands) {
            expect(allowed.has(line.replace(/^\s*(-\s+)?run:\s*/, '').trim()), line).toBe(true);
        }
    });

    it('is not a required check', () => {
        const ruleset = readFileSync(path.join(ROOT, '.github/ruleset.json'), 'utf8');
        const jobId = /^ {4}([\w-]+):\n/m.exec(code.split('jobs:')[1] ?? '')?.[1];
        const jobName = /^ {8}name: (.+)$/m.exec(code)?.[1]?.trim();
        const workflowName = /^name: (.+)$/m.exec(code)?.[1]?.trim();
        expect(jobId).toBeDefined();
        for (const name of [jobId, jobName, workflowName].filter(Boolean)) {
            expect(ruleset, name).not.toContain(`"context": "${name}"`);
        }
    });
});
