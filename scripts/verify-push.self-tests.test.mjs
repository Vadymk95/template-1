import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SELF_TESTS_FLAG } from './check-coverage.mjs';
import { makeGit } from './check-test-siblings.mjs';
import {
    decideSelfTests,
    describeSelfTests,
    readGateGlobs,
    readPushChange
} from './verify-push.mjs';

const ROOT = process.cwd();
const SCRIPT = path.resolve(ROOT, 'scripts/verify-push.mjs');
const GLOBS = JSON.parse(readFileSync(path.resolve(ROOT, 'scripts/gate-files.json'), 'utf8')).paths;
const LISTED = ['scripts/a.test.mjs', 'scripts/b.test.mjs'];
const QUIET = { CI: '', GITHUB_ACTIONS: '', GATE_SELF_TESTS: '' };

// Hook-exported GIT_* variables would make a child git answer for another repository.
const cleanEnv = (extra = {}) => {
    const env = { ...process.env, ...QUIET };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) {
        delete env[key];
    }
    return { ...env, ...extra };
};

const decide = (paths, env = QUIET) =>
    decideSelfTests({ env, listed: LISTED, globs: GLOBS, readChange: () => ({ paths }) });

describe('decideSelfTests: which pushes leave the listed tests out', () => {
    it('leaves them out when the push changes only app code', () => {
        expect(decide(['src/lib/a.ts', 'src/lib/a.test.ts', 'src/pages/Home/index.tsx'])).toEqual({
            leaveOut: true,
            reason: ''
        });
    });

    it('leaves them out when the push changes nothing', () => {
        expect(decide([]).leaveOut).toBe(true);
    });

    it.each([
        ['a script', 'scripts/verify-push.mjs'],
        ['a test of the harness', 'scripts/new-thing.test.mjs'],
        ['package.json', 'package.json'],
        ['the lockfile', 'package-lock.json'],
        ['a root config', 'eslint.config.js'],
        ['a folder glob', '.husky/pre-push'],
        ['a workflow', '.github/workflows/ci.yml'],
        ['a tsconfig glob', 'tsconfig.app.json'],
        ['a rule file', '.cursor/rules/workflow.mdc'],
        ['the agent guide', 'AGENTS.md'],
        ['browser support code', 'e2e/support/test.ts']
    ])('runs them when the push changes %s', (_kind, file) => {
        expect(decide(['src/lib/a.ts', file])).toEqual({
            leaveOut: false,
            reason: `harness path changed: ${file}`
        });
    });

    it('names the first harness path and how many more', () => {
        const paths = ['src/a.ts', 'scripts/x.mjs', 'package.json', '.husky/pre-push'];

        expect(decide(paths).reason).toBe('harness path changed: scripts/x.mjs and 2 more');
        expect(decide(['scripts/x.mjs', 'AGENTS.md']).reason).toBe(
            'harness path changed: scripts/x.mjs and 1 more'
        );
    });

    it('counts every path under scripts/ as a harness path, whatever the manifest lists', () => {
        expect(
            decideSelfTests({
                env: QUIET,
                listed: LISTED,
                globs: [],
                readChange: () => ({ paths: ['src/a.ts', 'scripts/x.mjs'] })
            })
        ).toEqual({ leaveOut: false, reason: 'harness path changed: scripts/x.mjs' });
    });

    it('runs them when what the push changes cannot be told', () => {
        const run = (why) =>
            decideSelfTests({
                env: QUIET,
                listed: LISTED,
                globs: GLOBS,
                readChange: () => ({ why })
            });

        expect(run('no merge base with origin/master or origin/main')).toEqual({
            leaveOut: false,
            reason: 'cannot tell what this push changes: no merge base with origin/master or origin/main'
        });
    });

    it('runs them when the manifest of harness paths cannot be read', () => {
        const result = decideSelfTests({
            env: QUIET,
            listed: LISTED,
            globs: undefined,
            readChange: () => ({ paths: ['src/a.ts'] })
        });

        expect(result.leaveOut).toBe(false);
        expect(result.reason).toMatch(/scripts\/gate-files\.json/);
    });

    it('runs them when no list names a test to leave out', () => {
        const result = decideSelfTests({
            env: QUIET,
            listed: [],
            globs: GLOBS,
            readChange: () => ({ paths: [] })
        });

        expect(result.leaveOut).toBe(false);
        expect(result.reason).toMatch(/gate-tiers\.json/);
    });

    it('runs them under CI, without looking at the change', () => {
        const readChange = () => {
            throw new Error('the change must not be read');
        };

        expect(
            decideSelfTests({
                env: { ...QUIET, CI: 'true' },
                listed: LISTED,
                globs: GLOBS,
                readChange
            })
        ).toEqual({ leaveOut: false, reason: 'CI is set' });
        expect(
            decideSelfTests({
                env: { ...QUIET, GITHUB_ACTIONS: 'true' },
                listed: LISTED,
                globs: GLOBS,
                readChange
            }).leaveOut
        ).toBe(false);
    });

    it('runs them when the operator asks, without looking at the change', () => {
        const readChange = () => {
            throw new Error('the change must not be read');
        };

        expect(
            decideSelfTests({
                env: { ...QUIET, GATE_SELF_TESTS: 'all' },
                listed: LISTED,
                globs: GLOBS,
                readChange
            })
        ).toEqual({ leaveOut: false, reason: 'GATE_SELF_TESTS=all' });
    });

    it.each(['1', 'ALL', 'true', ' all'])(
        'refuses GATE_SELF_TESTS=%j before any rule of the decision looks at anything',
        (value) => {
            const readChange = () => {
                throw new Error('the change must not be read');
            };
            const refuse = (extra = {}) =>
                decideSelfTests({
                    env: { ...QUIET, GATE_SELF_TESTS: value, ...extra },
                    listed: LISTED,
                    globs: GLOBS,
                    readChange
                });

            expect(refuse).toThrow(`GATE_SELF_TESTS="${value}"`);
            expect(refuse).toThrow(/\ball\b/);
            expect(() => refuse({ CI: 'true' })).toThrow(/GATE_SELF_TESTS/);
            expect(() => refuse({ GITHUB_ACTIONS: 'true' })).toThrow(/GATE_SELF_TESTS/);
        }
    );

    it('takes an unset and an empty override as no override', () => {
        const { GATE_SELF_TESTS: _unset, ...unset } = QUIET;

        expect(decide(['src/a.ts'], unset).leaveOut).toBe(true);
        expect(decide(['src/a.ts'], { ...QUIET, GATE_SELF_TESTS: '' }).leaveOut).toBe(true);
    });
});

