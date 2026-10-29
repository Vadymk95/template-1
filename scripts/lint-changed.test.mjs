// The iterate chain's ESLint leg. Type-aware findings (max-params, explicit-function-return-type,
// no-unnecessary-condition, ...) used to surface first at the commit hook, because the iterate chain ran
// only oxlint, which has no type information. The leg lints what the working tree changed against HEAD
// (staged, unstaged and untracked), so uncommitted work is seen and a docs-only change costs nothing.
//
// The decision (which files) is a pure function over git's output and is pinned against a real
// repository; the CLI cases run the real script, because two things only show end to end: the exit
// status has to be ESLint's, and a path ESLint ignores must not turn into a warning that
// `--max-warnings 0` then reads as a failure.
import { execFileSync, spawnSync } from 'node:child_process';
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    renameSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { changedFiles, eslintArgs, lintableFiles } from './lint-changed.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint-changed.mjs');
const GIT_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'];

// A suite that runs inside a git hook inherits the hook's repository variables; every child starts clean.
const cleanEnv = () => {
    const env = { ...process.env, CI: '', GITHUB_ACTIONS: '' };
    for (const key of GIT_VARIABLES) delete env[key];
    return env;
};

const git = (cwd, args) =>
    execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', stdio: 'pipe' });

// A minimal flat config: `no-var` is an error, `no-console` a warning, `scratch/` is ignored. No plugin,
// so the repository under test needs no dependencies of its own.
const ESLINT_CONFIG = `export default [
    { ignores: ['scratch/**'] },
    { files: ['**/*.mjs', '**/*.js', '**/*.ts'], rules: { 'no-var': 'error', 'no-console': 'warn' } }
];
`;
const CLEAN = 'export const value = 1;\n';
const BROKEN = 'var value = 1;\nexport default value;\n';

describe('lintableFiles', () => {
    it('keeps the extensions this repository lints and drops the rest', () => {
        const kept = ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.mts', 'h.cts'];
        const dropped = [
            'README.md',
            'rule.mdc',
            'data.json',
            'app/globals.css',
            '.husky/pre-commit'
        ];

        expect(lintableFiles([...dropped, ...kept])).toEqual(kept);
    });

    it('returns nothing for nothing', () => {
        expect(lintableFiles([])).toEqual([]);
    });
});

describe('eslintArgs', () => {
    it('denies warnings, shares the cache of the lint script and does not warn about ignored paths', () => {
        const args = eslintArgs(['shared/a.ts', '-odd.ts']);

        expect(args.slice(0, args.indexOf('--'))).toEqual([
            '--max-warnings',
            '0',
            '--cache',
            '--cache-location',
            '.eslintcache',
            '--no-warn-ignored'
        ]);
        // Everything after `--` is a path, even one that starts with a dash.
        expect(args.slice(args.indexOf('--') + 1)).toEqual(['shared/a.ts', '-odd.ts']);
    });
});

