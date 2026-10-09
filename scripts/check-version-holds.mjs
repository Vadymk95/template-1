#!/usr/bin/env node
/**
 * version-holds — a held dependency stays held, and says why.
 *
 * Why it exists: a version hold ("typescript stays below 6.1 until typescript-eslint peers it") used
 * to live as prose in three places (AGENTS.md, DECISIONS.md, a Dependabot comment) and in one piece
 * of machinery that stops only the bot: a Dependabot `ignore` keeps Dependabot from opening the PR,
 * and nothing stops a person or an agent from running `npm install typescript@latest`. This check
 * makes the hold a fact the gate reads: it is in `verify`, so a bump past a hold turns the push red.
 *
 * Data: scripts/version-holds.json, an array like scripts/audit-allowlist.json (`[]` = nothing held):
 *   { "package": "vitest",
 *     "held": ">=4.1.11 <5",            the range the dependency must stay within; it MUST have an
 *                                       upper bound (a hold with no ceiling holds nothing)
 *     "reason": "...",                  why, in one or two sentences
 *     "lift": "...",                    the event that lifts it (an upstream release, a peer range)
 *     "evidence": "<url or file:line>", the PR / issue / measurement; a file:line must exist
 *     "reviewBy": "2026-11-02" }        OPTIONAL, ISO date, only for a hold that protects security;
 *                                       the check fails after that day. One date per item, in this
 *                                       structured file, never in prose.
 *
 * Findings (each printed as `<package>: message`; exit 1 when any exists):
 *   manifest    every range package.json declares for the package (dependencies, devDependencies,
 *               optionalDependencies, peerDependencies, and a string value in `overrides`) admits no
 *               version outside `held`
 *   lockfile    the version package-lock.json resolves at `node_modules/<package>` is inside `held`
 *   dependabot  .github/dependabot.yml has an npm `ignore` for the package (a `dependency-name`, `*`
 *               wildcards allowed) that blocks every version from the ceiling of `held` upward and
 *               none inside it; an ignore with no `versions` blocks everything and counts. An ignore
 *               given only as `update-types` is not read here: spell the hold as `versions`.
 *   absent      the package is in neither package.json nor package-lock.json: a hold on nothing is
 *               dead weight, delete the entry
 *   shape       the entry has all five fields, a readable `held`, a unique package, a valid evidence
 *               and (when present) a valid `reviewBy`; `reviewBy` is not past
 *
 * Ranges: comparators (`<5`, `>=4.1.11`), `^`, `~`, x-ranges (`4.x`), partial versions and `||`.
 * Versions compare by major.minor.patch; a prerelease tag is ignored, so 5.0.0-rc.1 counts as 5.0.0
 * (outside `<5`, the conservative reading). Hyphen ranges and anything else are refused loudly
 * rather than guessed. This file has no dependencies on purpose: it runs before anything is built.
 *
 * Usage: node scripts/check-version-holds.mjs [--root <dir>]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const HOLDS_FILE = 'scripts/version-holds.json';
export const DEPENDABOT_FILE = '.github/dependabot.yml';

const DEPENDENCY_FIELDS = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
];
const REQUIRED_FIELDS = ['package', 'held', 'reason', 'lift', 'evidence'];
const OPTIONAL_FIELDS = ['reviewBy'];

/* ---------------------------------------------------------------- versions and ranges */

/** A version is a [major, minor, patch] triple; an interval is [lo, hi) with null = unbounded. */
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export const parseVersion = (text) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        String(text).trim()
    );
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

export const formatVersion = (version) => {
    const parts = [...version];
    while (parts.length > 1 && parts.at(-1) === 0) parts.pop();
    return parts.join('.');
};

const isEmpty = (interval) =>
    interval.lo !== null && interval.hi !== null && compare(interval.lo, interval.hi) >= 0;

const intersect = (x, y) => ({
    lo: x.lo === null ? y.lo : y.lo === null ? x.lo : compare(x.lo, y.lo) >= 0 ? x.lo : y.lo,
    hi: x.hi === null ? y.hi : y.hi === null ? x.hi : compare(x.hi, y.hi) <= 0 ? x.hi : y.hi
});

const overlaps = (x, y) =>
    (x.hi === null || y.lo === null || compare(y.lo, x.hi) < 0) &&
    (y.hi === null || x.lo === null || compare(x.lo, y.hi) < 0);

