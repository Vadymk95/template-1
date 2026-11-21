// The cases of bench-verify.test.mjs that read this repository's own package.json: the benchmark's
// step list must follow the real gate scripts. The rest of that file lives in gatelaw, where it runs
// over fixture packages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
});

describe('expandSteps', () => {
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
