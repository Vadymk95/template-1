#!/usr/bin/env node
// Mutation testing on the lines a change touched: which mutants of those lines do the tests miss?
// Informational: the exit code is 0 whatever the score; it is non-zero only when the run itself is broken.
//
// Usage:
//   node scripts/mutation-changed.mjs [--base <ref>] [--max-files 20] [--max-lines 800]
//                                     [--concurrency <n>] [--time-limit <minutes, default 25>]
//   node scripts/mutation-changed.mjs --pick   # print what would be mutated; built-ins only, no Stryker
//
// The base is the one `check-test-siblings --range` uses. Changed lines = base commit against the working
// tree plus untracked files, kept to the `mutate` scope of stryker.config.json (a `--mutate` on Stryker's
// command line would REPLACE that list, so the scope is applied here and Stryker gets only the entries).
// Stryker runs with the repository config and four differences: `mutate`, no incremental file, a JSON
// report of its own, no break threshold. The weekly mutation.yml covers what this check skips.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { isEntryPoint } from './is-entry-point.mjs';
import { makeGit, resolveBase } from './check-test-siblings.mjs';

const REPORT_FILE = 'reports/mutation-changed.json';
const CONFIG_FILE = 'reports/mutation-changed.config.json';
const STRYKER_BIN = 'node_modules/@stryker-mutator/core/bin/stryker.js';
// A name Stryker cannot take as a range (the CLI splits on a comma; a glob character makes a range invalid).
const UNMUTATABLE = /[,*?!+@()[\]{}]/;
// The wait between SIGTERM and SIGKILL. MUTATION_KILL_GRACE_MS is a seam for the process test only, not an option.
const KILL_GRACE_MS = 5000;
const REPLACEMENT_LIMIT = 80;
const ALL_CAUGHT = 'Every judged mutant on the changed lines was caught.';
// Signals that stop the script; the exit code is the conventional 128 + the signal number.
const STOP_SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
const CLOSING =
    'A survivor is a change the tests did not notice: add a test that fails on it, or skip it when the mutant behaves like the original (an equivalent mutant needs no test).';

/** Whether `file` is in the `mutate` list: patterns apply in order, a `!` removes, a plain one adds. */
export const inScope = (file, patterns) =>
    patterns.reduce(
        (included, pattern) =>
            pattern.startsWith('!')
                ? included && !path.posix.matchesGlob(file, pattern.slice(1))
                : included || path.posix.matchesGlob(file, pattern),
        false
    );

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** From `git diff -U0`: per file the new-side line ranges of its hunks (a hunk that only deletes gives none). */
export const parseDiff = (text) => {
    const files = [];
    let current = null;
    let inHunk = false;
    for (const line of text.split('\n')) {
        if (line.startsWith('diff --git ')) {
            current = { file: null, added: false, ranges: [] };
            files.push(current);
            inHunk = false;
        } else if (!current) {
            continue;
        } else if (!inHunk && line === '--- /dev/null') {
            current.added = true;
        } else if (!inHunk && line.startsWith('+++ ')) {
            const raw = line.slice(4);
            const name = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/\t.*$/, '');
            current.file = name.replace(/^b\//, '');
        } else if (HUNK.test(line)) {
            inHunk = true;
            const [, start, count = '1'] = HUNK.exec(line);
            if (Number(count) > 0) current.ranges.push([+start, +start + +count - 1]);
        }
    }
    return files.filter(({ file }) => file !== null);
};

const countLines = (text) => text.split('\n').length - (text.endsWith('\n') || text === '' ? 1 : 0);

/** The in-scope changes: { entries: [{ file, ranges|null, lines }], unsupported: [file] }. */
export const collectEntries = ({ git, cwd, baseRef, patterns }) => {
    const diff = git([
        '-c',
        'core.quotePath=false',
        'diff',
        '-U0',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        '--diff-filter=ACMR',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        baseRef,
        '--'
    ]);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (diff === null || untracked === null)
        throw new Error(`cannot read the changes since ${baseRef}`);

    const changes = parseDiff(diff).map(({ file, added, ranges }) => ({
        file,
        ranges: added ? null : ranges,
        lines: ranges.reduce((sum, [from, to]) => sum + to - from + 1, 0)
    }));
    for (const file of untracked.split('\0').filter(Boolean)) {
        const text = inScope(file, patterns) ? readFileSync(path.join(cwd, file), 'utf8') : '';
        changes.push({ file, ranges: null, lines: countLines(text) });
    }

    const wanted = changes.filter(({ file, lines }) => lines > 0 && inScope(file, patterns));
    wanted.sort((a, b) => a.file.localeCompare(b.file));
    return {
        entries: wanted.filter(({ file }) => !UNMUTATABLE.test(file)),
        unsupported: wanted.filter(({ file }) => UNMUTATABLE.test(file)).map(({ file }) => file)
    };
};

