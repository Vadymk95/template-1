#!/usr/bin/env node
/**
 * engines-floor — the Node and npm floors `package.json` declares are floors the lockfile and `.npmrc` can
 * actually run on.
 *
 * Why it exists: `.npmrc` sets `engine-strict=true`, so `npm install` refuses any dependency whose own
 * `engines.node` the running Node does not satisfy. When `package.json` declared `>=24.0.0` while a
 * locked package (jsdom, through its parser) asked for `^24.15.0`, a fork on Node 24.4 read "supported"
 * in the manifest and then failed at install with an error about a package it never chose. The floor
 * is a fact the lockfile already holds; this check makes the manifest say it.
 *
 * What it reads: `package.json` `engines`, `.nvmrc` and `.npmrc` when there are any, and every
 * `engines.node` in `package-lock.json` (nested packages included — engine-strict checks all of them).
 * The major is the one the declared range starts in; the floor is the highest, over the locked
 * packages, of the lowest Node of that major the package admits.
 *
 * Findings (each printed as a line; exit 1 when any exists):
 *   floor    `engines.node` admits a Node below the floor, so it names the packages that force it (three
 *            at most)
 *   nvmrc    `.nvmrc` resolves below the floor (`24` means 24.0.0 here: name major.minor at least)
 *   reach    a locked package admits no Node of that major at or above the declared floor
 *   syntax   an `engines.node` this check cannot read (it refuses to guess, like version-holds), or a
 *            `package.json` or lockfile that cannot be read at all
 *   npm      `.npmrc` sets a key that only newer npm reads (NPM_KEY_FLOORS) and `engines.npm` admits an
 *            older one: an older npm warns "Unknown project config" and carries on without the key, so
 *            an install cooldown would silently not apply. The running npm is never compared here.
 *   lockroot the lockfile's root entry (`packages[""].engines`) differs from `package.json` `engines`:
 *            npm rewrites it on the next install and leaves a dirty lockfile that `npm ci` never shows
 *
 * Not counted towards the floor: the root entry, and a package with `os` or `cpu` that no Node of the
 * major satisfies (on its platform the install fails whatever is declared here: `@img/sharp-win32-ia32`
 * asks for `^20.9.0`, and Node has no 32-bit Windows 24). Optional packages count, the conservative
 * reading, unless `scripts/gate-tiers.json` sets `"engines": { "skipOptional": true }`: npm installs an
 * optional package only where it fits and skips it where it does not, `engine-strict` included.
 *
 * Fix a `floor` finding by raising `engines.node` and `.nvmrc` to the floor the message prints, never
 * by loosening the check. A lower floor returns only by a lockfile change that lowers it.
 * Ranges are read by the dependency-free parser of `check-version-holds.mjs`.
 *
 * Usage: node scripts/check-engines-floor.mjs [--root <dir>]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { inRange, parseRange } from './check-version-holds.mjs';
import { isEntryPoint } from './is-entry-point.mjs';

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const show = (version) => version.join('.');
/** The shortest `.nvmrc` text that resolves to exactly this floor (`24.15` for 24.15.0). */
const nvmrcText = (version) => (version[2] === 0 ? version.slice(0, 2) : version).join('.');
/** The most packages a `floor` finding names; the rest are counted. */
const MAX_NAMED = 3;

/**
 * `.npmrc` keys that only newer npm honours, with the first npm that does (npm CHANGELOG 11.10.0,
 * 2026-02-11: `min-release-age`). Node 24.14.1 is the first Node 24 release bundling an npm that
 * reads it (11.11.0; 24.14.0 bundles 11.9.0).
 */
const NPM_KEY_FLOORS = { 'min-release-age': [11, 10, 0] };

/** The keys `.npmrc` sets on a non-comment line, as `key=value` or `key = value`. */
const npmrcKeys = (text) =>
    text
        .split('\n')
        .map((line) => /^\s*([\w@/.:-]+)\s*=/.exec(line)?.[1])
        .filter((key) => typeof key === 'string' && !key.startsWith('#'));

/** The lowest version a parsed range admits, or null when any of its lines has no lower bound. */
const declaredLow = (intervals) => {
    const bounds = intervals.map((interval) => interval.lo);
    if (bounds.length === 0 || bounds.some((lo) => lo === null)) return null;
    return bounds.reduce((low, lo) => (compare(lo, low) < 0 ? lo : low));
};

