// The EXEMPT list is the part of this gate people actually edit, and every edit
// widens it — usually to get one commit moving. These cases pin what the exemptions
// are FOR, so a widening that changes the policy fails here instead of silently
// letting untested logic land.
//
// `exists` is injected, so the specs describe the decision, not the tree.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    findMissingSiblings,
    isSrcLogic,
    resolveBase,
    siblingCandidates
} from './check-test-siblings.mjs';

const nothingExists = () => false;
const everythingExists = () => true;

describe('isSrcLogic', () => {
    it.each([
        'src/lib/queryClient.ts',
        'src/hooks/useDebounce.ts',
        'src/store/auth/authStore.ts',
        'src/pages/LoginPage/useLoginForm.ts',
        'src/components/common/Toast/Toast.tsx'
    ])('treats %s as logic that needs a test', (file) => {
        expect(isSrcLogic(file)).toBe(true);
    });

    it.each([
        // Tests and declarations have nothing of their own to cover.
        ['a test file', 'src/lib/utils.test.ts'],
        ['a type declaration', 'src/types/global.d.ts'],
        ['the vite env shim', 'src/vite-env.d.ts'],
        // Barrels re-export; a test would assert the re-export, not behaviour.
        ['a barrel', 'src/pages/LoginPage/index.ts'],
        ['a lazy-route barrel', 'src/pages/DevPlayground/index.ts'],
        // Declaration-only registries: changing a value is not changing logic.
        ['a constants table', 'src/store/auth/constants.ts'],
        ['a storage-key registry', 'src/store/auth/keys.ts'],
        ['a route map', 'src/router/routes.ts'],
        // Entry points and generated UI.
        ['the app entry', 'src/main.tsx'],
        ['the root component', 'src/App.tsx'],
        ['validated env', 'src/env.ts'],
        ['a generated shadcn primitive', 'src/components/ui/button.tsx'],
        // Test and mock infrastructure.
        ['an MSW handler', 'src/mocks/handlers.ts'],
        ['a test util', 'src/test/test-utils.tsx'],
        // Documented template seeds — see TEMPLATE_SEEDS.md.
        ['a template seed', 'src/lib/api/_exampleQuery.ts']
    ])('exempts %s', (_label, file) => {
        expect(isSrcLogic(file)).toBe(false);
    });

    it('ignores files outside src entirely', () => {
        expect(isSrcLogic('scripts/audit-gate.mjs')).toBe(false);
        expect(isSrcLogic('e2e/login.spec.ts')).toBe(false);
        expect(isSrcLogic('vite.config.ts')).toBe(false);
    });

    it('ignores non-TypeScript files under src', () => {
        expect(isSrcLogic('src/index.css')).toBe(false);
        expect(isSrcLogic('src/assets/logo.svg')).toBe(false);
    });

    it('does NOT exempt a component that happens to be named index.tsx', () => {
        // The barrel exemption is spelled `index.ts` on purpose. In this template `index.tsx` IS the
        // component, so a loose `index.tsx?$` waved every component in `src/components/**` through.
        expect(isSrcLogic('src/components/layout/Header/index.tsx')).toBe(true);
        expect(isSrcLogic('src/components/common/ThemeToggle/index.tsx')).toBe(true);
    });

    it('does not exempt a path that merely CONTAINS an exempt segment name', () => {
        // `^src/components/ui/` is anchored on purpose. The generated shadcn
        // primitives live at exactly that path; a feature that happens to nest its
        // own `components/ui/` deeper is ordinary code and still needs tests.
        // Un-anchoring the pattern is what this case exists to catch, so the path
        // must contain `components/ui/` somewhere OTHER than the start.
        expect(isSrcLogic('src/features/editor/components/ui/Toolbar.tsx')).toBe(true);
        // Same for the mocks and test directories.
        expect(isSrcLogic('src/features/editor/mocks/fixtures.ts')).toBe(true);
        expect(isSrcLogic('src/features/editor/test/helpers.ts')).toBe(true);
        // `constants.ts$` is an exact filename, not a prefix.
        expect(isSrcLogic('src/lib/constantsFactory.ts')).toBe(true);
    });
});