export const entryStrings = (entries) =>
    entries.flatMap(({ file, ranges }) =>
        ranges ? ranges.map(([from, to]) => `${file}:${from}-${to}`) : [file]
    );

/** The repository config with the four differences. */
export const buildConfig = (base, mutate) => ({
    ...base,
    mutate,
    incremental: false,
    reporters: [...new Set([...(base.reporters ?? []), 'json'])],
    jsonReporter: { fileName: REPORT_FILE },
    thresholds: { ...base.thresholds, break: null }
});

const STATUS_KEY = {
    Killed: 'killed',
    Timeout: 'timeout',
    Survived: 'survived',
    NoCoverage: 'noCoverage',
    CompileError: 'errors',
    RuntimeError: 'errors',
    Ignored: 'ignored'
};

const shorten = (text = '') => {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat === '') return '(empty)';
    return flat.length > REPLACEMENT_LIMIT ? `${flat.slice(0, REPLACEMENT_LIMIT)}…` : flat;
};

/** Counts, score and the survived or uncovered mutants (sorted) of a Stryker JSON report. */
export const summarize = (report) => {
    const counts = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, errors: 0, ignored: 0 };
    const open = [];
    for (const [file, { mutants }] of Object.entries(report.files)) {
        for (const { status, mutatorName, replacement, location } of mutants) {
            if (STATUS_KEY[status]) counts[STATUS_KEY[status]] += 1;
            if (status !== 'Survived' && status !== 'NoCoverage') continue;
            const { line, column } = location.start;
            open.push({
                file,
                line,
                column,
                status,
                mutatorName,
                replacement: shorten(replacement)
            });
        }
    }
    open.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const judged = counts.killed + counts.timeout + counts.survived + counts.noCoverage;
    const score = judged
        ? `${(((counts.killed + counts.timeout) / judged) * 100).toFixed(2)}%`
        : 'n/a';
    const { killed, timeout, survived, noCoverage, errors, ignored } = counts;
    const head = `Mutants on the changed lines: ${total} (${killed} killed, ${timeout} timed out, ${survived} survived, ${noCoverage} no coverage, ${errors} errors, ${ignored} ignored); score ${score}`;
    return { head, open, judged, onlyErrors: errors > 0 && errors === total };
};

const where = ({ file, line, column }) => `${file}:${line}:${column}`;
/** The closing sentence: the survivor advice when something is open, a clean line when all was caught. */
const closing = ({ open, judged }) => {
    if (open.length) return CLOSING;
    return judged ? ALL_CAUGHT : '';
};
const renderText = ({ head, open, judged }) =>
    [
        head,
        ...open.map((m) => `${where(m)} ${m.status} ${m.mutatorName} -> ${m.replacement}`),
        closing({ open, judged })
    ]
        .filter(Boolean)
        .join('\n');
const renderMarkdown = ({ head, open, judged }) =>
    [
        '### Mutation on the changed lines',
        head,
        open
            .map(
                (m) =>
                    `- \`${where(m)}\` ${m.status} ${m.mutatorName} -> \`${m.replacement.replaceAll('`', "'")}\``
            )
            .join('\n'),
        closing({ open, judged })
    ]
        .filter(Boolean)
        .join('\n\n');

const parseArguments = (argv) => {
    const { values } = parseArgs({
        args: argv,
        options: {
            base: { type: 'string' },
            pick: { type: 'boolean' },
            'max-files': { type: 'string' },
            'max-lines': { type: 'string' },
            concurrency: { type: 'string' },
            'time-limit': { type: 'string' }
        }
    });
    const number = (name, fallback, min) => {
        const value = Number(values[name] ?? fallback);
        if (!(value >= min)) throw new Error(`--${name} needs a number of at least ${min}`);
        return value;
    };
    return {
        base: values.base,
        pick: values.pick,
        maxFiles: number('max-files', 20, 0),
        maxLines: number('max-lines', 800, 0),
        concurrency: values.concurrency && number('concurrency', 0, 1),
        timeLimit: number('time-limit', 25, Number.MIN_VALUE)
    };
};

/** The grace from the environment: a positive whole number of milliseconds, else the default. */
export const killGraceFrom = (env) => {
    const value = Number(env.MUTATION_KILL_GRACE_MS);
    return Number.isSafeInteger(value) && value > 0 ? value : KILL_GRACE_MS;
};

