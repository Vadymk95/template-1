#!/usr/bin/env node
/**
 * Phase-aware push gate: what a push must prove depends on whether a prod boundary exists yet.
 *
 * Phase 0 (scaffold, pre-deploy): audit + hooks + format + types + lint + coverage. The build,
 * the e2e suite and the dev smoke are SKIPPED — before the first deploy there is no production
 * boundary for them to guard, and paying ~30s per push to check a boundary that does not exist
 * is how gates teach people to bypass them. The skip is printed LOUDLY on every push: a silent
 * skip looks exactly like coverage.
 *
 * Phase 1 (deployed): the full verify:ci chain, unchanged. Flip `phase` in
 * scripts/gate-tiers.json to 1 in its own commit at the FIRST DEPLOY — that commit is the
 * trigger table's first row (see .cursor/brain/VERIFICATION.md).
 *
 * GATE_PHASE=full|0 overrides per run. Template maintainers push gate machinery with
 * GATE_PHASE=full: changes to the gate itself are exactly what the full chain exists to prove.
 *
 * A missing or unreadable phase resolves to FULL: the dispatcher fails toward the heavier gate,
 * never toward silence.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIPPED_AT_SCAFFOLD = ['build', 'test:e2e:prod', 'smoke:dev'];

export const resolvePushPlan = ({ phase, override }) => {
    let effective;
    if (override !== undefined && override !== '') {
        if (override === '0' || override === 'scaffold') {
            effective = 0;
        } else if (override === '1' || override === 'full') {
            effective = 1;
        } else {
            throw new Error(
                `GATE_PHASE="${override}" is not a phase. Use 0|scaffold or 1|full — an unknown value must not silently pick a gate.`
            );
        }
    } else {
        effective = phase === 0 ? 0 : 1;
    }

    return effective === 0
        ? { phase: 0, target: 'verify:scaffold:push', skipped: SKIPPED_AT_SCAFFOLD }
        : { phase: 1, target: 'verify:ci', skipped: [] };
};

export const readConfiguredPhase = (cwd) => {
    try {
        const tiers = JSON.parse(readFileSync(`${cwd}/scripts/gate-tiers.json`, 'utf8'));
        return typeof tiers.phase === 'number' ? tiers.phase : undefined;
    } catch {
        return undefined;
    }
};

const main = () => {
    const plan = resolvePushPlan({
        phase: readConfiguredPhase(process.cwd()),
        override: process.env.GATE_PHASE
    });

    if (plan.phase === 0) {
        console.log('── push gate: PHASE 0 (scaffold — no deploy exists yet) ──');
        console.log(`   Skipped until the first deploy: ${plan.skipped.join(', ')}.`);
        console.log('   First deploy = the trigger: set "phase": 1 in scripts/gate-tiers.json');
        console.log('   (its own commit). One-off full run: GATE_PHASE=full git push');
    }

    const result = spawnSync('npm', ['run', plan.target], {
        stdio: 'inherit',
        shell: false,
        env: process.env
    });
    // The verdict reads status BEFORE normalisation, so a child killed by a signal cannot pass.
    process.exit(result.status ?? 1);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