describe('describeSelfTests: the line every push prints', () => {
    it('says how many were left out, why, that CI runs them and how to run them here', () => {
        const line = describeSelfTests({ leaveOut: true, reason: '' }, 10);

        expect(line).toContain('10 harness self-tests left out');
        expect(line).toContain('this push changes no harness file');
        expect(line).toContain('CI runs them');
        expect(line).toContain('GATE_SELF_TESTS=all git push');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('says that all run, and the reason', () => {
        const line = describeSelfTests(
            { leaveOut: false, reason: 'harness path changed: scripts/x.mjs and 2 more' },
            10
        );

        expect(line).toContain('all harness self-tests run');
        expect(line).toContain('harness path changed: scripts/x.mjs and 2 more');
        expect(line.split('\n')).toHaveLength(1);
    });
});

describe('readGateGlobs', () => {
    const dirs = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    const withManifest = (text) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'gate-globs-'));
        dirs.push(dir);
        mkdirSync(path.join(dir, 'scripts'));
        if (text !== undefined) writeFileSync(path.join(dir, 'scripts/gate-files.json'), text);
        return dir;
    };

    it.each([
        ['a missing file', undefined],
        ['text that is not JSON', 'nope'],
        ['a manifest with no paths', '{}'],
        ['paths that are not strings', '{"paths":[1]}']
    ])('gives undefined for %s', (_kind, text) => {
        expect(readGateGlobs(withManifest(text))).toBeUndefined();
    });
});

