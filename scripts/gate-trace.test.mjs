import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    buildSpawnPlan,
    classifyChange,
    formatLogLine,
    gatherRunContext,
    isDocsPath,
    parseStatusPath
} from './gate-trace.mjs';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// transform URL, so the file-URL form would not locate the script on disk.
const SCRIPT = resolve(process.cwd(), 'scripts/gate-trace.mjs');
const LOG_FILE = '.gate-trace.log';

/* Every case runs in a throwaway git repo, never against this repo's real config. Git's own
   environment must not leak in either: when this suite runs inside a hook, git exports `GIT_DIR`
   (and friends) to the process tree, and a child `git` call that inherits them acts on the REAL
   repo instead of the temp dir — the exact incident class that once rewrote a live
   core.hooksPath from inside a test. */
const GIT_ENV = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    NODE_ENV: process.env.NODE_ENV ?? 'test'
};

/* Every child captures its output. `execFileSync` copies the child's stderr onto the test run's
   unless `stdio` is given, so git's progress lines ("Preparing worktree") and the wrapper's usage
   line would land in every log; `runWrapper` hands the captured text back for the assertions. */
const CAPTURE = ['ignore', 'pipe', 'pipe'];

const git = (args, cwd) =>
    execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: CAPTURE });

const makeRepo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-trace-'));
    git(['init', '-q'], dir);
    git(['config', 'user.email', 'test@example.com'], dir);
    git(['config', 'user.name', 'Test'], dir);
    git(['commit', '--allow-empty', '-q', '-m', 'init'], dir);
    return dir;
};

const runWrapper = (cwd, args) => {
    try {
        const output = execFileSync('node', [SCRIPT, ...args], {
            cwd,
            encoding: 'utf8',
            env: GIT_ENV,
            stdio: CAPTURE
        });
        return { code: 0, output };
    } catch (error) {
        return {
            code: error.status ?? 1,
            output: `${error.stdout ?? ''}${error.stderr ?? ''}`
        };
    }
};

const readLogLines = (cwd) => {
    try {
        return readFileSync(join(cwd, LOG_FILE), 'utf8')
            .split('\n')
            .filter((line) => line.length > 0);
    } catch {
        return [];
    }
};

const cleanupDirs = [];

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const dir = cleanupDirs.pop();
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('gate-trace CLI passthrough (the one thing that must not be got wrong)', () => {
    it('exits with the wrapped command’s own failing code', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        const verdict = runWrapper(repo, ['smoke-fail', '--', 'node', '-e', 'process.exit(3)']);
        expect(verdict.code).toBe(3);
    });

    it('exits with the wrapped command’s own passing code', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        const verdict = runWrapper(repo, ['smoke-pass', '--', 'node', '-e', 'process.exit(0)']);
        expect(verdict.code).toBe(0);
    });

    it('logs a line on FAILURE, not only on success', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        runWrapper(repo, ['smoke-fail', '--', 'node', '-e', 'process.exit(3)']);
        const lines = readLogLines(repo);
        expect(lines).toHaveLength(1);
        const fields = lines[0]?.split('\t') ?? [];
        expect(fields[1]).toBe('smoke-fail');
        expect(fields[3]).toBe('3');
    });

    it('also logs a line on success', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        runWrapper(repo, ['smoke-pass', '--', 'node', '-e', 'process.exit(0)']);
        const lines = readLogLines(repo);
        expect(lines).toHaveLength(1);
        const fields = lines[0]?.split('\t') ?? [];
        expect(fields[1]).toBe('smoke-pass');
        expect(fields[3]).toBe('0');
    });

    it('still exits with the command’s code when the log path itself cannot be written', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        // A directory sitting where the log file needs to be: appendFileSync throws EISDIR.
        // Instrumentation may never fail a build, so the wrapper's own exit code must be
        // untouched by this.
        mkdirSync(join(repo, LOG_FILE));
        const verdict = runWrapper(repo, ['smoke-fail', '--', 'node', '-e', 'process.exit(3)']);
        expect(verdict.code).toBe(3);
    });

    it('rejects a call with no "--" separator instead of silently misparsing the command', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        const verdict = runWrapper(repo, ['smoke-fail', 'node', '-e', 'process.exit(3)']);
        expect(verdict.code).toBe(2);
        expect(verdict.output).toContain('Usage:');
    });
});