const merge = (intervals) => {
    const sorted = intervals
        .filter((interval) => !isEmpty(interval))
        .sort((a, b) =>
            a.lo === null ? (b.lo === null ? 0 : -1) : b.lo === null ? 1 : compare(a.lo, b.lo)
        );
    const merged = [];
    for (const current of sorted) {
        const last = merged.at(-1);
        if (
            last &&
            (last.hi === null || current.lo === null || compare(current.lo, last.hi) <= 0)
        ) {
            last.hi =
                last.hi === null || current.hi === null ? null : maxVersion(last.hi, current.hi);
        } else {
            merged.push({ ...current });
        }
    }
    return merged;
};

const maxVersion = (a, b) => (compare(a, b) >= 0 ? a : b);

const COMPARATOR =
    /^(\^|~|>=|<=|>|<|=)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const numberOf = (part) => (part === undefined || /^[xX*]$/.test(part) ? undefined : Number(part));

/** One comparator token to an interval. Partial versions follow node-semver (`>5` is `>=6.0.0`). */
const tokenInterval = (token, spec) => {
    const match = COMPARATOR.exec(token);
    if (!match) throw new Error(`unsupported range syntax "${token}" in "${spec}"`);
    const op = match[1] ?? '';
    const major = numberOf(match[2]);
    const minor = major === undefined ? undefined : numberOf(match[3]);
    const patch = minor === undefined ? undefined : numberOf(match[4]);
    if (major === undefined) {
        if (op === '<' || op === '>')
            throw new Error(`unsupported range syntax "${token}" in "${spec}"`);
        return { lo: null, hi: null };
    }
    const floor = [major, minor ?? 0, patch ?? 0];
    /** The first version after everything the written precision names (5 -> 6.0.0, 5.1 -> 5.2.0). */
    const after =
        patch !== undefined
            ? [major, minor, patch + 1]
            : minor !== undefined
              ? [major, minor + 1, 0]
              : [major + 1, 0, 0];
    switch (op) {
        case '':
        case '=':
            return { lo: floor, hi: after };
        case '>=':
            return { lo: floor, hi: null };
        case '>':
            return { lo: after, hi: null };
        case '<':
            return { lo: null, hi: floor };
        case '<=':
            return { lo: null, hi: after };
        case '~':
            return {
                lo: floor,
                hi: minor === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0]
            };
        default: {
            // '^': everything up to the next change of the leftmost non-zero part
            let hi;
            if (major > 0) hi = [major + 1, 0, 0];
            else if (minor === undefined) hi = [1, 0, 0];
            else if (minor > 0) hi = [0, minor + 1, 0];
            else if (patch === undefined) hi = [0, 1, 0];
            else hi = [0, 0, patch + 1];
            return { lo: floor, hi };
        }
    }
};

/**
 * Turns a range into merged [lo, hi) intervals. Throws on syntax it does not read, so a hold can
 * never be "satisfied" by a range the check silently misunderstood.
 */
export const parseRange = (spec) => {
    if (typeof spec !== 'string') throw new Error(`range must be a string, got ${typeof spec}`);
    const text = spec.trim().replace(/(<=|>=|<|>|=|\^|~)\s+/g, '$1');
    if (/\s-\s/.test(text)) {
        throw new Error(
            `hyphen range in "${spec}" is not supported; write comparators (">=1.2.3 <2")`
        );
    }
    const intervals = text.split('||').map((part) => {
        let current = { lo: null, hi: null };
        for (const token of part.split(/\s+/).filter(Boolean)) {
            current = intersect(current, tokenInterval(token, spec));
        }
        return current;
    });
    return merge(intervals);
};

export const inRange = (intervals, version) =>
    intervals.some(
        (interval) =>
            (interval.lo === null || compare(interval.lo, version) <= 0) &&
            (interval.hi === null || compare(version, interval.hi) < 0)
    );

/** Every version `inner` admits is admitted by `outer`. */
export const isWithin = (inner, outer) =>
    inner.every((a) =>
        outer.some(
            (b) =>
                (b.lo === null || (a.lo !== null && compare(b.lo, a.lo) <= 0)) &&
                (b.hi === null || (a.hi !== null && compare(a.hi, b.hi) <= 0))
        )
    );

const rangesOverlap = (xs, ys) => xs.some((x) => ys.some((y) => overlaps(x, y)));

/** Some interval runs from at or below `from` to infinity. Intervals are merged, so one is enough. */
const coversFrom = (intervals, from) =>
    intervals.some(
        (interval) =>
            interval.hi === null && (interval.lo === null || compare(interval.lo, from) <= 0)
    );

/** The smallest version no longer inside `held`: the ceiling Dependabot has to refuse from. */
const ceilingOf = (held) => held.reduce((top, interval) => maxVersion(top, interval.hi), [0, 0, 0]);

