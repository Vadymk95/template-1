// The one case of check-hooks.test.mjs that reads the husky this repository has installed: the
// hook names the check expects must be the ones that husky wires. A husky bump that adds a hook is
// caught here, in the repository that bumps it. The other cases live in gatelaw.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(process.cwd(), 'scripts/check-hooks.mjs');

/* Every case runs in a throwaway git repo, never against this repo's real config. GIT_* is stripped:
   inherited from a hook, it points the child git at the REAL repo. */
const CLEAN_ENV = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    CI: ''
};

/* Every child captures its output, so the refusal this case provokes does not read like a real
   failure in the log. */
const CAPTURE = ['ignore', 'pipe', 'pipe'];

const makeRepo = () => {
    const dir = mkdtempSync(join(tmpdir(), 'check-hooks-'));
    execFileSync('git', ['init', '-q'], { cwd: dir, env: CLEAN_ENV, stdio: CAPTURE });
    return dir;
};

const run = (cwd, env = {}) => {
    try {
        const output = execFileSync('node', [SCRIPT], {
            cwd,
            encoding: 'utf8',
            env: { ...CLEAN_ENV, ...env },
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

const put = (path, text, mode) => {
    writeFileSync(path, text);
    chmodSync(path, mode);
};

let repo = null;

afterEach(() => {
    if (repo !== null) {
        rmSync(repo, { recursive: true, force: true });
        repo = null;
    }
});

/* Each case starts git and node processes; the full suite runs them next to sixty other files, so
   the default 5 s limit measures the machine's load, not the script. */
describe('check-hooks', { timeout: 30_000 }, () => {
    describe('a hook file git would not run', () => {
        it('refuses a body with no hook file for every hook the installed husky wires', () => {
            /* Pins HUSKY_HOOKS to the real installer: the wired names are the executable files it
               writes under .husky/_ (its helper files carry no exec bit). HUSKY is emptied because
               the CI workflows set HUSKY=0, which makes husky skip the install. */
            repo = makeRepo();
            execFileSync('node', [resolve(process.cwd(), 'node_modules/husky/bin.js')], {
                cwd: repo,
                env: { ...CLEAN_ENV, HUSKY: '' },
                stdio: CAPTURE
            });
            const shims = join(repo, '.husky/_');
            const wired = readdirSync(shims).filter(
                (file) => statSync(join(shims, file)).mode & 0o100
            );
            expect(wired.length).toBeGreaterThan(0);
            for (const name of wired) {
                put(join(repo, '.husky', name), 'true\n', 0o644);
                rmSync(join(shims, name));
            }
            const verdict = run(repo);
            expect(verdict.code).toBe(1);
            const line = verdict.output.match(/^Git hooks are not installed: .* for (.+)\.$/m);
            expect(line?.[1].split(', ').sort()).toEqual([...wired].sort());
        });
    });
});
