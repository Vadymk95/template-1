#!/usr/bin/env node
/**
 * node-floor — `engines.node` does not promise a Node that a locked package refuses.
 *
 * Why it exists: `.npmrc` sets `engine-strict=true`, so `npm install` refuses any dependency whose own
 * `engines.node` the running Node does not satisfy. When `package.json` declared `>=24.0.0` while a
 * locked package (jsdom, through its parser) asked for `^24.15.0`, a fork on Node 24.4 read "supported"
 * in the manifest and then failed at install with an error about a package it never chose. The floor
 * is a fact the lockfile already holds; this check makes the manifest say it.
 *
 * What it reads: `package.json` `engines.node`, `.nvmrc`, and every `engines.node` in
 * `package-lock.json` (nested packages included — engine-strict checks all of them). The major is the
 * one the declared range starts in; the floor is the highest, over the locked packages, of the lowest
 * Node of that major the package admits.
 *
 * Findings (each printed as a line; exit 1 when any exists):
 *   floor    `engines.node` admits a Node below the floor, so it names the package that forces it
 *   nvmrc    `.nvmrc` resolves below the floor (`24` means 24.0.0 here: name major.minor at least)
 *   reach    a locked package admits no Node of that major at or above the declared floor
 *   syntax   an `engines.node` this check cannot read (it refuses to guess, like version-holds)
 *
 * Fix a `floor` finding by raising `engines.node` and `.nvmrc` to the floor the message prints, never
 * by loosening the check. A lower floor returns only by a lockfile change that lowers it.
 * Ranges are read by the dependency-free parser of `check-version-holds.mjs`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { inRange, parseRange } from './check-version-holds.mjs';

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const show = (version) => version.join('.');
/** The shortest `.nvmrc` text that resolves to exactly this floor (`24.15` for 24.15.0). */
const nvmrcText = (version) => (version[2] === 0 ? version.slice(0, 2) : version).join('.');

/**
 * The lowest version in `[from, ceiling)` that `intervals` admit, or null when none is. Intervals are
 * [lo, hi) with null for unbounded, as `parseRange` returns them.
 */
export const lowestAtOrAbove = (intervals, from, ceiling) => {
    let lowest = null;
    for (const { lo, hi } of intervals) {
        const start = lo !== null && compare(lo, from) > 0 ? lo : from;
        if (hi !== null && compare(start, hi) >= 0) continue;
        if (compare(start, ceiling) >= 0) continue;
        if (lowest === null || compare(start, lowest) < 0) lowest = start;
    }
    return lowest;
};

/** The lowest Node a `.nvmrc` value names, `24` meaning 24.0.0; null for an alias such as `lts/*`. */
export const nvmrcFloor = (text) => {
    const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text.trim());
    return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
};

const packageName = (key) => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

/**
 * Every finding for one manifest, lockfile and `.nvmrc`. Pure: the caller reads the files.
 * `nvmrc` is the file's text, or null when the repository has none.
 */
export const checkNodeFloor = ({ pkg, lock, nvmrc }) => {
    const spec = pkg?.engines?.node;
    if (typeof spec !== 'string') {
        return ['syntax: package.json has no engines.node, so no Node floor is declared'];
    }
    let declaredRange;
    try {
        declaredRange = parseRange(spec);
    } catch (error) {
        return [`syntax: package.json engines.node "${spec}": ${error.message}`];
    }
    const declared = declaredRange[0]?.lo ?? null;
    if (declared === null) {
        return [
            `syntax: package.json engines.node "${spec}" has no lower bound, so it is no floor`
        ];
    }

    const major = declared[0];
    const ceiling = [major + 1, 0, 0];
    const findings = [];
    let floor = declared;
    let forcedBy = [];
    const admitted = [];

    for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
        const range = entry.engines?.node;
        if (key === '' || typeof range !== 'string') continue;
        const name = packageName(key);
        let intervals;
        try {
            intervals = parseRange(range);
        } catch (error) {
            findings.push(`syntax: ${name} engines.node "${range}": ${error.message}`);
            continue;
        }
        const lowest = lowestAtOrAbove(intervals, declared, ceiling);
        if (lowest === null) {
            findings.push(
                `reach: ${name} engines.node "${range}" admits no Node ${String(major)}.x at or above ${show(declared)}`
            );
            continue;
        }
        admitted.push({ name, range, intervals });
        if (compare(lowest, floor) > 0) {
            floor = lowest;
            forcedBy = [];
        }
        if (compare(lowest, floor) === 0 && compare(floor, declared) > 0) {
            forcedBy.push(`${name} "${range}"`);
        }
    }

    for (const { name, range, intervals } of admitted) {
        if (!inRange(intervals, floor)) {
            findings.push(
                `reach: ${name} engines.node "${range}" does not admit Node ${show(floor)}, the floor the other locked packages need, so no single floor exists`
            );
        }
    }

    if (compare(floor, declared) > 0) {
        const more = forcedBy.length > 1 ? ` (and ${String(forcedBy.length - 1)} more)` : '';
        findings.push(
            `floor: package.json engines.node "${spec}" admits Node ${show(declared)}, but the lockfile needs ${show(floor)} (${forcedBy[0]}${more}); set engines.node to ">=${show(floor)}"`
        );
    }

    if (nvmrc !== null) {
        const pinned = nvmrcFloor(nvmrc);
        if (pinned === null) {
            findings.push(`nvmrc: .nvmrc "${nvmrc.trim()}" is not a version this check reads`);
        } else if (compare(pinned, floor) < 0) {
            findings.push(
                `nvmrc: .nvmrc "${nvmrc.trim()}" resolves below the floor ${show(floor)}; set it to "${nvmrcText(floor)}"`
            );
        }
    }
    return findings;
};

export const run = ({ root }) => {
    const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    const nvmrcFile = path.join(root, '.nvmrc');
    return checkNodeFloor({
        pkg: readJson('package.json'),
        lock: readJson('package-lock.json'),
        nvmrc: existsSync(nvmrcFile) ? readFileSync(nvmrcFile, 'utf8') : null
    });
};

const main = () => {
    const argv = process.argv.slice(2);
    const rootFlag = argv.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : path.resolve(argv[rootFlag + 1]);
    const findings = run({ root });

    console.log('node-floor');
    for (const finding of findings) console.log(`  ✖ ${finding}`);
    if (findings.length === 0) {
        console.log('  ✔ engines.node and .nvmrc are at or above the floor the lockfile needs');
        process.exit(0);
    }
    console.log(
        `\n✖ node-floor: ${String(findings.length)} finding(s). Raise engines.node and .nvmrc to the floor printed above — never the check.`
    );
    process.exit(1);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