describe('gate-trace log line shape', () => {
    it('writes exactly 9 tab-separated fields in the documented order', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        runWrapper(repo, ['shape-check', '--', 'node', '-e', 'process.exit(0)']);
        const fields = readLogLines(repo)[0]?.split('\t') ?? [];
        expect(fields).toHaveLength(9);
        const [
            timestamp,
            label,
            durationMs,
            exitCode,
            branch,
            toplevel,
            worktreeKind,
            changeClass
        ] = fields;
        expect(() => new Date(timestamp ?? '').toISOString()).not.toThrow();
        expect(label).toBe('shape-check');
        expect(Number(durationMs)).toBeGreaterThanOrEqual(0);
        expect(exitCode).toBe('0');
        expect(branch).not.toBe('');
        expect(toplevel).not.toBe('');
        expect(worktreeKind).toBe('main');
        expect(changeClass).toBe('clean');
    });
});

describe('gate-trace change-class detection (real git status)', () => {
    it('classifies a docs-only change (*.md and .cursor/ paths)', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        writeFileSync(join(repo, 'README.md'), 'x');
        runWrapper(repo, ['docs-check', '--', 'node', '-e', 'process.exit(0)']);
        const fields = readLogLines(repo)[0]?.split('\t') ?? [];
        expect(fields[7]).toBe('docs');
    });

    it('classifies a code-only change', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        writeFileSync(join(repo, 'index.ts'), 'x');
        runWrapper(repo, ['code-check', '--', 'node', '-e', 'process.exit(0)']);
        const fields = readLogLines(repo)[0]?.split('\t') ?? [];
        expect(fields[7]).toBe('code');
    });

    it('classifies a mix of docs and code paths as mixed', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        writeFileSync(join(repo, 'README.md'), 'x');
        writeFileSync(join(repo, 'index.ts'), 'x');
        runWrapper(repo, ['mixed-check', '--', 'node', '-e', 'process.exit(0)']);
        const fields = readLogLines(repo)[0]?.split('\t') ?? [];
        expect(fields[7]).toBe('mixed');
    });

    it('classifies a clean tree as clean', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        runWrapper(repo, ['clean-check', '--', 'node', '-e', 'process.exit(0)']);
        const fields = readLogLines(repo)[0]?.split('\t') ?? [];
        expect(fields[7]).toBe('clean');
    });
});

/* The porcelain line of a tracked file with an unstaged edit is ` M path`: the leading space is the
   "index unchanged" column, not padding. Git runs inside the code under test, so these cases use a
   real repository; the pure classifier above never sees the text git printed. A first line that
   lost its space shifted the path parse by one character and read a `.cursor/` path as code. */
describe('gate-trace change class when a status line starts with a space (real git status)', () => {
    const commitFiles = (repo, files) => {
        for (const file of files) {
            mkdirSync(dirname(join(repo, file)), { recursive: true });
            writeFileSync(join(repo, file), 'before');
            // Forced: a developer's global ignore file may list `.cursor/`, and git refuses to add it.
            git(['add', '-f', file], repo);
        }
        git(['commit', '-q', '-m', 'add tracked files'], repo);
        for (const file of files) {
            writeFileSync(join(repo, file), 'after');
        }
    };

    const changeClassWith = (files) => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        commitFiles(repo, files);
        return gatherRunContext(repo).changeClass;
    };

    it('reads an edited .cursor/ file on the first line as docs', () => {
        expect(changeClassWith(['.cursor/rules/x.mdc'])).toBe('docs');
    });

    it('reads an edited code file on the first line as code', () => {
        expect(changeClassWith(['scripts/a.mjs'])).toBe('code');
    });

    it('reads a docs first line plus a code later line as mixed', () => {
        expect(changeClassWith(['.cursor/rules/x.mdc', 'scripts/a.mjs'])).toBe('mixed');
    });

    it('reads a code first line plus a docs later line as mixed', () => {
        expect(changeClassWith(['a.ts', 'docs/x.md'])).toBe('mixed');
    });

    it('still reads two edited docs files, one of them first, as docs', () => {
        expect(changeClassWith(['.cursor/rules/x.mdc', 'docs/x.md'])).toBe('docs');
    });
});