describe('siblingCandidates', () => {
    it('probes both extensions for an ordinary module', () => {
        expect(siblingCandidates('src/lib/utils.ts')).toEqual([
            'src/lib/utils.test.ts',
            'src/lib/utils.test.tsx'
        ]);
    });

    it('accepts the directory-named test for a component written as index.tsx', () => {
        expect(siblingCandidates('src/components/layout/Header/index.tsx')).toEqual([
            'src/components/layout/Header/index.test.ts',
            'src/components/layout/Header/index.test.tsx',
            'src/components/layout/Header/Header.test.tsx',
            'src/components/layout/Header/Header.test.ts'
        ]);
    });

    it('does not invent a directory-named candidate for a non-index file', () => {
        // Otherwise `Header/useHeader.ts` would be satisfied by `Header/Header.test.tsx`, and one test
        // would cover every module in the folder.
        expect(siblingCandidates('src/components/layout/Header/useHeader.ts')).toEqual([
            'src/components/layout/Header/useHeader.test.ts',
            'src/components/layout/Header/useHeader.test.tsx'
        ]);
    });
});

describe('findMissingSiblings', () => {
    it('refuses a component whose folder holds a test for a DIFFERENT module', () => {
        // The accepting direction alone would pass with a directory scan. This is the case a scan
        // gets wrong: a sibling test exists in the folder, but not for this component.
        const exists = (path) => path === 'src/components/layout/Header/useHeader.test.ts';

        expect(findMissingSiblings(['src/components/layout/Header/index.tsx'], exists)).toEqual([
            'src/components/layout/Header/index.tsx'
        ]);
    });

    it('accepts a component covered by the directory-named test', () => {
        const exists = (path) => path === 'src/components/layout/Header/Header.test.tsx';

        expect(findMissingSiblings(['src/components/layout/Header/index.tsx'], exists)).toEqual([]);
    });

    it('reports a logic file with no sibling', () => {
        expect(findMissingSiblings(['src/lib/utils.ts'], nothingExists)).toEqual([
            'src/lib/utils.ts'
        ]);
    });

    it('accepts a .ts file covered by a .test.ts sibling', () => {
        const exists = (path) => path === 'src/lib/utils.test.ts';

        expect(findMissingSiblings(['src/lib/utils.ts'], exists)).toEqual([]);
    });

    it('accepts a .tsx file covered by a .test.tsx sibling', () => {
        const exists = (path) => path === 'src/components/common/Toast/Toast.test.tsx';

        expect(findMissingSiblings(['src/components/common/Toast/Toast.tsx'], exists)).toEqual([]);
    });

    it('accepts a .tsx file covered by a .test.ts sibling — either extension counts', () => {
        const exists = (path) => path === 'src/components/common/Toast/Toast.test.ts';

        expect(findMissingSiblings(['src/components/common/Toast/Toast.tsx'], exists)).toEqual([]);
    });

    it('passes an empty change set', () => {
        expect(findMissingSiblings([], nothingExists)).toEqual([]);
    });

    it('never reports an exempt file, even with nothing on disk', () => {
        expect(
            findMissingSiblings(['src/main.tsx', 'src/components/ui/button.tsx'], nothingExists)
        ).toEqual([]);
    });

    it('reports every offender rather than stopping at the first', () => {
        expect(
            findMissingSiblings(['src/lib/a.ts', 'src/main.tsx', 'src/lib/b.ts'], nothingExists)
        ).toEqual(['src/lib/a.ts', 'src/lib/b.ts']);
    });

    it('cannot be satisfied by an unrelated existing file', () => {
        // A blanket-true `exists` would hide the bug where the wrong path is probed.
        // This asserts the probe is derived from the file under test.
        const probed = [];
        const exists = (path) => {
            probed.push(path);
            return false;
        };

        findMissingSiblings(['src/store/auth/authStore.ts'], exists);

        expect(probed).toEqual([
            'src/store/auth/authStore.test.ts',
            'src/store/auth/authStore.test.tsx'
        ]);
    });

    it('treats a sibling that exists for a DIFFERENT module as no cover', () => {
        expect(findMissingSiblings(['src/lib/a.ts'], everythingExists)).toEqual([]);
        expect(findMissingSiblings(['src/lib/a.ts'], (p) => p.includes('b.test'))).toEqual([
            'src/lib/a.ts'
        ]);
    });
});

