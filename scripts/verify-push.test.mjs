import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readConfiguredPhase, resolvePushPlan } from './verify-push.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/verify-push.mjs');

/* CLI cases run in a throwaway package, never against this repo's own gate: the dispatcher
   spawns whatever `verify:scaffold:push` / `verify:ci` say, and the fixture package defines
   them as one-line exits so the passthrough is provable in seconds. */
const makeFixturePackage = ({ phase, scaffoldExit = 0, ciExit = 0 }) => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-push-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
            name: 'verify-push-fixture',
            version: '0.0.0',
            scripts: {
                'verify:scaffold:push': `node -e "process.exit(${String(scaffoldExit)})"`,
                'verify:ci': `node -e "process.exit(${String(ciExit)})"`
            }
        })
    );
    mkdirSync(join(dir, 'scripts'));
    if (phase !== undefined) {
        writeFileSync(join(dir, 'scripts/gate-tiers.json'), JSON.stringify({ phase }));
    }
    return dir;
};

const runDispatcher = (cwd, env = {}) => {
    try {
        const output = execFileSync('node', [SCRIPT], {
            cwd,
            encoding: 'utf8',
            env: { ...process.env, GATE_PHASE: '', ...env }
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
    it('phase 0 routes to the scaffold chain and names every skipped stage', () => {
        const plan = resolvePushPlan({ phase: 0, override: undefined });
        expect(plan.target).toBe('verify:scaffold:push');
        expect(plan.skipped).toEqual(['build', 'test:e2e:prod', 'smoke:dev']);
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

describe('verify-push CLI (fixture package)', () => {
    it('phase 0: runs the scaffold chain, prints the skip notice and the flip instruction', () => {
        const dir = makeFixturePackage({ phase: 0 });
        cleanupDirs.push(dir);
        const verdict = runDispatcher(dir);
        expect(verdict.code).toBe(0);
        expect(verdict.output).toContain('PHASE 0');
        expect(verdict.output).toContain('build, test:e2e:prod, smoke:dev');
        expect(verdict.output).toContain('"phase": 1');
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
