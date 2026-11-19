import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { expandSteps, parseVerifySteps, resolveScript } from './bench-verify.mjs';

// `process.cwd()` rather than `import.meta.url`: under Vitest the module URL is not a `file:` URL, so
// resolving relative to it throws. The script itself runs under plain node and uses the URL form.
const verifyScript = () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    return resolveScript(manifest.scripts, 'verify');
};

/**
 * The point of these is that the benchmark's step list cannot drift from the gate. The previous
 * hand-written list had already lost two steps while its own header claimed they matched.
 */
describe('parseVerifySteps', () => {
    it('covers every step of the real verify script', () => {
        const script = verifyScript();
        const steps = parseVerifySteps(script);

        // One step per `&&` segment: nothing dropped, nothing invented.
        expect(steps).toHaveLength(script.split('&&').length);
        for (const step of steps) {
            expect(step.label).not.toBe('');
        }
    });

    it('includes the steps the hand-written list used to omit', () => {
        const labels = parseVerifySteps(verifyScript()).map((step) => step.label);

        expect(labels).toContain('check-hooks');
        expect(labels).toContain('ensure-playwright');
    });

    it('keeps the version-holds check in the gate, so a bump past a hold turns verify red', () => {
        const labels = parseVerifySteps(verifyScript()).map((step) => step.label);

        expect(labels).toContain('check-version-holds');
    });

    it('keeps the version-holds check in verify:scaffold, the push gate before the first deploy', () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
        const labels = parseVerifySteps(resolveScript(manifest.scripts, 'verify:scaffold')).map(
            (step) => step.label
        );

        expect(labels).toContain('check-version-holds');
    });

    it('keeps the node-floor check in verify and verify:scaffold, so a stale engines floor turns the push red', () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

        for (const name of ['verify:inner', 'verify:scaffold']) {
            const labels = parseVerifySteps(resolveScript(manifest.scripts, name)).map(
                (step) => step.label
            );
            expect(labels, name).toContain('check-node-floor');
        }
    });

    it('keeps docs-check in verify and verify:scaffold, so a focused or unquarantined skip turns the push red', () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

        for (const name of ['verify:inner', 'verify:scaffold']) {
            const labels = parseVerifySteps(resolveScript(manifest.scripts, name)).map(
                (step) => step.label
            );
            expect(labels, name).toContain('docs-check');
        }
    });

    // `tsc -b` calls a project up to date from its root files alone, the ones `include` matches. A
    // changed type file inside `node_modules` is not one of them, so a plain run stays green over a
    // dependency whose types changed; `--force` re-checks every project. The push tiers pay for that
    // once, the iterate chain runs per change and keeps the incremental run.
    it('runs the forced type check in verify and verify:scaffold, the incremental one while iterating', () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

        expect(manifest.scripts['typecheck:force']).toBe('tsc -b --force');
        for (const name of ['verify:inner', 'verify:scaffold']) {
            const labels = parseVerifySteps(resolveScript(manifest.scripts, name)).map(
                (step) => step.label
            );
            expect(labels, name).toContain('typecheck:force');
            expect(labels, name).not.toContain('typecheck');
        }

        // The raw steps, not parsed ones: this chain ends in `vitest run`, a shape the benchmark refuses.
        const iterate = resolveScript(manifest.scripts, 'verify:iter').split(/\s+&&\s+/);
        expect(iterate, 'verify:iter').toContain('npm run typecheck');
        expect(iterate, 'verify:iter').not.toContain('npm run typecheck:force');
    });

    it('keeps the sibling-test range check inside verify and verify:scaffold, never only in the network tier', () => {
        // The raw script, not the parsed steps: the benchmark keeps only a step's file, never its flags.
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

        for (const name of ['verify', 'verify:scaffold']) {
            expect(resolveScript(manifest.scripts, name), name).toContain(
                'node scripts/check-test-siblings.mjs --range'
            );
        }
        // The check is offline, so only the verify tiers carry it; the network wrappers add the registry
        // checks on top and must not run it a second time.
        for (const name of ['verify:ci:inner', 'verify:scaffold:push']) {
            expect(manifest.scripts[name], name).not.toContain('check-test-siblings');
        }
    });

    // `.npmrc` disables lifecycle scripts, so a fresh clone has no git hooks until `npm run prepare`.
    // `verify:iter` is the loop that runs while working, long before `verify` does: when only `verify`
    // checks the hooks, the first push goes out with no gate and prints nothing about it.
    it('starts verify:iter with the hooks check, so a clone without hooks fails before the first push', () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
        const iterate = resolveScript(manifest.scripts, 'verify:iter');

        expect(iterate.startsWith('node scripts/check-hooks.mjs && '), iterate).toBe(true);
    });

    it('labels an npm step by its script name and a node step by its file', () => {
        expect(parseVerifySteps('npm run typecheck && node scripts/check-hooks.mjs')).toEqual([
            { label: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
            { label: 'check-hooks', command: 'node', args: ['scripts/check-hooks.mjs'] }
        ]);
    });

    it('throws on a shape it does not know, rather than skipping the step', () => {
        // Skipping is the failure that produced this file: a step absent from the benchmark is a step
        // nobody knows is slow, and the run still reports success.
        expect(() => parseVerifySteps('npm run lint && VITE_X=1 vitest run')).toThrow(
            /cannot parse verify step/
        );
        expect(() => parseVerifySteps('npm run')).toThrow(/cannot parse verify step/);
    });

    it('ignores empty segments from a trailing separator', () => {
        expect(parseVerifySteps('npm run lint &&  ')).toHaveLength(1);
    });
});