describe('resolveBase', () => {
    // `git(args)` answers like the real thing: stdout, or null when the command fails.
    const fakeGit =
        ({ commits = [], mergeBases = {}, shallow = false }) =>
        (args) => {
            if (args[0] === 'rev-parse' && args.includes('--verify')) {
                const ref = args.at(-1).replace(/\^\{commit\}$/, '');
                return commits.includes(ref) ? ref : null;
            }
            if (args[0] === 'merge-base') return mergeBases[args[2]] ?? null;
            if (args[0] === 'rev-parse' && args.includes('--is-shallow-repository')) {
                return shallow ? 'true' : 'false';
            }
            return null;
        };

    it('compares with the previous commit under CI', () => {
        const git = fakeGit({ commits: ['HEAD~1', 'mb'], mergeBases: { 'origin/master': 'mb' } });

        expect(resolveBase({ git, env: { CI: 'true' } })).toEqual({ ref: 'HEAD~1' });
    });

    it('compares with the merge base with origin/master on a developer machine', () => {
        const git = fakeGit({ commits: ['HEAD~1', 'mb'], mergeBases: { 'origin/master': 'mb' } });

        expect(resolveBase({ git, env: {} })).toEqual({ ref: 'mb' });
    });

    it('falls back to origin/main, then to the previous commit', () => {
        const main = fakeGit({ commits: ['HEAD~1', 'mm'], mergeBases: { 'origin/main': 'mm' } });
        expect(resolveBase({ git: main, env: {} })).toEqual({ ref: 'mm' });

        const none = fakeGit({ commits: ['HEAD~1'] });
        expect(resolveBase({ git: none, env: {} })).toEqual({ ref: 'HEAD~1' });
    });

    it('refuses an explicit base that is not a commit', () => {
        const result = resolveBase({ git: fakeGit({}), env: {}, baseRef: 'nope' });

        expect(result.error).toMatch(/nope is not a commit/);
    });

    it('fails loud on a shallow clone with no parent instead of passing on nothing', () => {
        const result = resolveBase({ git: fakeGit({ shallow: true }), env: { CI: 'true' } });

        expect(result.error).toMatch(/shallow clone/);
        expect(result.error).toMatch(/fetch-depth: 2/);
    });

    it('treats the first commit of a full clone as having no base', () => {
        expect(resolveBase({ git: fakeGit({}), env: {} })).toEqual({ ref: null, root: true });
    });
});

