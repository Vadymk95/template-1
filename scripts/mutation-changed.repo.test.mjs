// The cases of mutation-changed.test.mjs that read this repository's own files: its stryker config and
// the pull request workflow that runs the script. The cases that run the script over throwaway git
// repositories live in gatelaw.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from './mutation-changed.mjs';

const ROOT = process.cwd();
const liveConfigText = readFileSync(path.join(ROOT, 'stryker.config.json'), 'utf8');
const liveConfig = JSON.parse(liveConfigText);

/* ---------------------------------------------------------------- scope matching */

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
    it('has a row for every pattern the live stryker config uses', () => {
        expect(
            Object.keys(SCOPE_ROWS),
            'stryker.config.json `mutate` changed: add or drop the matching row in SCOPE_ROWS'
        ).toEqual(liveConfig.mutate);
    });
});

/* ---------------------------------------------------------------- a git repository */

const repos = [];
afterEach(() => {
    for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
/** `n` numbered lines; `marks` replaces some of them by line number. */
const body = (n, marks = {}) =>
    Array.from({ length: n }, (_, i) => i + 1)
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

const changedRepo = () => {
    const made = makeRepo();
    write(made.root, 'src/lib/a.ts', body(10, { 3: '"x"' }));
    commit(made.root);
    return made;
};

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