describe('gate-trace worktree detection', () => {
    it('tags main vs linked worktree and logs both to the SAME shared file', () => {
        const repo = makeRepo();
        cleanupDirs.push(repo);
        const worktreeDir = mkdtempSync(join(tmpdir(), 'gate-trace-wt-'));
        rmSync(worktreeDir, { recursive: true, force: true }); // git worktree add wants a fresh path
        cleanupDirs.push(worktreeDir);
        git(['worktree', 'add', worktreeDir, '-b', 'other-branch'], repo);

        runWrapper(repo, ['main-check', '--', 'node', '-e', 'process.exit(0)']);
        runWrapper(worktreeDir, ['worktree-check', '--', 'node', '-e', 'process.exit(0)']);

        // The worktree has no log of its own: both runs land in the main checkout's file.
        expect(readLogLines(worktreeDir)).toHaveLength(0);
        const lines = readLogLines(repo);
        expect(lines).toHaveLength(2);
        const [, , , , , mainToplevel, mainKind] = lines[0]?.split('\t') ?? [];
        const [, , , , , worktreeToplevel, worktreeKind] = lines[1]?.split('\t') ?? [];
        // git resolves symlinks in its own output (macOS: /var -> /private/var), so the
        // comparison must go through the same resolution rather than the raw mkdtemp path.
        expect(mainKind).toBe('main');
        expect(mainToplevel).toBe(realpathSync(repo));
        expect(worktreeKind).toBe('worktree');
        expect(worktreeToplevel).toBe(realpathSync(worktreeDir));
    });
});

describe('buildSpawnPlan (pure) — the caffeinate wrap must not reshape the command', () => {
    it('wraps under caffeinate -dimsu on macOS when the binary exists', () => {
        expect(
            buildSpawnPlan({
                platform: 'darwin',
                caffeinateAvailable: true,
                command: 'npm',
                commandArgs: ['run', 'verify:iter:inner']
            })
        ).toEqual({ command: 'caffeinate', args: ['-dimsu', 'npm', 'run', 'verify:iter:inner'] });
    });

    it('runs the command as-is on macOS when caffeinate is missing', () => {
        expect(
            buildSpawnPlan({
                platform: 'darwin',
                caffeinateAvailable: false,
                command: 'npm',
                commandArgs: ['test']
            })
        ).toEqual({ command: 'npm', args: ['test'] });
    });

    it('runs the command as-is on non-mac platforms (CI runners are linux)', () => {
        expect(
            buildSpawnPlan({
                platform: 'linux',
                caffeinateAvailable: true,
                command: 'npm',
                commandArgs: ['test']
            })
        ).toEqual({ command: 'npm', args: ['test'] });
    });
});

describe('classifyChange (pure)', () => {
    it('treats an empty status as clean', () => {
        expect(classifyChange('')).toBe('clean');
    });

    it('treats every path under .md or .cursor/ as docs', () => {
        expect(classifyChange(' M README.md\n?? .cursor/brain/DECISIONS.md')).toBe('docs');
    });

    it('treats no docs paths as code', () => {
        expect(classifyChange(' M shared/lib/utils.ts\n?? scripts/new.mjs')).toBe('code');
    });

    it('treats a combination as mixed', () => {
        expect(classifyChange(' M README.md\n?? shared/lib/utils.ts')).toBe('mixed');
    });

    it('resolves a rename to its NEW path', () => {
        expect(classifyChange('R  old-name.ts -> README.md')).toBe('docs');
    });
});

describe('parseStatusPath / isDocsPath (pure)', () => {
    it('strips the two-character status prefix and the following space', () => {
        expect(parseStatusPath(' M shared/lib/utils.ts')).toBe('shared/lib/utils.ts');
    });

    it('takes the destination side of a rename arrow', () => {
        expect(parseStatusPath('R  old.ts -> new.ts')).toBe('new.ts');
    });

    it('accepts a root .md file and any .cursor/ path', () => {
        expect(isDocsPath('README.md')).toBe(true);
        expect(isDocsPath('.cursor/brain/MAP.md')).toBe(true);
        expect(isDocsPath('shared/lib/utils.ts')).toBe(false);
    });
});

describe('formatLogLine (pure)', () => {
    it('joins the 9 fields in the documented order, tab-separated', () => {
        const line = formatLogLine({
            timestamp: '2026-08-30T00:00:00.000Z',
            label: 'verify:iter',
            durationMs: 1234,
            exitCode: 0,
            context: {
                branch: 'master',
                toplevel: '/repo',
                worktreeKind: 'main',
                changeClass: 'code',
                phase: '0'
            }
        });
        expect(line.split('\t')).toEqual([
            '2026-08-30T00:00:00.000Z',
            'verify:iter',
            '1234',
            '0',
            'master',
            '/repo',
            'main',
            'code',
            '0'
        ]);
    });

    it('renders a missing exit code as an empty field rather than the string "null"', () => {
        const line = formatLogLine({
            timestamp: '2026-08-30T00:00:00.000Z',
            label: 'verify:iter',
            durationMs: 1,
            exitCode: null,
            context: {
                branch: 'master',
                toplevel: '/repo',
                worktreeKind: 'main',
                changeClass: 'clean'
            }
        });
        expect(line.split('\t')[3]).toBe('');
    });
});