describe('the command line against a real repository', () => {
    const SCRIPT = path.resolve(process.cwd(), 'scripts/check-test-siblings.mjs');
    const repos = [];

    // A suite run from inside a git hook inherits the hook's GIT_* variables; every child starts clean
    // and a test that wants a poisoned or alternate one passes it in `extra`.
    const cleanEnv = (extra = {}) => {
        const env = { ...process.env, CI: '', GITHUB_ACTIONS: '' };
        for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) {
            delete env[key];
        }
        return { ...env, ...extra };
    };

    const git = (cwd, args, extra) =>
        execFileSync('git', args, {
            cwd,
            env: cleanEnv(extra),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim();

    const write = (root, file, text = 'export {};\n') => {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    };

    const commit = (root, message) => {
        git(root, ['add', '-A']);
        git(root, ['commit', '--quiet', '-m', message]);
    };

    const cli = (cwd, args = [], extra) => {
        const result = spawnSync('node', [SCRIPT, ...args], {
            cwd,
            env: cleanEnv(extra),
            encoding: 'utf8'
        });
        return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    };

    /** A repository with no commit yet. */
    const initRepo = (prefix) => {
        const root = mkdtempSync(path.join(tmpdir(), prefix));
        repos.push(root);
        git(root, ['init', '--quiet', '--initial-branch=master']);
        git(root, ['config', 'user.email', 'test@example.test']);
        git(root, ['config', 'user.name', 'Test']);
        git(root, ['config', 'commit.gpgsign', 'false']);
        return root;
    };

    /** A repo whose first commit is covered code, with `origin/master` pointing at it. */
    const makeRepo = () => {
        const root = initRepo('test-siblings-');
        write(root, 'src/lib/ok.ts');
        write(root, 'src/lib/ok.test.ts');
        commit(root, 'base');
        git(root, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);
        return root;
    };

    afterEach(() => {
        for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    describe('staged mode', () => {
        it('refuses a staged source whose sibling test is only on disk, untracked', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            git(root, ['add', 'src/lib/a.ts']);

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/a.ts');
        });

        it('accepts a staged source with its sibling staged beside it', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            git(root, ['add', '-A']);

            expect(cli(root).code).toBe(0);
        });

        it('accepts a changed source whose sibling is already committed and untouched', () => {
            const root = makeRepo();
            write(root, 'src/lib/ok.ts', 'export const ok = 1;\n');
            git(root, ['add', '-A']);

            expect(cli(root).code).toBe(0);
        });

        // `git add -N` lists the path in the index but stages no content, so a commit leaves the file out.
        it('refuses a staged source whose sibling is only an intent-to-add entry', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            git(root, ['add', 'src/lib/a.ts']);
            git(root, ['add', '-N', 'src/lib/a.test.ts']);

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/a.ts');
        });

        it('accepts a sibling that was intent-to-add and then staged for real', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            git(root, ['add', 'src/lib/a.ts']);
            git(root, ['add', '-N', 'src/lib/a.test.ts']);
            git(root, ['add', 'src/lib/a.test.ts']);

            expect(cli(root).code).toBe(0);
        });

        // HEAD holds the sibling and `ls-files` still lists it, but the index deletes it (`git rm --cached`)
        // and `git add -N` only re-marks the path: the commit removes the file, so it covers nothing.
        it('refuses a committed sibling that was removed from the index and re-marked with intent-to-add', () => {
            const root = makeRepo();
            write(root, 'src/lib/ok.ts', 'export const ok = 2;\n');
            git(root, ['add', 'src/lib/ok.ts']);
            git(root, ['rm', '--quiet', '--cached', 'src/lib/ok.test.ts']);
            git(root, ['add', '-N', 'src/lib/ok.test.ts']);

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/ok.ts');
        });

        it('refuses a sibling that is intent-to-add and then deleted from the disk', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            git(root, ['add', 'src/lib/a.ts']);
            git(root, ['add', '-N', 'src/lib/a.test.ts']);
            rmSync(path.join(root, 'src/lib/a.test.ts'));

            expect(cli(root).code).toBe(1);
        });

        it('accepts a sibling staged and then deleted from the disk: the commit still carries it', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            git(root, ['add', '-A']);
            rmSync(path.join(root, 'src/lib/a.test.ts'));

            expect(cli(root).code).toBe(0);
        });

        it('accepts a sibling that arrives as a staged rename of a committed file', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            git(root, ['mv', 'src/lib/ok.test.ts', 'src/lib/a.test.ts']);
            git(root, ['add', 'src/lib/a.ts']);

            // The rename shows as `R`, not `A`, in a plain staged diff: only a listing that turns
            // rename detection off sees the new path as a staged addition.
            expect(cli(root).code).toBe(0);
        });

        it('refuses a source whose sibling left the index but stayed on disk', () => {
            const root = makeRepo();
            write(root, 'src/lib/ok.ts', 'export const ok = 1;\n');
            git(root, ['add', '-A']);
            git(root, ['rm', '--quiet', '--cached', 'src/lib/ok.test.ts']);

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/ok.ts');
        });

        it('refuses a renamed source that left its sibling behind', () => {
            const root = makeRepo();
            git(root, ['mv', 'src/lib/ok.ts', 'src/lib/moved.ts']);

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/moved.ts');
        });

        it('answers for the whole repository when run from a subdirectory', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/b.ts');
            write(root, 'src/lib/b.test.ts');
            git(root, ['add', '-A']);

            const result = cli(path.join(root, 'src/lib'));

            // `b` is covered, `a` is not: a script that resolved paths against the subdirectory would
            // misjudge one of them.
            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/a.ts');
            expect(result.stderr).not.toContain('src/lib/b.ts');
        });

        it('answers for the cwd repository when a hook-exported GIT_DIR names another one', () => {
            const root = makeRepo();
            const decoy = makeRepo();
            write(root, 'src/lib/a.ts');
            git(root, ['add', '-A']);

            const result = cli(root, [], { GIT_DIR: path.join(decoy, '.git') });

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/a.ts');
        });

        it('reads the index named by GIT_INDEX_FILE, the one a partial commit hands its hook', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            const alternate = path.join(root, '.git', 'alternate-index');
            git(root, ['update-index', '--add', 'src/lib/a.ts'], { GIT_INDEX_FILE: alternate });

            // The default index holds nothing new, so only the alternate index can make this fail.
            expect(cli(root).code).toBe(0);
            expect(cli(root, [], { GIT_INDEX_FILE: alternate }).code).toBe(1);
        });

        // A fork's first commit is the whole template, starter files with no sibling included, and
        // there is no earlier commit to compare with, so nothing is judged (range mode does the same).
        it('says so, and passes, on the first commit of a repository', () => {
            const root = initRepo('test-siblings-first-');
            write(root, 'src/lib/starter.ts');
            git(root, ['add', '-A']);

            const result = cli(root);

            expect(result.code).toBe(0);
            expect(result.stdout).toMatch(/the first commit/);
        });

        it('judges the second commit again', () => {
            const root = initRepo('test-siblings-second-');
            write(root, 'src/lib/starter.ts');
            commit(root, 'first');
            write(root, 'src/lib/added.ts');
            git(root, ['add', '-A']);

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/added.ts');
            expect(result.stderr).not.toContain('src/lib/starter.ts');
        });

        // The first-commit exemption is "HEAD does not resolve", and that is just as true of a
        // folder that is no repository and of a repository whose index cannot be read. Both
        // refusals have to come first: past them the gate would pass where it can see nothing.
        it('refuses a folder outside any git repository, never reading it as a first commit', () => {
            const outside = mkdtempSync(path.join(tmpdir(), 'test-siblings-outside-'));
            repos.push(outside);

            // The ceiling stops git from walking up out of the temp folder into a repository
            // around it, which would be read as that repository's first commit.
            const result = cli(outside, [], { GIT_CEILING_DIRECTORIES: path.dirname(outside) });

            expect(result.code).toBe(1);
            expect(result.stderr).toMatch(/not inside a git repository/);
            expect(result.stdout).not.toMatch(/the first commit/);
        });

        it('refuses an index it cannot read, even before the first commit', () => {
            const root = initRepo('test-siblings-index-');
            write(root, '.git/index', 'not an index');

            const result = cli(root);

            expect(result.code).toBe(1);
            expect(result.stderr).toMatch(/cannot read the git index/);
            expect(result.stdout).not.toMatch(/the first commit/);
        });
    });

    describe('range mode', () => {
        it('refuses a source added on the branch with no sibling', () => {
            const root = makeRepo();
            write(root, 'src/lib/orphan.ts');
            commit(root, 'orphan');

            const result = cli(root, ['--range']);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/orphan.ts');
        });

        it('accepts a source added with its sibling', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/a.test.ts');
            commit(root, 'covered');

            expect(cli(root, ['--range']).code).toBe(0);
        });

        it('does not count a sibling that is on disk but not committed', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            commit(root, 'source only');
            write(root, 'src/lib/a.test.ts');

            expect(cli(root, ['--range']).code).toBe(1);
        });

        it('counts a sibling committed later in the same range', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            commit(root, 'source');
            write(root, 'src/lib/a.test.ts');
            commit(root, 'test');

            expect(cli(root, ['--range']).code).toBe(0);
        });

        it('passes when the branch changes nothing since the base', () => {
            const root = makeRepo();

            expect(cli(root, ['--range']).code).toBe(0);
        });

        it('takes an explicit base...head', () => {
            const root = makeRepo();
            const base = git(root, ['rev-parse', 'HEAD']);
            write(root, 'src/lib/orphan.ts');
            commit(root, 'orphan');

            expect(cli(root, ['--range', `${base}...HEAD`]).code).toBe(1);
            expect(cli(root, ['--range', 'HEAD...HEAD']).code).toBe(0);
        });

        it('compares with the previous commit under CI', () => {
            const root = makeRepo();
            write(root, 'src/lib/orphan.ts');
            commit(root, 'orphan');
            write(root, 'src/lib/fine.ts');
            write(root, 'src/lib/fine.test.ts');
            commit(root, 'fine');

            // The orphan is two commits back: CI judges the last commit (a merge commit, in a pull
            // request), which here is covered.
            expect(cli(root, ['--range'], { CI: 'true' }).code).toBe(0);
            expect(cli(root, ['--range']).code).toBe(1);
        });

        it('fails loud, rather than passing, on a shallow clone with no parent under CI', () => {
            const root = makeRepo();
            const clone = mkdtempSync(path.join(tmpdir(), 'test-siblings-shallow-'));
            repos.push(clone);
            git(clone, ['clone', '--quiet', '--depth=1', `file://${root}`, 'work']);

            const result = cli(path.join(clone, 'work'), ['--range'], { CI: 'true' });

            expect(result.code).toBe(1);
            expect(result.stderr).toMatch(/shallow clone/);
        });

        it('says so, and passes, when the first commit leaves nothing to compare with', () => {
            const root = initRepo('test-siblings-root-');
            write(root, 'src/lib/orphan.ts');
            commit(root, 'first');

            const result = cli(root, ['--range']);

            // A template's own first commit carries files of the template, so a range with no
            // other end judges nothing, and neither does the staged check of that commit.
            expect(result.code).toBe(0);
            expect(result.stdout).toMatch(/no base commit to compare with/);
        });

        it('refuses an explicit base that is not a commit', () => {
            const root = makeRepo();

            const result = cli(root, ['--range', 'no-such-ref...HEAD']);

            expect(result.code).toBe(1);
            expect(result.stderr).toMatch(/no-such-ref is not a commit/);
        });
    });

    // The iterate chain runs this mode: it judges the working tree against HEAD, so a missing test is
    // found before `git add`, not at the commit hook. A sibling counts when it is on disk, because at
    // this moment nothing is staged yet; the commit hook still wants it in the index.
    describe('changed mode', () => {
        /** A repo whose HEAD also holds `src/lib/legacy.ts`, a logic file with no test. */
        const makeRepoWithLegacy = () => {
            const root = initRepo('test-siblings-changed-');
            write(root, 'src/lib/ok.ts');
            write(root, 'src/lib/ok.test.ts');
            write(root, 'src/lib/legacy.ts');
            commit(root, 'base');
            git(root, ['update-ref', 'refs/remotes/origin/master', 'HEAD']);
            return root;
        };

        it('passes on a clean tree, even when HEAD holds a file with no test', () => {
            expect(cli(makeRepoWithLegacy(), ['--changed']).code).toBe(0);
        });

        it('refuses an untracked logic file with no test and names the file and the remedy', () => {
            const root = makeRepo();
            write(root, 'src/lib/fresh.ts');

            const result = cli(root, ['--changed']);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/fresh.ts');
            expect(result.stderr).toContain('add src/lib/fresh.test.ts');
        });

        it('accepts an untracked logic file with an untracked test beside it', () => {
            const root = makeRepo();
            write(root, 'src/lib/fresh.ts');
            write(root, 'src/lib/fresh.test.ts');

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('refuses a staged-only logic file with no test', () => {
            const root = makeRepo();
            write(root, 'src/lib/fresh.ts');
            git(root, ['add', 'src/lib/fresh.ts']);

            const result = cli(root, ['--changed']);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/fresh.ts');
        });

        it('accepts a staged logic file whose test is staged too', () => {
            const root = makeRepo();
            write(root, 'src/lib/fresh.ts');
            write(root, 'src/lib/fresh.test.ts');
            git(root, ['add', '-A']);

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('refuses an unstaged edit of a tracked logic file that has no test', () => {
            const root = makeRepoWithLegacy();
            write(root, 'src/lib/legacy.ts', 'export const changed = 1;\n');

            const result = cli(root, ['--changed']);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/legacy.ts');
        });

        it('accepts an unstaged edit of a tracked logic file whose test is committed', () => {
            const root = makeRepo();
            write(root, 'src/lib/ok.ts', 'export const changed = 1;\n');

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('applies the exempt list of the commit hook', () => {
            const root = makeRepo();
            write(root, 'src/lib/constants.ts');
            write(root, 'src/pages/Login/index.ts');
            write(root, 'src/components/ui/button.tsx');
            write(root, 'src/types/global.d.ts');
            write(root, 'src/lib/api/_exampleQuery.ts');

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('ignores a changed file outside src', () => {
            const root = makeRepo();
            write(root, 'scripts/tool.mjs');
            write(root, 'e2e/home.spec.ts');

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('does not judge a deleted logic file', () => {
            const root = makeRepoWithLegacy();
            rmSync(path.join(root, 'src/lib/legacy.ts'));

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('judges a renamed logic file at its new path', () => {
            const root = makeRepo();
            git(root, ['mv', 'src/lib/ok.ts', 'src/lib/renamed.ts']);

            const result = cli(root, ['--changed']);

            // `ok.test.ts` stayed behind: the old name had a test, the new one has none.
            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/renamed.ts');
            expect(result.stderr).not.toContain('src/lib/ok.ts');
        });

        it('accepts a renamed logic file that moved with its test', () => {
            const root = makeRepo();
            git(root, ['mv', 'src/lib/ok.ts', 'src/lib/renamed.ts']);
            git(root, ['mv', 'src/lib/ok.test.ts', 'src/lib/renamed.test.ts']);

            expect(cli(root, ['--changed']).code).toBe(0);
        });

        it('reports every offender, not only the first', () => {
            const root = makeRepo();
            write(root, 'src/lib/a.ts');
            write(root, 'src/lib/b.tsx');

            const result = cli(root, ['--changed']);

            expect(result.code).toBe(1);
            expect(result.stderr).toContain('src/lib/a.ts');
            expect(result.stderr).toContain('src/lib/b.tsx');
        });

        it('fails in a repository with no commit, rather than judging nothing', () => {
            const root = initRepo('test-siblings-changed-empty-');
            write(root, 'src/lib/fresh.ts');

            const result = cli(root, ['--changed']);

            expect(result.code).toBe(1);
            expect(result.stderr).toMatch(/no commit/);
        });

        it('refuses to combine with --range or with named files', () => {
            const root = makeRepo();

            for (const args of [
                ['--changed', '--range'],
                ['--changed', 'src/lib/ok.ts']
            ]) {
                const result = cli(root, args);

                expect(result.code).toBe(1);
                expect(result.stderr).toMatch(/cannot be combined/);
            }
        });
    });
});
