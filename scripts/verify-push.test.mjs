import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readConfiguredPhase, resolvePushPlan, skippedStages } from './verify-push.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/verify-push.mjs');

/* The dispatcher's child captures its output. `execFileSync` copies the child's stderr onto the test
   run's unless `stdio` is given, so a message the dispatcher prints on purpose would land in every log;
   `runDispatcher` hands the captured text back for the assertions. */
const CAPTURE = ['ignore', 'pipe', 'pipe'];

/* CLI cases run in a throwaway package, never against this repo's own gate: the dispatcher
   spawns whatever `verify:scaffold:push` / `verify:ci` say, and the fixture package defines
   them as one-line exits so the passthrough is provable in seconds. */
const FIXTURE_CHECKS = {
    'verify:ci': { chain: 'audit:gate -> verify' },
    verify: { chain: 'lint -> test -> build -> e2e' },
    build: { chain: 'tsc -b -> vite build' },
    'verify:scaffold:push': { chain: 'audit:gate -> verify:scaffold' },
    'verify:scaffold': { chain: 'lint -> test' }
};

const makeFixturePackage = ({
    phase,
    scaffoldExit = 0,
    ciExit = 0,
    checks = FIXTURE_CHECKS,
    extraScripts = {}
}) => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-push-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
            name: 'verify-push-fixture',
            version: '0.0.0',
            scripts: {
                'verify:scaffold:push': `node -e "process.exit(${String(scaffoldExit)})"`,
                'verify:ci': `node -e "process.exit(${String(ciExit)})"`,
                ...extraScripts
            }
        })
    );
    mkdirSync(join(dir, 'scripts'));
    if (phase !== undefined) {
        writeFileSync(join(dir, 'scripts/gate-tiers.json'), JSON.stringify({ phase, checks }));
    }
    return dir;
};

