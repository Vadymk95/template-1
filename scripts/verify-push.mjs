#!/usr/bin/env node
/**
 * Phase-aware push gate: what a push must prove depends on whether a prod boundary exists yet.
 *
 * Phase 0 (scaffold, pre-deploy): `verify:scaffold:push` (its stages: scripts/gate-tiers.json,
 * `checks.verify:scaffold:push.chain`). The stages the full chain has and this one lacks (the ones
 * that need a build, and the preflight and browser install that serve them) are SKIPPED (the dev
 * smoke is never inside verify:ci — it is CI's dev-smoke job — so no phase skips it) — before the
 * first deploy there is no production boundary for them to guard, and paying ~30s per push to check
 * a boundary that does not exist is how gates teach people to bypass them. The skip is printed
 * LOUDLY on every push, one line per stage: a silent skip looks exactly like coverage. The list is
 * derived from the two chain definitions (`skippedStages`), never kept by hand, so a stage added to
 * the full chain later is named too.
 *
 * Phase 1 (deployed): the full verify:ci chain, unchanged. Flip `phase` in
 * scripts/gate-tiers.json to 1 in its own commit at the FIRST DEPLOY — that commit is the
 * trigger table's first row (see .cursor/brain/VERIFICATION.md).
 *
 * GATE_PHASE=full|0 overrides per run. Template maintainers push gate machinery with
 * GATE_PHASE=full: changes to the gate itself are exactly what the full chain exists to prove. It
 * runs every stage and nothing more: Prettier still reads `.prettiercache`. `describeOverride` prints
 * that on every full override.
 *
 * A missing or unreadable phase resolves to FULL: the dispatcher fails toward the heavier gate,
 * never toward silence.
 *
 * The push is never shortened by what the diff touched: every test of the repository runs.
 * The target's steps run through scripts/bench-verify.mjs
 * (`runScript`): the same leaf commands `npm run <target>` ran, stopping at the first red with one
 * verdict line that names the step.
 */
import { readFileSync } from 'node:fs';

import { runScript } from './bench-verify.mjs';
import { isEntryPoint } from './is-entry-point.mjs';

const FULL_TARGET = 'verify:ci';
const SCAFFOLD_TARGET = 'verify:scaffold:push';
const CHAIN_SEPARATOR = ' -> ';
const MAX_DEPTH = 8;
const NPM_ALIAS = /^npm run ([\w:-]+)$/;

/**
 * The chain of a stage: its own entry in gate-tiers.json, else (a script that only runs another one,
 * such as `verify` for `verify:enterprise`, has no chain of its own) the chain of the script it runs.
 */
const chainOf = ({ checks, scripts, label }) => {
    const own = checks?.[label]?.chain;
    if (typeof own === 'string') return own;
    const target = NPM_ALIAS.exec(scripts?.[label] ?? '')?.[1];
    const aliased = target === undefined ? undefined : checks?.[target]?.chain;
    return typeof aliased === 'string' ? aliased : undefined;
};

/** A stage of a chain as a tree: a stage that is itself a check with a chain holds that chain's stages. */
const stageTree = ({ checks, scripts, label }, depth = 0) => {
    const chain = chainOf({ checks, scripts, label });
    const children =
        typeof chain === 'string' && depth < MAX_DEPTH
            ? chain
                  .split(CHAIN_SEPARATOR)
                  .map((stage) => stageTree({ checks, scripts, label: stage }, depth + 1))
            : [];
    return { label, children };
};

const leavesOf = ({ label, children }) =>
    children.length === 0 ? [label] : children.flatMap(leavesOf);

/**
 * The stages the full chain runs and the scaffold chain does not, from `checks.<name>.chain` in
 * gate-tiers.json (docs:check keeps those equal to package.json) and, for a stage that is only an
 * alias of another script, `scripts` from package.json. A nested chain the scaffold lacks entirely
 * is named once, by its own name; one it runs in part is opened up. Null when either target has no
 * chain, so the caller says the list could not be derived instead of printing an empty one.
 */
export const skippedStages = ({
    checks,
    scripts,
    full = FULL_TARGET,
    scaffold = SCAFFOLD_TARGET
}) => {
    const fullTree = stageTree({ checks, scripts, label: full });
    const scaffoldTree = stageTree({ checks, scripts, label: scaffold });
    if (fullTree.children.length === 0 || scaffoldTree.children.length === 0) return null;

    const kept = new Set(leavesOf(scaffoldTree));
    const dropped = ({ label, children }) => {
        if (children.length === 0) return kept.has(label) ? [] : [label];
        if (leavesOf({ label, children }).every((leaf) => !kept.has(leaf))) return [label];
        return children.flatMap(dropped);
    };

    return fullTree.children.flatMap(dropped);
};

export const resolvePushPlan = ({ phase, override, checks, scripts }) => {
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
        ? { phase: 0, target: SCAFFOLD_TARGET, skipped: skippedStages({ checks, scripts }) }
        : { phase: 1, target: FULL_TARGET, skipped: [] };
};

const readJson = (file) => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
};

const readTiers = (cwd) => readJson(`${cwd}/scripts/gate-tiers.json`);

export const readConfiguredPhase = (cwd) => {
    const phase = readTiers(cwd)?.phase;
    return typeof phase === 'number' ? phase : undefined;
};

export const readChecks = (cwd) => readTiers(cwd)?.checks;

export const readScripts = (cwd) => readJson(`${cwd}/package.json`)?.scripts;

/** The two lines phase 0 ends with: the trigger and the one-off run. */
export const PHASE_0_FOOTER = [
    '   First deploy = the trigger: set "phase": 1 in scripts/gate-tiers.json',
    '   (its own commit). One-off run of every stage (the Prettier cache still applies): GATE_PHASE=full git push'
];

/**
 * The one line every full GATE_PHASE (`full` or `1`) prints, so the override is not read as a clean
 * run: every stage runs, the Prettier cache still applies, and the run that skips nothing is named. Undefined
 * when no full override is set.
 */
export const describeOverride = (override) =>
    override === 'full' || override === '1'
        ? `── push gate: GATE_PHASE=${override} runs every stage; Prettier still reads .prettiercache; the run that skips nothing: rm -f .prettiercache && GATE_PHASE=full git push (CI starts without it) ──`
        : undefined;

const main = () => {
    const plan = resolvePushPlan({
        phase: readConfiguredPhase(process.cwd()),
        override: process.env.GATE_PHASE,
        checks: readChecks(process.cwd()),
        scripts: readScripts(process.cwd())
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
        for (const line of PHASE_0_FOOTER) console.log(line);
    }

    const overrideLine = describeOverride(process.env.GATE_PHASE);
    if (overrideLine !== undefined) console.log(overrideLine);

    // The target's steps run through the step runner, one at a time: a red push names the step that failed.
    process.exitCode = runScript(readScripts(process.cwd()), plan.target);
};

if (isEntryPoint(import.meta.url)) {
    main();
}