// The CLI cases start node and ESLint; the full suite runs them next to sixty other files, so the
// default 5 s limit is a machine-load measurement, not a property of the script.
describe('against a real git repository', { timeout: 30_000 }, () => {
    const roots = [];

    afterEach(() => {
        for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    const write = (root, file, text = CLEAN) => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    };

    // A repository whose first commit holds a README, an ESLint config and one lintable file.
    const makeRepo = () => {
        const root = mkdtempSync(path.join(tmpdir(), 'lint-changed-'));
        roots.push(root);
        git(root, ['init', '--quiet', '--initial-branch=main']);
        git(root, ['config', 'user.email', 'gate@example.invalid']);
        git(root, ['config', 'user.name', 'gate']);
        git(root, ['config', 'commit.gpgsign', 'false']);
        write(root, 'README.md', '# readme\n');
        write(root, 'eslint.config.mjs', ESLINT_CONFIG);
        write(root, 'kept.mjs');
        write(root, '.gitignore', 'generated/\n');
        git(root, ['add', '-A']);
        git(root, ['commit', '--quiet', '--no-verify', '-m', 'baseline']);
        return root;
    };

    const runScript = (root, script) =>
        spawnSync(process.execPath, [script], { cwd: root, env: cleanEnv(), encoding: 'utf8' });
    const run = (root) => runScript(root, SCRIPT);

    describe('changedFiles', () => {
        it('is empty for a clean tree', () => {
            expect(changedFiles({ cwd: makeRepo() })).toEqual([]);
        });

        it('lists unstaged, staged, added and untracked files, once each and sorted', () => {
            const root = makeRepo();
            write(root, 'kept.mjs', 'export const value = 2;\n');
            write(root, 'staged.mjs');
            git(root, ['add', 'staged.mjs']);
            write(root, 'staged.mjs', 'export const value = 3;\n');
            write(root, 'deep/er/untracked.ts');
            write(root, 'README.md', '# changed\n');

            expect(changedFiles({ cwd: root })).toEqual([
                'README.md',
                'deep/er/untracked.ts',
                'kept.mjs',
                'staged.mjs'
            ]);
        });

        it('leaves out a deleted file, staged or not, and keeps the new name of a rename', () => {
            const root = makeRepo();
            write(root, 'gone.mjs');
            write(root, 'moved.mjs');
            git(root, ['add', '-A']);
            git(root, ['commit', '--quiet', '--no-verify', '-m', 'more files']);

            unlinkSync(path.join(root, 'gone.mjs'));
            renameSync(path.join(root, 'moved.mjs'), path.join(root, 'renamed.mjs'));
            git(root, ['add', '-A']);

            expect(changedFiles({ cwd: root })).toEqual(['renamed.mjs']);
        });

        it('leaves out an untracked file the repository ignores', () => {
            const root = makeRepo();
            write(root, 'generated/out.mjs');

            expect(changedFiles({ cwd: root })).toEqual([]);
        });

        it('keeps a name with spaces and non-ASCII characters whole', () => {
            const root = makeRepo();
            write(root, 'my folder/naïve file.ts');

            expect(changedFiles({ cwd: root })).toEqual(['my folder/naïve file.ts']);
        });

        it('fails in a repository with no commit instead of reporting nothing changed', () => {
            const root = mkdtempSync(path.join(tmpdir(), 'lint-changed-'));
            roots.push(root);
            git(root, ['init', '--quiet', '--initial-branch=main']);
            write(root, 'a.ts');

            expect(() => changedFiles({ cwd: root })).toThrow(/no commit/);
        });
    });

    describe('the CLI', () => {
        it('passes in a blink, without starting ESLint, when no lintable file changed', () => {
            const root = makeRepo();
            write(root, 'README.md', '# changed\n');
            // An ESLint config that would crash proves ESLint is never started.
            write(root, 'eslint.config.mjs', 'throw new Error("ESLint was started");\n');
            git(root, ['add', '-A']);
            git(root, ['commit', '--quiet', '--no-verify', '-m', 'break the config']);
            write(root, 'README.md', '# changed again\n');

            const result = run(root);

            expect(result.status).toBe(0);
            expect(result.stdout).toContain('no changed file');
        });

        it('lints a file that was never committed', () => {
            const root = makeRepo();
            write(root, 'fresh.mjs', BROKEN);

            const result = run(root);

            expect(result.status).toBe(1);
            expect(result.stdout).toContain('no-var');
        });

        it('lints an uncommitted change to a tracked file', () => {
            const root = makeRepo();
            write(root, 'kept.mjs', BROKEN);

            expect(run(root).status).toBe(1);
        });

        it('passes a changed file that is clean', () => {
            const root = makeRepo();
            write(root, 'kept.mjs', 'export const value = 2;\n');

            expect(run(root).status).toBe(0);
        });

        it('treats a warning as a failure', () => {
            const root = makeRepo();
            write(root, 'kept.mjs', "console.log('noise');\nexport const value = 2;\n");

            const result = run(root);

            expect(result.status).toBe(1);
            expect(result.stdout).toContain('no-console');
        });

        it('does not lint a file the working tree left as committed', () => {
            const root = makeRepo();
            write(root, 'broken-but-committed.mjs', BROKEN);
            git(root, ['add', '-A']);
            git(root, ['commit', '--quiet', '--no-verify', '-m', 'commit a broken file']);
            write(root, 'README.md', '# changed\n');

            expect(run(root).status).toBe(0);
        });

        it('stays quiet about a changed file ESLint ignores, however broken', () => {
            const root = makeRepo();
            write(root, 'scratch/probe.mjs', BROKEN);

            const result = run(root);

            expect(result.status).toBe(0);
            expect(`${result.stdout}${result.stderr}`).not.toContain('ignored');
        });

        it('passes when the only change is a deletion', () => {
            const root = makeRepo();
            unlinkSync(path.join(root, 'kept.mjs'));

            expect(run(root).status).toBe(0);
        });

        // A gate script that only looks like it ran exits 0 having checked nothing: the entry check has
        // to hold when the script is reached through a symlink or from a path with `#` or `%` in it.
        it('still runs when it is reached through a symlink', () => {
            const root = makeRepo();
            write(root, 'kept.mjs', BROKEN);
            const links = mkdtempSync(path.join(tmpdir(), 'lint-changed-link-'));
            roots.push(links);
            const link = path.join(links, 'odd #1 %20.mjs');
            symlinkSync(SCRIPT, link);

            const result = runScript(root, link);

            // The finding itself, so a crash (which also exits 1) cannot pass for a lint run.
            expect(result.status).toBe(1);
            expect(result.stdout).toContain('no-var');
        });

        it('still runs from a folder with # and % in its name', () => {
            const root = makeRepo();
            write(root, 'kept.mjs', BROKEN);
            const copies = mkdtempSync(path.join(tmpdir(), 'lint-changed-copy-'));
            roots.push(copies);
            const folder = path.join(copies, 'odd #1 %20');
            mkdirSync(folder);
            // The copy resolves `eslint` from its own location, so it gets this repository's modules.
            symlinkSync(path.resolve('node_modules'), path.join(folder, 'node_modules'));
            copyFileSync(SCRIPT, path.join(folder, 'lint-changed.mjs'));
            // ...and imports the entry guard from beside itself.
            copyFileSync(
                path.join(path.dirname(SCRIPT), 'is-entry-point.mjs'),
                path.join(folder, 'is-entry-point.mjs')
            );

            const result = runScript(root, path.join(folder, 'lint-changed.mjs'));

            // The finding itself, so a crash (which also exits 1) cannot pass for a lint run.
            expect(result.status).toBe(1);
            expect(result.stdout).toContain('no-var');
        });
    });
});