/** The finding for `engines.npm` against the npm the `.npmrc` keys need. Quiet without `.npmrc`. */
const checkNpmFloor = ({ pkg, npmrc }) => {
    if (typeof npmrc !== 'string') return [];
    let needed = null;
    let key = null;
    for (const candidate of npmrcKeys(npmrc)) {
        const floor = NPM_KEY_FLOORS[candidate];
        if (floor && (needed === null || compare(floor, needed) > 0)) {
            needed = floor;
            key = candidate;
        }
    }
    if (needed === null) return [];

    const fix = `write engines.npm ">=${show(needed)}"`;
    const spec = pkg.engines?.npm;
    if (typeof spec !== 'string') {
        return [
            `npm: .npmrc sets ${key}, which npm older than ${show(needed)} ignores with only a warning, and package.json has no engines.npm; ${fix}`
        ];
    }
    let low;
    try {
        low = declaredLow(parseRange(spec));
    } catch (error) {
        return [`npm: engines.npm "${spec}" cannot be read: ${error.message}`];
    }
    if (low === null) {
        return [`npm: engines.npm "${spec}" has no lower bound, and .npmrc sets ${key}; ${fix}`];
    }
    if (compare(low, needed) < 0) {
        return [
            `npm: engines.npm "${spec}" admits ${show(low)}, below ${show(needed)} that .npmrc ${key} needs (an older npm ignores the key and the install cooldown does not apply); ${fix}`
        ];
    }
    return [];
};

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
 * Every finding for one manifest, lockfile, `.nvmrc` and `.npmrc`. Pure: the caller reads the files.
 * `nvmrc` and `npmrc` are the files' text, or null when the repository has none. `skipOptional` leaves
 * the optional packages of the lockfile out of the floor.
 */
export const checkEnginesFloor = ({ pkg, lock, nvmrc, npmrc = null, skipOptional = false }) => {
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
        if (skipOptional && entry.optional === true) continue;
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
            // A platform-only package that no Node of the major runs on cannot install there at all.
            const platformOnly = Boolean(entry.os || entry.cpu);
            if (platformOnly && lowestAtOrAbove(intervals, [major, 0, 0], ceiling) === null)
                continue;
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
        const named = forcedBy.slice(0, MAX_NAMED).join(', ');
        const more =
            forcedBy.length > MAX_NAMED ? ` and ${String(forcedBy.length - MAX_NAMED)} more` : '';
        findings.push(
            `floor: package.json engines.node "${spec}" admits Node ${show(declared)}, but the lockfile needs ${show(floor)} (${named}${more}); set engines.node to ">=${show(floor)}"`
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
    findings.push(...checkNpmFloor({ pkg, npmrc }));
    return findings;
};

/** `engines` as key-sorted JSON, so two objects holding the same pairs print and compare alike. */
const enginesText = (engines) => {
    const source = engines ?? {};
    return JSON.stringify(
        Object.fromEntries(
            Object.keys(source)
                .sort()
                .map((key) => [key, source[key]])
        )
    );
};

/**
 * The lockfile's root entry (`packages[""]`) mirrors the `engines` of package.json. When they differ,
 * the first `npm install` rewrites the lockfile and leaves it dirty, while `npm ci` still passes, so
 * nothing else notices. Pure: the caller reads the files.
 */
export const checkLockRootEngines = ({ pkg, lock }) => {
    const root = lock?.packages?.[''];
    if (typeof root !== 'object' || root === null) {
        return [
            'lockroot: package-lock.json has no root entry (packages[""]), so its engines cannot be compared with package.json'
        ];
    }
    const declared = enginesText(pkg?.engines);
    const locked = enginesText(root.engines);
    if (declared === locked) return [];
    return [
        `lockroot: package-lock.json packages[""].engines is ${locked} but package.json engines is ${declared}; npm rewrites the lockfile root on the next install and leaves it dirty. Copy the package.json engines into packages[""]`
    ];
};

/** The text of a file, or null when it is not there. */
const readText = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** `engines.skipOptional` of `scripts/gate-tiers.json`: true only when it is written as `true`. */
const readSkipOptional = (root) => {
    try {
        const tiers = JSON.parse(readFileSync(path.join(root, 'scripts/gate-tiers.json'), 'utf8'));
        return tiers?.engines?.skipOptional === true;
    } catch {
        return false;
    }
};

export const run = ({ root }) => {
    let pkg;
    let lock;
    try {
        pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
        lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    } catch (error) {
        return [`syntax: package.json or package-lock.json cannot be read: ${error.message}`];
    }
    return [
        ...checkEnginesFloor({
            pkg,
            lock,
            nvmrc: readText(path.join(root, '.nvmrc')),
            npmrc: readText(path.join(root, '.npmrc')),
            skipOptional: readSkipOptional(root)
        }),
        ...checkLockRootEngines({ pkg, lock })
    ];
};

export const main = () => {
    const argv = process.argv.slice(2);
    const rootFlag = argv.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : path.resolve(argv[rootFlag + 1]);
    const findings = run({ root });

    console.log('engines-floor');
    for (const finding of findings) console.log(`  ✖ ${finding}`);
    if (findings.length === 0) {
        console.log(
            '  ✔ engines.node and .nvmrc are at or above the floor the lockfile needs, and the lockfile root matches'
        );
        process.exit(0);
    }
    console.log(
        `\n✖ engines-floor: ${String(findings.length)} finding(s). Raise engines.node, engines.npm and .nvmrc to the floor printed above — never the check.`
    );
    process.exit(1);
};

if (isEntryPoint(import.meta.url)) {
    main();
}