describe('resolveScript', () => {
    it('follows an alias to the script that holds the steps', () => {
        const scripts = {
            verify: 'npm run verify:enterprise',
            'verify:enterprise': 'npm run lint && npm run build'
        };

        expect(resolveScript(scripts, 'verify')).toBe('npm run lint && npm run build');
    });

    it('returns a non-alias script unchanged', () => {
        expect(resolveScript({ verify: 'npm run lint && npm run build' }, 'verify')).toBe(
            'npm run lint && npm run build'
        );
    });

    it('follows the gate-trace wrapper to its inner script — the steps live there', () => {
        const scripts = {
            verify: 'node scripts/gate-trace.mjs verify -- npm run verify:inner',
            'verify:inner': 'npm run lint && npm run build'
        };

        expect(resolveScript(scripts, 'verify')).toBe('npm run lint && npm run build');
    });

    it('throws on a cycle routed through the gate-trace wrapper form too', () => {
        expect(() =>
            resolveScript({ a: 'node scripts/gate-trace.mjs a -- npm run a' }, 'a')
        ).toThrow(/cycle/);
    });

    it('throws on a cycle instead of looping forever', () => {
        expect(() => resolveScript({ a: 'npm run b', b: 'npm run a' }, 'a')).toThrow(/cycle/);
    });

    it('throws when the script does not exist', () => {
        expect(() => resolveScript({}, 'verify')).toThrow(/no `verify` script/);
    });
});

describe('parseVerifySteps keeps every argument of a step', () => {
    it('keeps a node step flags and an npm step extra arguments', () => {
        const steps = parseVerifySteps('node scripts/a.mjs --kill-port && npm run lint -- --fix');

        expect(steps.map((step) => step.args)).toEqual([
            ['scripts/a.mjs', '--kill-port'],
            ['run', 'lint', '--', '--fix']
        ]);
    });
});

