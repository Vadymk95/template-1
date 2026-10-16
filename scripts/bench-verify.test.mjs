import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseVerifySteps, resolveScript } from './bench-verify.mjs';

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