/* ---------------------------------------------------------------- dependabot.yml */

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Drops a trailing ` # comment`, leaving a `#` inside quotes alone. */
const stripComment = (line) => {
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quote) {
            if (char === quote) quote = null;
        } else if (char === "'" || char === '"') {
            quote = char;
        } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
            return line.slice(0, index);
        }
    }
    return line;
};

const splitFlow = (inner) => {
    const items = [];
    let current = '';
    let quote = null;
    for (const char of inner) {
        if (quote) {
            current += char;
            if (char === quote) quote = null;
        } else if (char === "'" || char === '"') {
            quote = char;
            current += char;
        } else if (char === ',') {
            items.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    items.push(current);
    return items.map(unquote).filter((item) => item !== '');
};

/** The lines under one key, keyed by the key at `keyIndent`; a `- ` line at that indent is a child. */
const mappingOf = (lines, keyIndent) => {
    const map = new Map();
    let key = null;
    for (const line of lines) {
        if (line.indent === keyIndent && !line.text.startsWith('- ')) {
            const match = /^([^:\s][^:]*):(?:\s+(.*))?$/.exec(line.text);
            if (!match) throw new Error(`cannot read "${line.text}"`);
            key = unquote(match[1]);
            map.set(key, { rest: (match[2] ?? '').trim(), children: [] });
        } else if (key !== null) {
            map.get(key).children.push(line);
        }
    }
    return map;
};

const seqOf = ({ rest, children }) => {
    if (rest.startsWith('[')) {
        if (!rest.endsWith(']')) throw new Error('a flow list must sit on one line');
        return splitFlow(rest.slice(1, -1));
    }
    if (rest !== '') return [unquote(rest)];
    return children.map((line) => {
        if (!line.text.startsWith('- '))
            throw new Error(`cannot read "${line.text}" as a list item`);
        return unquote(line.text.slice(2));
    });
};

/** Splits the children of a list key into its `- ` items; the dash is replaced by its indent. */
const itemsOf = (lines) => {
    const items = [];
    if (lines.length === 0) return items;
    const itemIndent = lines[0].indent;
    for (const line of lines) {
        if (line.indent === itemIndent && line.text.startsWith('- ')) {
            const dash = /^-\s+/.exec(line.text)[0].length;
            items.push({
                keyIndent: itemIndent + dash,
                lines: [{ indent: itemIndent + dash, text: line.text.slice(dash) }]
            });
        } else if (items.length > 0) {
            items.at(-1).lines.push(line);
        } else {
            throw new Error(`cannot read "${line.text}" as a list item`);
        }
    }
    return items;
};

/**
 * The npm `ignore` entries of a dependabot.yml, as `{ name, versions, updateTypes }` (null = key
 * absent). Reads the block-mapping subset Dependabot files use; anything else throws.
 */
export const parseDependabotIgnores = (text) => {
    const lines = text
        .split('\n')
        .map((raw) => stripComment(raw).trimEnd())
        .filter((line) => line.trim() !== '')
        .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
    if (lines.length === 0) return [];
    const top = mappingOf(lines, lines[0].indent);
    if (!top.has('updates')) throw new Error('no `updates:` list');
    const ignores = [];
    for (const item of itemsOf(top.get('updates').children)) {
        const entry = mappingOf(item.lines, item.keyIndent);
        if (!entry.has('package-ecosystem')) continue;
        if (unquote(entry.get('package-ecosystem').rest) !== 'npm') continue;
        if (!entry.has('ignore')) continue;
        for (const ignore of itemsOf(entry.get('ignore').children)) {
            const fields = mappingOf(ignore.lines, ignore.keyIndent);
            if (!fields.has('dependency-name'))
                throw new Error('an ignore has no `dependency-name`');
            ignores.push({
                name: unquote(fields.get('dependency-name').rest),
                versions: fields.has('versions') ? seqOf(fields.get('versions')) : null,
                updateTypes: fields.has('update-types') ? seqOf(fields.get('update-types')) : null
            });
        }
    }
    return ignores;
};

const nameMatches = (pattern, name) =>
    pattern === name ||
    (pattern.includes('*') &&
        new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`).test(name));

const escapeRegExp = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/* ---------------------------------------------------------------- the check */

/** A real calendar day in YYYY-MM-DD: 2026-02-30 and 2026-13-01 are refused, not rolled over. */
const isIsoDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const FILE_LINE = /^([^\s:]+):\d+(?:-\d+)?$/;

/** Shape of one entry. Returns the entry's parsed `held` intervals, or null when it is unusable. */
const validateEntry = ({ entry, index, seen, fileExists, findings }) => {
    const label =
        typeof entry?.package === 'string' && entry.package ? entry.package : `[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        findings.push(`${label}: ${HOLDS_FILE} entry must be an object`);
        return null;
    }
    let usable = true;
    const fail = (message) => {
        findings.push(`${label}: ${message}`);
        usable = false;
    };
    for (const field of REQUIRED_FIELDS) {
        if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
            fail(`"${field}" is required and must be a non-empty string`);
        }
    }
    for (const key of Object.keys(entry)) {
        if (![...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].includes(key)) fail(`unknown field "${key}"`);
    }
    if (!usable) return null;
    if (seen.has(entry.package)) fail('listed twice; one entry per package');
    seen.add(entry.package);
    if ('reviewBy' in entry && !isIsoDate(entry.reviewBy)) {
        fail(`reviewBy "${entry.reviewBy}" is not an ISO date (YYYY-MM-DD)`);
    }
    const evidence = entry.evidence.trim();
    if (/^https?:\/\/\S+$/.test(evidence)) {
        // a URL: nothing to verify offline
    } else if (FILE_LINE.test(evidence)) {
        if (!fileExists(FILE_LINE.exec(evidence)[1]))
            fail(`evidence "${evidence}" names a file that does not exist`);
    } else {
        fail(`evidence "${evidence}" must be a URL or file:line`);
    }
    let held = null;
    try {
        held = parseRange(entry.held);
    } catch (error) {
        fail(`held "${entry.held}" is unreadable: ${error.message}`);
    }
    if (held !== null) {
        if (held.length === 0) fail(`held "${entry.held}" admits no version`);
        else if (held.some((interval) => interval.hi === null)) {
            fail(
                `held "${entry.held}" has no upper bound; a hold needs a ceiling (for example "<5")`
            );
        }
    }
    return usable && held !== null && held.length > 0 && held.every((i) => i.hi !== null)
        ? held
        : null;
};

const declaredSpecs = (manifest, pkg) => {
    const specs = [];
    for (const field of DEPENDENCY_FIELDS) {
        const spec = manifest[field]?.[pkg];
        if (typeof spec === 'string') specs.push({ field, spec });
    }
    const override = manifest.overrides?.[pkg];
    if (typeof override === 'string' && !override.startsWith('$')) {
        specs.push({ field: 'overrides', spec: override });
    }
    return specs;
};

const dependabotFindings = ({ pkg, entry, held, ignores }) => {
    const ceiling = ceilingOf(held);
    const hint = `dependency-name: ${pkg}, versions: ['>=${formatVersion(ceiling)}']`;
    const matching = ignores.filter((ignore) => nameMatches(ignore.name, pkg));
    if (matching.length === 0) {
        return [`${pkg}: ${DEPENDABOT_FILE} has no npm ignore for it; add ${hint}`];
    }
    if (matching.some((ignore) => ignore.versions === null && ignore.updateTypes === null)) {
        return [];
    }
    const readable = matching.filter(
        (ignore) => ignore.versions !== null && ignore.updateTypes === null
    );
    if (readable.length === 0) {
        return [
            `${pkg}: its ${DEPENDABOT_FILE} ignore is given as update-types only, which this check does not read; spell the hold as ${hint}`
        ];
    }
    const findings = [];
    const blocked = [];
    for (const ignore of readable) {
        for (const range of ignore.versions) {
            try {
                blocked.push(...parseRange(range));
            } catch (error) {
                findings.push(
                    `${pkg}: ${DEPENDABOT_FILE} ignore range "${range}" is unreadable: ${error.message}`
                );
            }
        }
    }
    if (findings.length > 0) return findings;
    const merged = merge(blocked);
    if (!coversFrom(merged, ceiling)) {
        findings.push(
            `${pkg}: ${DEPENDABOT_FILE} ignore leaves ${formatVersion(ceiling)} and above open, so Dependabot would still propose a bump past "${entry.held}"; use ${hint}`
        );
    }
    if (rangesOverlap(merged, held)) {
        findings.push(
            `${pkg}: ${DEPENDABOT_FILE} ignore also blocks versions inside "${entry.held}", which withholds patches the hold allows; use ${hint}`
        );
    }
    return findings;
};

/**
 * All findings for a holds file against the manifest, the lockfile and the Dependabot config.
 * Pure: the caller does the reading, so a test can hand it any shape.
 */
export const checkHolds = ({
    holds,
    manifest,
    lock,
    dependabotText,
    today,
    fileExists = () => true
}) => {
    const findings = [];
    if (!Array.isArray(holds))
        return [`${HOLDS_FILE}: must be a JSON array (use [] when nothing is held)`];
    if (holds.length === 0) return findings;

    const seen = new Set();
    const valid = [];
    holds.forEach((entry, index) => {
        const held = validateEntry({ entry, index, seen, fileExists, findings });
        if (held !== null) valid.push({ entry, held });
    });

    let ignores = null;
    if (valid.length > 0) {
        if (dependabotText === null) {
            findings.push(`${DEPENDABOT_FILE} does not exist, so no hold has a Dependabot ignore`);
        } else {
            try {
                ignores = parseDependabotIgnores(dependabotText);
            } catch (error) {
                findings.push(`${DEPENDABOT_FILE} cannot be read: ${error.message}`);
            }
        }
    }
    if (valid.length > 0 && !lock?.packages) {
        findings.push(
            'package-lock.json has no `packages` map (lockfileVersion 1?), so no hold can be read from it'
        );
    }

    for (const { entry, held } of valid) {
        const pkg = entry.package;
        const specs = declaredSpecs(manifest, pkg);
        const locked = lock?.packages?.[`node_modules/${pkg}`];
        const inOverrides = Object.hasOwn(manifest.overrides ?? {}, pkg);
        if (specs.length === 0 && !locked && !inOverrides) {
            findings.push(
                `${pkg}: is in neither package.json nor package-lock.json; delete the hold from ${HOLDS_FILE}`
            );
            continue;
        }
        for (const { field, spec } of specs) {
            let declared;
            try {
                declared = parseRange(spec);
            } catch {
                findings.push(
                    `${pkg}: package.json ${field} declares "${spec}", which is not a semver range, so it cannot be shown to stay within "${entry.held}"`
                );
                continue;
            }
            if (!isWithin(declared, held)) {
                findings.push(
                    `${pkg}: package.json ${field} declares "${spec}", which admits versions outside "${entry.held}"`
                );
            }
        }
        if (locked) {
            const version = parseVersion(locked.version ?? '');
            if (version === null) {
                findings.push(
                    `${pkg}: package-lock.json resolves "${locked.version}", which is not a version`
                );
            } else if (!inRange(held, version)) {
                findings.push(
                    `${pkg}: package-lock.json resolves ${locked.version}, outside "${entry.held}"`
                );
            }
        }
        if (ignores !== null) findings.push(...dependabotFindings({ pkg, entry, held, ignores }));
        if (entry.reviewBy !== undefined && isIsoDate(entry.reviewBy) && today > entry.reviewBy) {
            findings.push(
                `${pkg}: reviewBy ${entry.reviewBy} has passed; re-check "${entry.lift}", then lift the hold or move reviewBy forward with new evidence`
            );
        }
    }
    return findings;
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export const run = ({ root, today }) => {
    const holdsPath = path.join(root, HOLDS_FILE);
    if (!existsSync(holdsPath)) {
        return {
            count: 0,
            findings: [`${HOLDS_FILE} does not exist (write [] when nothing is held)`]
        };
    }
    let holds;
    let manifest;
    let lock;
    try {
        holds = readJson(holdsPath);
    } catch (error) {
        return { count: 0, findings: [`${HOLDS_FILE} is not valid JSON: ${error.message}`] };
    }
    try {
        manifest = readJson(path.join(root, 'package.json'));
        lock = readJson(path.join(root, 'package-lock.json'));
    } catch (error) {
        return {
            count: 0,
            findings: [`package.json or package-lock.json cannot be read: ${error.message}`]
        };
    }
    const dependabotPath = path.join(root, DEPENDABOT_FILE);
    const dependabotText = existsSync(dependabotPath) ? readFileSync(dependabotPath, 'utf8') : null;
    const findings = checkHolds({
        holds,
        manifest,
        lock,
        dependabotText,
        today,
        fileExists: (file) => existsSync(path.join(root, file))
    });
    return { count: Array.isArray(holds) ? holds.length : 0, findings };
};

const main = () => {
    const argv = process.argv.slice(2);
    const rootFlag = argv.indexOf('--root');
    const root = rootFlag === -1 ? process.cwd() : path.resolve(argv[rootFlag + 1]);
    const today = new Date().toISOString().slice(0, 10);
    const { count, findings } = run({ root, today });

    console.log('version-holds');
    for (const finding of findings) console.log(`  ✖ ${finding}`);
    if (findings.length === 0) {
        console.log(
            `  ✔ ${String(count)} hold(s): package.json, package-lock.json and ${DEPENDABOT_FILE} agree with ${HOLDS_FILE}`
        );
        process.exit(0);
    }
    console.log(
        `\n✖ version-holds: ${findings.length} finding(s). Undo the bump, or lift the hold in ${HOLDS_FILE} with its evidence — never the check.`
    );
    process.exit(1);
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
