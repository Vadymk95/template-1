import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// transform URL, so the file-URL form would not locate the script on disk.
const SCRIPT = resolve(process.cwd(), 'scripts/check-hooks.mjs');

/* Every case runs in a throwaway git repo, never against this repo's real config —
   a guard test that mutates the guarded state would be its own incident. GIT_* is
   stripped for the same reason: inherited from a hook, it points the child git at
   the REAL repo. */
const CLEAN_ENV = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    CI: ''
};

const makeRepo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-hooks-'));
    execFileSync('git', ['init', '-q'], { cwd: dir, env: CLEAN_ENV });
    return dir;
};

const run = (cwd, env = {}) => {
    try {
        const output = execFileSync('node', [SCRIPT], {
            cwd,
            encoding: 'utf8',
            env: { ...CLEAN_ENV, ...env }
        });
        return { code: 0, output };
    } catch (error) {
        return {
            code: error.status ?? 1,
            output: `${error.stdout ?? ''}${error.stderr ?? ''}`
        };
    }
};

let repo = null;

afterEach(() => {
    if (repo !== null) {
        rmSync(repo, { recursive: true, force: true });
        repo = null;
    }
});

describe('check-hooks', () => {
    it('passes when core.hooksPath resolves to this repo’s .husky/_', () => {
        repo = makeRepo();
        mkdirSync(join(repo, '.husky/_'), { recursive: true });
        execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], {
            cwd: repo,
            env: CLEAN_ENV
        });
        expect(run(repo).code).toBe(0);
    });

    it('refuses a hooksPath pointing elsewhere, and prints the one-line fix', () => {
        /* The measured failure mode: an absolute path left over from a repo move — git skips
           every hook silently while .husky/_ still exists on disk. */
        repo = makeRepo();
        mkdirSync(join(repo, '.husky/_'), { recursive: true });
        execFileSync('git', ['config', 'core.hooksPath', '/tmp/nowhere/.husky/_'], {
            cwd: repo,
            env: CLEAN_ENV
        });
        const verdict = run(repo);
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain('git config core.hooksPath .husky/_');
    });

    it('refuses an UNSET hooksPath even though .husky/_ exists', () => {
        /* Unset means git runs .git/hooks — husky never installed; existence of the
           directory alone proved nothing, which is exactly the fail-open this closes. */
        repo = makeRepo();
        mkdirSync(join(repo, '.husky/_'), { recursive: true });
        const verdict = run(repo);
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain('git config core.hooksPath .husky/_');
    });

    it('still fails loudly when .husky/_ is missing entirely', () => {
        repo = makeRepo();
        const verdict = run(repo);
        expect(verdict.code).toBe(1);
        expect(verdict.output).toContain('npm run prepare');
    });

    it('skips on CI, where hooks are not installed by design', () => {
        repo = makeRepo();
        expect(run(repo, { CI: 'true' }).code).toBe(0);
    });

    it('answers for the CWD repo even when a hook-exported GIT_DIR points at another repo', () => {
        /* The GIT_DIR leak, reproduced: without the env strip, `git config` reads the OTHER
           repo's config and this check both lies and (in the write direction) mutates the wrong
           repo. The correctly configured cwd repo must pass even with a poisoned environment. */
        repo = makeRepo();
        mkdirSync(join(repo, '.husky/_'), { recursive: true });
        execFileSync('git', ['config', 'core.hooksPath', '.husky/_'], {
            cwd: repo,
            env: CLEAN_ENV
        });
        const otherRepo = makeRepo();
        try {
            const verdict = run(repo, {
                GIT_DIR: join(otherRepo, '.git'),
                GIT_WORK_TREE: otherRepo
            });
            expect(verdict.code).toBe(0);
        } finally {
            rmSync(otherRepo, { recursive: true, force: true });
        }
    });
});