const runDispatcher = (cwd, env = {}) => {
    try {
        const output = execFileSync('node', [SCRIPT], {
            cwd,
            encoding: 'utf8',
            env: { ...process.env, GATE_PHASE: '', ...env },
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

const cleanupDirs = [];

afterEach(() => {
    while (cleanupDirs.length > 0) {
        const dir = cleanupDirs.pop();
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('resolvePushPlan (pure)', () => {
    it('phase 0 routes to the scaffold chain and names every stage it drops', () => {
        const plan = resolvePushPlan({
            phase: 0,
            override: undefined,
            checks: FIXTURE_CHECKS
        });
        expect(plan.target).toBe('verify:scaffold:push');
        expect(plan.skipped).toEqual(['build', 'e2e']);
    });

    it('phase 1 routes to the full verify:ci chain with nothing skipped', () => {
        expect(resolvePushPlan({ phase: 1, override: undefined })).toEqual({
            phase: 1,
            target: 'verify:ci',
            skipped: []
        });
    });

    it('a MISSING phase resolves to the FULL gate — the dispatcher fails heavy, never silent', () => {
        expect(resolvePushPlan({ phase: undefined, override: undefined }).target).toBe('verify:ci');
    });

    it('GATE_PHASE=full overrides a configured phase 0 (how maintainers push gate machinery)', () => {
        expect(resolvePushPlan({ phase: 0, override: 'full' }).target).toBe('verify:ci');
    });

    it('GATE_PHASE=0 overrides a configured phase 1 for a one-off scaffold run', () => {
        expect(resolvePushPlan({ phase: 1, override: '0' }).target).toBe('verify:scaffold:push');
    });

    it('an unknown GATE_PHASE value throws instead of silently picking a gate', () => {
        expect(() => resolvePushPlan({ phase: 0, override: 'fast' })).toThrow(/not a phase/);
    });
});

describe('readConfiguredPhase', () => {
    it('reads the phase number from scripts/gate-tiers.json under the given cwd', () => {
        const dir = makeFixturePackage({ phase: 0 });
        cleanupDirs.push(dir);
        expect(readConfiguredPhase(dir)).toBe(0);
    });

    it('returns undefined for a missing tiers file (which the plan then treats as FULL)', () => {
        const dir = makeFixturePackage({ phase: undefined });
        cleanupDirs.push(dir);
        expect(readConfiguredPhase(dir)).toBe(undefined);
    });
});

/* Each case boots node → npm → node (the dispatcher spawns the fixture's npm script), so its budget is a
   process-boot budget, not the 5 s unit default: measured ~260 ms per case alone, but under the full
   coverage run with every worker busy an npm boot alone can take seconds, and the 5 s default timed out
   on a clean tree (once in template-1, repeatedly in template-spa-pwa on the pre-pass baseline). The cases
   are not flaky in what they assert; the budget was wrong for what they do. */
describe('verify-push CLI (fixture package)', { timeout: 20_000 }, () => {
    it('phase 0: runs the scaffold chain, prints the skip notice and the flip instruction', () => {
        const dir = makeFixturePackage({ phase: 0 });
        cleanupDirs.push(dir);
        const verdict = runDispatcher(dir);
        expect(verdict.code).toBe(0);
        expect(verdict.output).toContain('PHASE 0');
        expect(verdict.output).toContain('"phase": 1');
        const lines = verdict.output
            .split('\n')
            .filter((line) => line.includes('skipped at phase 0'));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('build');
        expect(lines[1]).toContain('e2e');
    });

    it('phase 0: a stage added to the full chain later is printed without editing any list', () => {
        const checks = {
            ...FIXTURE_CHECKS,
            verify: { chain: 'lint -> test -> build -> e2e -> brand-new-check' }
        };
        const dir = makeFixturePackage({ phase: 0, checks });
        cleanupDirs.push(dir);

        const verdict = runDispatcher(dir);

        expect(verdict.code).toBe(0);
        expect(verdict.output).toMatch(
            /brand-new-check.*skipped at phase 0|skipped at phase 0.*brand-new-check/
        );
    });

    it('phase 0: names the stages of a full chain that is a script alias, read from package.json', () => {
        const checks = {
            ...FIXTURE_CHECKS,
            verify: undefined,
            'verify:enterprise': { chain: 'lint -> test -> build -> e2e' }
        };
        const dir = makeFixturePackage({
            phase: 0,
            checks,
            extraScripts: { verify: 'npm run verify:enterprise' }
        });
        cleanupDirs.push(dir);

        const verdict = runDispatcher(dir);

        expect(verdict.code).toBe(0);
        expect(verdict.output).toMatch(/- build: skipped at phase 0/);
        expect(verdict.output).toMatch(/- e2e: skipped at phase 0/);
        expect(verdict.output).not.toMatch(/- verify: skipped at phase 0/);
    });

    it('phase 0: says so, loudly, when the stage list cannot be derived', () => {
        const dir = makeFixturePackage({ phase: 0, checks: {} });
        cleanupDirs.push(dir);

        const verdict = runDispatcher(dir);

        expect(verdict.code).toBe(0);
        expect(verdict.output).toContain('could not be derived');
    });

    it('phase 0: the scaffold chain’s own failure passes through as the push’s failure', () => {
        const dir = makeFixturePackage({ phase: 0, scaffoldExit: 3 });
        cleanupDirs.push(dir);
        expect(runDispatcher(dir).code).toBe(3);
    });

    it('phase 1: runs verify:ci and prints NO skip notice — nothing is being skipped', () => {
        const dir = makeFixturePackage({ phase: 1, ciExit: 0 });
        cleanupDirs.push(dir);
        const verdict = runDispatcher(dir);
        expect(verdict.code).toBe(0);
        expect(verdict.output).not.toContain('PHASE 0');
    });

    it('phase 1: verify:ci’s failure is the push’s failure', () => {
        const dir = makeFixturePackage({ phase: 1, ciExit: 4 });
        cleanupDirs.push(dir);
        expect(runDispatcher(dir).code).toBe(4);
    });

    it('GATE_PHASE=full on a phase-0 package runs the full chain', () => {
        const dir = makeFixturePackage({ phase: 0, ciExit: 5 });
        cleanupDirs.push(dir);
        expect(runDispatcher(dir, { GATE_PHASE: 'full' }).code).toBe(5);
    });
});

describe('skippedStages (derived from the two chains)', () => {
    const skipped = (checks, scripts) =>
        skippedStages({ checks, scripts, full: 'verify:ci', scaffold: 'verify:scaffold:push' });

    it('lists the stages of the full chain that the scaffold chain lacks, in the full chain’s order', () => {
        expect(skipped(FIXTURE_CHECKS)).toEqual(['build', 'e2e']);
    });

    it('lists a stage of a nested chain by its own name when the scaffold lacks all of it', () => {
        // `build` is a chain itself (tsc -b -> vite build): one line for it, not one per step.
        expect(skipped(FIXTURE_CHECKS)).not.toContain('tsc -b');
    });

    it('descends into a nested chain the scaffold runs only in part', () => {
        const checks = {
            ...FIXTURE_CHECKS,
            test: { chain: 'unit -> slow' },
            verify: { chain: 'lint -> test -> build -> e2e' },
            'verify:scaffold': { chain: 'lint -> unit' }
        };

        expect(skipped(checks)).toEqual(['slow', 'build', 'e2e']);
    });

    it('lists nothing when both chains run the same stages', () => {
        const checks = {
            ...FIXTURE_CHECKS,
            verify: { chain: 'lint -> test' }
        };

        expect(skipped(checks)).toEqual([]);
    });

    it('returns null when a chain is not defined, so the caller can say so', () => {
        expect(skipped({})).toBeNull();
    });

    it('does not loop on a chain that contains itself', () => {
        const checks = { ...FIXTURE_CHECKS, verify: { chain: 'lint -> verify' } };

        expect(() => skipped(checks)).not.toThrow();
    });

    it('follows a stage that is only a script alias to the chain of its target', () => {
        const checks = {
            ...FIXTURE_CHECKS,
            verify: undefined,
            'verify:enterprise': { chain: 'lint -> test -> build -> e2e' }
        };

        expect(skipped(checks, { verify: 'npm run verify:enterprise' })).toEqual(['build', 'e2e']);
        // Without the alias the stage is one opaque name: the list cannot see inside it.
        expect(skipped(checks, {})).toEqual(['verify']);
    });

    it('does not loop on an alias that points at itself', () => {
        const checks = { ...FIXTURE_CHECKS, verify: undefined };

        expect(() => skipped(checks, { verify: 'npm run verify' })).not.toThrow();
    });

    it('in this repository, names every stage verify has and verify:scaffold lacks', () => {
        const { checks } = JSON.parse(readFileSync('scripts/gate-tiers.json', 'utf8'));
        const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
        const stages = (name) => checks[name].chain.split(' -> ');
        const expected = stages('verify').filter(
            (stage) => !stages('verify:scaffold').includes(stage)
        );

        expect(expected.length).toBeGreaterThan(0);
        expect(skipped(checks, scripts)).toEqual(expected);
        expect(resolvePushPlan({ phase: 0, override: undefined, checks, scripts }).skipped).toEqual(
            expected
        );
    });
});