/** The real runner: Stryker as a child in its own process group, killed as a group when the signal aborts. */
export const strykerRunner = ({ config, concurrency, signal, cwd, killGraceMs = KILL_GRACE_MS }) =>
    new Promise((resolve, reject) => {
        mkdirSync(path.join(cwd, 'reports'), { recursive: true });
        writeFileSync(path.join(cwd, CONFIG_FILE), JSON.stringify(config, null, 4));
        const args = [path.join(cwd, STRYKER_BIN), 'run', path.join(cwd, CONFIG_FILE)];
        if (concurrency) args.push('--concurrency', String(concurrency));
        const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', detached: true });
        let hardKill;
        const signalGroup = (name) => {
            try {
                process.kill(-child.pid, name);
            } catch {
                // the group is already gone
            }
        };
        signal.addEventListener('abort', () => {
            signalGroup('SIGTERM');
            hardKill = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(hardKill);
            // After a stop the leader may be gone while a worker that ignored SIGTERM is not.
            if (hardKill) signalGroup('SIGKILL');
            resolve({ code: code ?? 1 });
        });
    });

export const run = async ({
    argv,
    cwd,
    env,
    runner = strykerRunner,
    out = console.log,
    err = console.error
}) => {
    const say = (text, markdown = text) => {
        out(text);
        if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`);
    };
    try {
        const options = parseArguments(argv);
        const config = JSON.parse(readFileSync(path.join(cwd, 'stryker.config.json'), 'utf8'));
        const git = makeGit(cwd);
        const base = resolveBase({ git, env, baseRef: options.base });
        if (base.error) throw new Error(base.error);

        const { entries, unsupported } = base.root
            ? { entries: [], unsupported: [] }
            : collectEntries({ git, cwd, baseRef: base.ref, patterns: config.mutate });
        const strings = entryStrings(entries);
        const files = entries.length;
        const lines = entries.reduce((sum, entry) => sum + entry.lines, 0);
        const notes = unsupported.map(
            (file) => `${file} cannot be mutated by range; the weekly run covers it`
        );

        let skip = null;
        if (base.root)
            skip = 'No base commit to compare with (the first commit): nothing to mutate.';
        else if (files === 0) skip = 'Nothing in the mutation scope changed: nothing to mutate.';
        else if (files > options.maxFiles || lines > options.maxLines) {
            skip = `The change touches ${files} files and ${lines} lines in the mutation scope, above the cap of ${options.maxFiles} files or ${options.maxLines} lines; the weekly run covers it.`;
        }
        const countOutput = (count) => {
            if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `count=${count}\n`);
        };

        if (options.pick) {
            if (skip) say([skip, ...notes].join('\n'));
            else out([...strings, ...notes].join('\n'));
            countOutput(skip ? 0 : strings.length);
            return 0;
        }
        if (skip) {
            say([skip, ...notes].join('\n'));
            return 0;
        }
        if (notes.length) say(notes.join('\n'));

        const reportPath = path.join(cwd, REPORT_FILE);
        rmSync(reportPath, { force: true });
        const controller = new AbortController();
        let timer;
        const expired = new Promise((resolve) => {
            timer = setTimeout(() => resolve('expired'), options.timeLimit * 60_000);
        });
        const finished = Promise.resolve(
            runner({
                config: buildConfig(config, strings),
                concurrency: options.concurrency,
                signal: controller.signal,
                cwd,
                killGraceMs: killGraceFrom(env)
            })
        );
        finished.catch(() => {});
        let onStop;
        const stopped = new Promise((resolve) => (onStop = resolve));
        const listeners = Object.keys(STOP_SIGNALS).map((name) => [name, () => onStop(name)]);
        for (const [name, listener] of listeners) process.on(name, listener);
        let result;
        try {
            result = await Promise.race([finished, expired, stopped]).finally(() =>
                clearTimeout(timer)
            );
            if (STOP_SIGNALS[result]) {
                // Stryker is its own process group: stop it as the time limit does, wait until it is gone.
                controller.abort();
                say(`Interrupted by ${result}: Stryker was stopped.`);
                await finished.catch(() => {});
                return 128 + STOP_SIGNALS[result];
            }
        } finally {
            for (const [name, listener] of listeners) process.off(name, listener);
        }
        if (result === 'expired') {
            controller.abort();
            say(
                `Mutation did not finish in ${options.timeLimit} minutes; the weekly run covers it.`
            );
            return 0;
        }

        let report = null;
        try {
            report = JSON.parse(readFileSync(reportPath, 'utf8'));
        } catch {
            // reported below
        }
        if (result.code !== 0 || !report?.files) {
            throw new Error(
                `Stryker exited with code ${result.code} and left no readable report (${REPORT_FILE}).${result.code === 0 ? '' : ' The suite may be red before any mutant (the dry run), or the run crashed; the log above says which.'}`
            );
        }
        const summary = summarize(report);
        if (summary.onlyErrors)
            throw new Error(
                `${summary.head}: every mutant ended in an error, so nothing was judged.`
            );
        say(renderText(summary), renderMarkdown(summary));
        return 0;
    } catch (error) {
        err(`mutation-changed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
};

if (isEntryPoint(import.meta.url)) {
    process.exitCode = await run({
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        env: process.env
    });
}