describe('readPushChange (real repositories)', () => {
    const repos = [];
    const git = (cwd, args) =>
        execFileSync('git', args, {
            cwd,
            env: cleanEnv(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();

    const write = (root, file, text = 'x\n') => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    };

    const commit = (root, message) => {
        git(root, ['add', '-A']);
        git(root, ['commit', '--quiet', '-m', message]);
    };

    const initRepo = () => {
        const root = mkdtempSync(path.join(tmpdir(), 'push-change-'));
        repos.push(root);
        git(root, ['init', '--quiet', '--initial-branch=master']);
        git(root, ['config', 'user.email', 'test@example.test']);
        git(root, ['config', 'user.name', 'Test']);
        git(root, ['config', 'commit.gpgsign', 'false']);
        return root;
    };

    /** A repository whose first commit holds a few files and is also `origin/master`. */
    const makeRepo = (remote = 'origin/master') => {
        const root = initRepo();
        write(root, 'src/lib/a.ts');
        write(root, 'scripts/tool.mjs', 'one\nline\nafter\nline\nmore\nlines\nhere\nthere\n');
        write(root, 'package.json', '{}\n');
        commit(root, 'base');
        if (remote) git(root, ['update-ref', `refs/remotes/${remote}`, 'HEAD']);
        return root;
    };

    const change = (root, env = QUIET) => readPushChange({ cwd: root, env: cleanEnv(env) });

    afterEach(() => {
        for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    it('lists the paths of every commit since the merge base with the remote branch', () => {
        const root = makeRepo();
        write(root, 'src/lib/b.ts');
        commit(root, 'one');
        write(root, 'src/lib/c.ts');
        commit(root, 'two');

        expect(change(root)).toEqual({ paths: ['src/lib/b.ts', 'src/lib/c.ts'] });
    });

    it('lists nothing for a branch that adds nothing', () => {
        expect(change(makeRepo())).toEqual({ paths: [] });
    });

    it('lists a deleted path', () => {
        const root = makeRepo();
        git(root, ['rm', '--quiet', 'scripts/tool.mjs']);
        commit(root, 'delete');

        expect(change(root)).toEqual({ paths: ['scripts/tool.mjs'] });
    });

    it('lists both sides of a rename, however git is configured to detect renames', () => {
        const root = makeRepo();
        git(root, ['config', 'diff.renames', 'true']);
        git(root, ['mv', 'scripts/tool.mjs', 'src/lib/tool.ts']);
        commit(root, 'rename');

        expect(change(root).paths.toSorted()).toEqual(['scripts/tool.mjs', 'src/lib/tool.ts']);
    });

    it('feeds a deleted harness file and a rename out of the harness into the decision', () => {
        const root = makeRepo();
        git(root, ['mv', 'scripts/tool.mjs', 'src/lib/tool.ts']);
        commit(root, 'rename');

        expect(
            decideSelfTests({
                env: QUIET,
                listed: LISTED,
                globs: GLOBS,
                readChange: () => change(root)
            }).leaveOut
        ).toBe(false);
    });

    it('takes the base from origin/main when there is no origin/master', () => {
        const root = makeRepo('origin/main');
        write(root, 'src/lib/b.ts');
        commit(root, 'one');

        expect(change(root)).toEqual({ paths: ['src/lib/b.ts'] });
    });

    it('cannot tell when there is no remote branch, even though HEAD has a parent', () => {
        const root = makeRepo(null);
        write(root, 'src/lib/b.ts');
        commit(root, 'one');

        expect(change(root).why).toMatch(/merge base with origin\/master or origin\/main/);
    });

    it('cannot tell when the remote branch shares no history with HEAD', () => {
        const root = makeRepo(null);
        git(root, ['checkout', '--quiet', '--orphan', 'other']);
        git(root, ['rm', '-rf', '--quiet', '.']);
        write(root, 'unrelated.txt');
        commit(root, 'unrelated root');
        git(root, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);
        git(root, ['checkout', '--quiet', 'master']);
        write(root, 'src/lib/b.ts');
        commit(root, 'one');

        expect(change(root).why).toMatch(/merge base/);
    });

    it('cannot tell when git cannot run in the folder', () => {
        const missing = path.join(tmpdir(), 'push-change-no-such-folder');

        expect(change(missing).why).toMatch(/merge base|git/);
    });

    it('cannot tell when the base is found but git cannot list the changed paths', () => {
        const root = makeRepo();
        write(root, 'src/lib/b.ts');
        commit(root, 'one');
        const real = makeGit(root);
        const stubGit = (args) => (args[0] === 'diff' ? null : real(args));

        expect(readPushChange({ cwd: root, env: cleanEnv(), git: stubGit })).toEqual({
            why: 'git could not list the changed paths'
        });
    });

    it('cannot tell when the package sits below the repository root', () => {
        const root = initRepo();
        write(root, 'app/src/a.ts');
        write(root, 'app/scripts/tool.mjs');
        commit(root, 'base');
        git(root, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);
        write(root, 'app/scripts/tool.mjs', 'changed\n');
        commit(root, 'one');

        expect(change(path.join(root, 'app')).why).toMatch(/not at the repository root/);
        expect(change(root).paths).toEqual(['app/scripts/tool.mjs']);
    });

    it('does not take a hook-exported GIT_DIR for the repository it was asked about', () => {
        const root = makeRepo();
        const decoy = makeRepo(null);
        write(root, 'src/lib/b.ts');
        commit(root, 'one');
        const previous = process.env.GIT_DIR;
        process.env.GIT_DIR = path.join(decoy, '.git');
        try {
            expect(readPushChange({ cwd: root, env: cleanEnv() })).toEqual({
                paths: ['src/lib/b.ts']
            });
        } finally {
            if (previous === undefined) delete process.env.GIT_DIR;
            else process.env.GIT_DIR = previous;
        }
    });
});

/* The dispatcher boots node, npm and node again for every case, so the budget is a process-boot budget. */
describe('verify-push CLI: the line and the signal', { timeout: 30_000 }, () => {
    const dirs = [];
    const git = (cwd, args) =>
        execFileSync('git', args, { cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

    /** A repository whose `verify:scaffold:push` and `verify:ci` print what the signal says. */
    const makeFixture = ({
        selfTests = ['scripts/a.test.mjs', 'scripts/b.test.mjs'],
        remote = true
    }) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'verify-push-self-'));
        dirs.push(dir);
        const probe = `node -e "console.log('SIGNAL=' + String(process.env.${SELF_TESTS_FLAG}))"`;
        writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify({
                name: 'fixture',
                version: '0.0.0',
                scripts: { 'verify:scaffold:push': probe, 'verify:ci': probe }
            })
        );
        mkdirSync(path.join(dir, 'scripts'));
        writeFileSync(
            path.join(dir, 'scripts/gate-tiers.json'),
            JSON.stringify({ phase: 0, checks: {}, selfTests: { files: selfTests } })
        );
        copyFileSync(
            path.join(ROOT, 'scripts/gate-files.json'),
            path.join(dir, 'scripts/gate-files.json')
        );
        mkdirSync(path.join(dir, 'src'));
        writeFileSync(path.join(dir, 'src/a.ts'), 'a\n');
        git(dir, ['init', '--quiet', '--initial-branch=master']);
        git(dir, ['config', 'user.email', 'test@example.test']);
        git(dir, ['config', 'user.name', 'Test']);
        git(dir, ['config', 'commit.gpgsign', 'false']);
        git(dir, ['add', '-A']);
        git(dir, ['commit', '--quiet', '-m', 'base']);
        if (remote) git(dir, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);
        return dir;
    };

    const addCommit = (dir, file) => {
        mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        writeFileSync(path.join(dir, file), 'changed\n');
        git(dir, ['add', '-A']);
        git(dir, ['commit', '--quiet', '-m', 'change']);
    };

    const run = (dir, extra = {}) => {
        try {
            const output = execFileSync('node', [SCRIPT], {
                cwd: dir,
                encoding: 'utf8',
                env: cleanEnv({ GATE_PHASE: '', ...extra }),
                stdio: ['ignore', 'pipe', 'pipe']
            });
            return { code: 0, output };
        } catch (error) {
            return {
                code: error.status ?? 1,
                output: `${error.stdout ?? ''}${error.stderr ?? ''}`
            };
        }
    };

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    it('leaves the tests out of an app-only push: prints that and sets the signal', () => {
        const dir = makeFixture({});
        addCommit(dir, 'src/b.ts');

        const { code, output } = run(dir);

        expect(code).toBe(0);
        expect(output).toContain('2 harness self-tests left out');
        expect(output).toContain('SIGNAL=1');
    });

    it('runs them when the push changes a harness file: prints that and sets no signal', () => {
        const dir = makeFixture({});
        addCommit(dir, 'scripts/new.mjs');

        const { output } = run(dir);

        expect(output).toContain('all harness self-tests run');
        expect(output).toContain('harness path changed: scripts/new.mjs');
        expect(output).toContain('SIGNAL=undefined');
    });

    it('removes a signal the operator exported: only the decision sets it', () => {
        const dir = makeFixture({});
        addCommit(dir, 'scripts/new.mjs');

        expect(run(dir, { [SELF_TESTS_FLAG]: '1' }).output).toContain('SIGNAL=undefined');
    });

    it('prints the line, and sets no signal, with no remote branch to compare with', () => {
        const dir = makeFixture({ remote: false });
        addCommit(dir, 'src/b.ts');

        const { output } = run(dir);

        expect(output).toContain('cannot tell what this push changes');
        expect(output).toContain('SIGNAL=undefined');
    });

    it('prints the line on the full chain too: the phase does not change the rule', () => {
        const dir = makeFixture({});
        addCommit(dir, 'src/b.ts');

        const { output } = run(dir, { GATE_PHASE: 'full' });

        expect(output).toContain('2 harness self-tests left out');
        expect(output).toContain('SIGNAL=1');
        expect(output).not.toContain('PHASE 0');
    });

    it('keeps the phase 0 lines and prints its own line after them, before the chain', () => {
        const dir = makeFixture({});
        addCommit(dir, 'src/b.ts');

        const { output } = run(dir);

        expect(output.indexOf('PHASE 0')).toBeGreaterThanOrEqual(0);
        expect(output.indexOf('PHASE 0')).toBeLessThan(output.indexOf('harness self-tests'));
        expect(output.indexOf('harness self-tests')).toBeLessThan(output.indexOf('SIGNAL='));
    });

    it.each(['1', 'ALL', 'true'])(
        'refuses GATE_SELF_TESTS=%s: one message, a failing exit, no line and no chain',
        (value) => {
            const dir = makeFixture({});
            addCommit(dir, 'src/b.ts');

            const { code, output } = run(dir, { GATE_SELF_TESTS: value });

            expect(code).not.toBe(0);
            expect(output).toContain(`GATE_SELF_TESTS="${value}"`);
            expect(output).toMatch(/\ball\b/);
            expect(output).not.toContain('PHASE 0');
            expect(output).not.toContain('harness self-tests');
            expect(output).not.toContain('SIGNAL=');
        }
    );

    it('runs everything for GATE_SELF_TESTS=all, with no signal', () => {
        const dir = makeFixture({});
        addCommit(dir, 'src/b.ts');

        const { code, output } = run(dir, { GATE_SELF_TESTS: 'all' });

        expect(code).toBe(0);
        expect(output).toContain('all harness self-tests run (GATE_SELF_TESTS=all)');
        expect(output).toContain('SIGNAL=undefined');
    });
});