describe('expandSteps', () => {
    const scripts = {
        top: 'node scripts/gate-trace.mjs top -- npm run top:inner',
        'top:inner': 'node scripts/a.mjs --range && npm run alias && npm run chain',
        alias: 'npm run single',
        single: 'oxlint --deny-warnings .',
        chain: 'tsc -b && vite build'
    };

    it('follows the wrapper and aliases and expands a nested chain in run order, flags kept', () => {
        expect(expandSteps(scripts, 'top')).toEqual([
            { label: 'top:inner#1', command: 'node', args: ['scripts/a.mjs', '--range'] },
            { label: 'single', command: 'oxlint', args: ['--deny-warnings', '.'] },
            { label: 'chain#1', command: 'tsc', args: ['-b'] },
            { label: 'chain#2', command: 'vite', args: ['build'] }
        ]);
    });

    it('throws on a cycle, also through the wrapper, and on a script that does not exist', () => {
        const loop = { a: 'npm run b', b: 'node scripts/gate-trace.mjs b -- npm run a' };

        expect(() => expandSteps(loop, 'a')).toThrow(/cycle a -> b -> a/);
        expect(() => expandSteps({ a: 'npm run gone' }, 'a')).toThrow(/no `gone` script/);
    });

    it('hands a segment npm would give its shell to the shell, whole, never reads it as words', () => {
        expect(expandSteps({ a: 'node b.mjs && FOO=1 node c.mjs' }, 'a')).toEqual([
            { label: 'a#1', command: 'node', args: ['b.mjs'] },
            { label: 'a#2', command: 'sh', args: ['-c', 'FOO=1 node c.mjs'] }
        ]);
        // A quote may hold the separator: the script is one shell step, never split inside it.
        const quoted = 'node -e "a && b" && npm run y';
        expect(expandSteps({ a: quoted, y: 'x' }, 'a')).toEqual([
            { label: 'a', command: 'sh', args: ['-c', quoted] }
        ]);
    });

    it('throws on a script npm would wrap in a pre or post script, rather than drop that step', () => {
        expect(() => expandSteps({ a: 'node b.mjs', prea: 'node c.mjs' }, 'a')).toThrow(/prea/);
        expect(() => expandSteps({ a: 'node b.mjs', posta: 'node c.mjs' }, 'a')).toThrow(/posta/);
    });

    it('expands the gate scripts of this package with their flags', () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

        for (const target of ['verify:ci', 'verify:scaffold:push']) {
            const lines = expandSteps(manifest.scripts, target).map((step) =>
                [step.command, ...step.args].join(' ')
            );
            expect(lines, target).toContain('node scripts/check-test-siblings.mjs --range');
            expect(lines.join('\n'), target).not.toContain('npm run');
        }
    });
});

describe('--run: runSteps in a stub package', () => {
    const dirs = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    // A package whose `gate` script is `gate`; `files` are written beside it. Returns the run of `--run gate`.
    const runGate = (gate, files, env = {}, target = 'gate') => {
        const dir = mkdtempSync(join(tmpdir(), 'bench-verify-'));
        dirs.push(dir);
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { gate } }));
        for (const [name, text] of Object.entries(files)) {
            mkdirSync(dirname(join(dir, name)), { recursive: true });
            writeFileSync(join(dir, name), text, { mode: 0o755 });
        }
        const result = spawnSync(
            process.execPath,
            [join(process.cwd(), 'scripts/bench-verify.mjs'), '--run', target],
            {
                cwd: dir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, GATE_TRACE_STEP_FILE: join(dir, 'step'), ...env }
            }
        );
        return { ...result, dir, has: (name) => existsSync(join(dir, name)) };
    };
    const THREE = 'node a.mjs && node b.mjs && node c.mjs';
    const MARK = "require('node:fs').writeFileSync('c-ran', '');";

    it('stops at the first red: the verdict names the step, the status is its own, the label is written', () => {
        const result = runGate(THREE, { 'a.mjs': '', 'b.mjs': 'process.exit(3);', 'c.mjs': MARK });

        expect(result.status).toBe(3);
        expect(result.stdout).toContain('→ step 2/3 gate#2: node b.mjs');
        expect(result.stderr).toMatch(
            /✖ gate: step gate#2 failed \(exit 3\) after \d+\.\d s; 1 later steps not run/
        );
        expect(result.has('c-ran')).toBe(false);
        expect(readFileSync(join(result.dir, 'step'), 'utf8')).toBe('gate#2');
    });

    it('answers a script it cannot expand with a verdict line and exit 1', () => {
        const result = runGate(THREE, {}, {}, 'nope');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('✖ nope: package.json has no `nope` script to run.');
    });

    it('reads a step killed by a signal as exit 1', () => {
        const kill = "process.kill(process.pid, 'SIGKILL');";
        const result = runGate(THREE, { 'a.mjs': '', 'b.mjs': kill, 'c.mjs': MARK });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('step gate#2 failed (exit 1)');
        expect(result.has('c-ran')).toBe(false);
    });

    it('runs an env prefix and a node_modules/.bin tool the way npm does, the step file variable unseen', () => {
        const result = runGate('node a.mjs && FOO=1 node b.mjs && stub-tool --flag', {
            'a.mjs': 'process.exit(process.env.GATE_TRACE_STEP_FILE === undefined ? 0 : 6);',
            'b.mjs': 'process.exit(process.env.FOO === "1" ? 0 : 5);',
            'node_modules/.bin/stub-tool': '#!/bin/sh\n[ "$1" = "--flag" ] && : > tool-ran\n'
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/✓ gate: 3 steps passed in \d+\.\d s/);
        expect(result.has('tool-ran')).toBe(true);
        expect(result.has('step')).toBe(false);
    });
});
