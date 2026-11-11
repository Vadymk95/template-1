#!/usr/bin/env node
/**
 * Phase-aware push gate: what a push must prove depends on whether a prod boundary exists yet.
 *
 * Phase 0 (scaffold, pre-deploy): `verify:scaffold:push` (its stages: scripts/gate-tiers.json,
 * `checks.verify:scaffold:push.chain`). The stages the full chain has and this one lacks (the ones
 * that need a build) are SKIPPED — before the first deploy there is no production boundary for them
 * to guard, and paying ~30s per push to check a boundary that does not exist is how gates teach
 * people to bypass them. The skip is printed LOUDLY on every push, one line per stage: a silent
 * skip looks exactly like coverage. The list is derived from the two chain definitions
 * (`skippedStages`), never kept by hand, so a stage added to the full chain later is named too.
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

import { isEntryPoint } from './is-entry-point.mjs';

const FULL_TARGET = 'verify:ci';
const SCAFFOLD_TARGET = 'verify:scaffold:push';
const CHAIN_SEPARATOR = ' -> ';
const MAX_DEPTH = 8;

/** A stage of a chain as a tree: a stage that is itself a check with a chain holds that chain's stages. */
const stageTree = (checks, label, depth = 0) => {
    const chain = checks?.[label]?.chain;
    const children =
        typeof chain === 'string' && depth < MAX_DEPTH
            ? chain.split(CHAIN_SEPARATOR).map((stage) => stageTree(checks, stage, depth + 1))
            : [];
    return { label, children };
};

const leavesOf = ({ label, children }) =>
    children.length === 0 ? [label] : children.flatMap(leavesOf);

/**
 * The stages the full chain runs and the scaffold chain does not, from `checks.<name>.chain` in
 * gate-tiers.json (docs:check keeps those equal to package.json). A nested chain the scaffold lacks
 * entirely is named once, by its own name; one it runs in part is opened up. Null when either target
 * has no chain, so the caller says the list could not be derived instead of printing an empty one.
 */
export const skippedStages = ({ checks, full = FULL_TARGET, scaffold = SCAFFOLD_TARGET }) => {
    const fullTree = stageTree(checks, full);
    const scaffoldTree = stageTree(checks, scaffold);
    if (fullTree.children.length === 0 || scaffoldTree.children.length === 0) return null;

    const kept = new Set(leavesOf(scaffoldTree));
    const dropped = ({ label, children }) => {
        if (children.length === 0) return kept.has(label) ? [] : [label];
        if (leavesOf({ label, children }).every((leaf) => !kept.has(leaf))) return [label];
        return children.flatMap(dropped);
    };

    return fullTree.children.flatMap(dropped);
};

export const resolvePushPlan = ({ phase, override, checks }) => {
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
        ? { phase: 0, target: SCAFFOLD_TARGET, skipped: skippedStages({ checks }) }
        : { phase: 1, target: FULL_TARGET, skipped: [] };
};

const readTiers = (cwd) => {
    try {
        return JSON.parse(readFileSync(`${cwd}/scripts/gate-tiers.json`, 'utf8'));
    } catch {
        return undefined;
    }
};

export const readConfiguredPhase = (cwd) => {
    const phase = readTiers(cwd)?.phase;
    return typeof phase === 'number' ? phase : undefined;
};

export const readChecks = (cwd) => readTiers(cwd)?.checks;

const main = () => {
    const plan = resolvePushPlan({
        phase: readConfiguredPhase(process.cwd()),
        override: process.env.GATE_PHASE,
        checks: readChecks(process.cwd())
    });

    if (plan.phase === 0) {
        console.log('── push gate: PHASE 0 (scaffold — no deploy exists yet) ──');
        if (plan.skipped === null) {
            console.log(
                `   Skipped until the first deploy: the list could not be derived from scripts/gate-tiers.json; compare checks.${FULL_TARGET}.chain with checks.${SCAFFOLD_TARGET}.chain.`
            );
        }
        for (const stage of plan.skipped ?? []) {
            console.log(`   - ${stage}: skipped at phase 0 (until the first deploy)`);
        }
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

if (isEntryPoint(import.meta.url)) {
    main();
}
