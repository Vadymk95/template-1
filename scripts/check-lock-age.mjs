#!/usr/bin/env node
/**
 * lock-age — a lockfile never resolves a version younger than the repo's own cooldown.
 *
 * Why it exists: `.npmrc` sets `min-release-age=3` (days) so a fresh install never takes a version
 * younger than that, and the documented escape hatch for an urgent patch is a one-off
 * `npm install <pkg> --min-release-age=0`. That bump lands in package-lock.json, and for the next
 * three days every `npm install <anything>` in a fresh clone or fork fails ERESOLVE: npm re-resolves
 * the tree, refuses the too-young locked version, and no peer range can be met. Nothing in the gate
 * saw it: `npm ci` ignores the cooldown, so the bump was green everywhere except in the next clone.
 *
 * What it checks: every `name@version` the lockfile ADDS or CHANGES against its base. The publish
 * time comes from the registry packument (`https://registry.npmjs.org/<name>` -> `time[version]`);
 * the version fails when it is younger than `min-release-age` days. Versions the base already held
 * are not re-checked (they were the previous gate's business), and an unchanged lockfile makes no
 * network call at all.
 *
 * Base: the merge-base of HEAD with `origin/master` (or `origin/main`) on a developer machine, so a
 * push is judged on everything it adds; `HEAD~1` when `CI` is set (the PR merge commit's first
 * parent is the base tip, which needs `fetch-depth: 2` on the checkout); `--base <ref>` overrides.
 * The working-tree lockfile is compared, so an uncommitted bump is caught too. No base commit at all
 * (the first commit of a repo) means nothing to compare and passes with a note; a shallow clone
 * that hides the parent FAILS and names the fix, because passing there would be a silent skip.
 *
 * Allowance: scripts/lock-age-allowlist.json, an array like scripts/audit-allowlist.json (`[]` =
 * nothing allowed). One entry per deliberate young version, one date per entry:
 *   { "package": "next", "version": "16.4.0",
 *     "reason": "...",           why the cooldown was skipped, in one or two sentences
 *     "expires": "2026-10-20" }  ISO date; the allowance holds until the start of that day (UTC),
 *                                after which a still-young entry fails again. Set it no later than
 *                                the day the version turns old enough on its own.
 * A live allowance is printed only while its version is in the lockfile diff. An unchanged
 * lockfile prints no allowance and does not validate the entries (a missing or unparseable file
 * still fails every run), so once the bump has merged, a fork finds the date by reading
 * scripts/lock-age-allowlist.json itself.
 *
 * Fail-closed: a registry that cannot be reached, answers an error status, or has no publish time
 * for the version FAILS the check (after two retries on a network error, 5xx or 429); a check that
 * passes on a lookup it could not make proves nothing. This file has no dependencies on purpose.
 *
 * Network: it belongs in the push/CI chain next to `audit:gate`, never in the offline unit tests;
 * its own tests inject a fake registry. `LOCK_AGE_REGISTRY` is a test seam for the registry origin.
 *
 * Usage: node scripts/check-lock-age.mjs [--root <dir>] [--base <ref>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCKFILE = 'package-lock.json';
export const NPMRC_FILE = '.npmrc';
export const ALLOWANCE_FILE = 'scripts/lock-age-allowlist.json';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
// Only entries resolved from the public registry have a publish time to look up here.
const REGISTRY_PREFIX = 'https://registry.npmjs.org/';
const BASE_CANDIDATES = ['origin/master', 'origin/main'];
const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------------ .npmrc */

/** The `min-release-age` value in days; null when the key is absent, NaN when it is not a number. */
export const parseMinReleaseAge = (text) => {
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        const match = /^min-release-age\s*=\s*(.*)$/.exec(line);
        if (match) {
            const value = match[1].trim();
            return value === '' ? Number.NaN : Number(value);
        }
    }
    return null;
};

/* ------------------------------------------------------------------------ lockfile */

const nameFromKey = (key) => {
    const marker = 'node_modules/';
    const index = key.lastIndexOf(marker);
    return index === -1 ? null : key.slice(index + marker.length);
};

/** name@version -> { name, version } for every locked entry that came from the public registry. */
export const lockedVersions = (lock) => {
    const versions = new Map();
    for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
        if (key === '' || entry.link) continue;
        if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(REGISTRY_PREFIX)) {
            continue;
        }
        if (typeof entry.version !== 'string') continue;
        // An `npm:` alias is keyed by its alias; the registry knows it by its real name.
        const name = entry.name ?? nameFromKey(key);
        if (!name) continue;
        versions.set(`${name}@${entry.version}`, { name, version: entry.version });
    }
    return versions;
};

/** The versions `current` holds that `base` did not: added packages and bumped ones. */
export const changedVersions = (current, base) => {
    const before = base ? lockedVersions(base) : new Map();
    return [...lockedVersions(current)]
        .filter(([key]) => !before.has(key))
        .map(([, value]) => value)
        .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
};

/* ------------------------------------------------------------------------ allowances */

export const isExpired = (expires, now) => {
    const expiry = new Date(`${expires}T00:00:00.000Z`);
    return Number.isNaN(expiry.valueOf()) || expiry < now;
};

const isText = (value) => typeof value === 'string' && value.trim() !== '';

export const validateAllowances = (entries) => {
    if (!Array.isArray(entries)) {
        return {
            allowances: [],
            problems: [`${ALLOWANCE_FILE} must be a JSON array (write [] when nothing is allowed)`]
        };
    }
    const allowances = [];
    const problems = [];
    entries.forEach((entry, index) => {
        const label = `allowance ${String(index + 1)} (${String(entry?.package)}@${String(entry?.version)})`;
        const missing = ['package', 'version', 'reason'].filter((field) => !isText(entry?.[field]));
        if (missing.length > 0) {
            problems.push(`${label}: missing ${missing.join(', ')}`);
        } else if (
            !ISO_DATE.test(entry.expires ?? '') ||
            Number.isNaN(new Date(`${entry.expires}T00:00:00.000Z`).valueOf())
        ) {
            problems.push(`${label}: "expires" must be an ISO date (YYYY-MM-DD)`);
        } else {
            allowances.push(entry);
        }
    });
    return { allowances, problems };
};

/* ------------------------------------------------------------------------ registry */

const defaultFetch = (url) =>
    fetch(url, {
        // The abbreviated packument has no `time` map; only the full document does.
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

const defaultSleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const describeError = (error) => {
    const cause = error?.cause?.code ?? error?.cause?.message;
    return `${error?.message ?? String(error)}${cause ? ` (${String(cause)})` : ''}`;
};

/** name -> { time } or { error }; a transient failure is retried, a 4xx other than 429 is not. */
const createLookup = ({ fetchImpl, registry, retries, sleep }) => {
    const origin = registry.replace(/\/$/, '');
    return async (name) => {
        const url = `${origin}/${name.replaceAll('/', '%2F')}`;
        let lastError = 'no attempt was made';
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
            try {
                const response = await fetchImpl(url);
                if (response.ok) {
                    const body = await response.json();
                    return body?.time && typeof body.time === 'object'
                        ? { time: body.time }
                        : { error: 'the response has no `time` map' };
                }
                lastError = `HTTP ${String(response.status)}`;
                if (response.status < 500 && response.status !== 429) return { error: lastError };
            } catch (error) {
                lastError = describeError(error);
            }
        }
        return { error: lastError };
    };
};

const mapLimit = async (items, limit, worker) => {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length > 0) {
            await worker(queue.shift());
        }
    });
    await Promise.all(runners);
};

/* ------------------------------------------------------------------------ the rule */

/**
 * Looks up every changed version and applies the cooldown. Returns the findings (each makes the
 * check fail), the notes (a live allowance in use) and how many versions it examined.
 */
export const checkLockAge = async ({
    changed,
    minDays,
    allowances,
    now,
    fetchImpl = defaultFetch,
    registry = DEFAULT_REGISTRY,
    concurrency = 8,
    retries = 2,
    sleep = defaultSleep
}) => {
    const { allowances: valid, problems } = validateAllowances(allowances);
    const findings = [...problems];
    const notes = [];
    // What kind of failure this is decides the closing advice: undoing or allowing a bump fixes a
    // version that is too young, and fixes nothing when the age could not be looked up at all.
    let tooYoung = false;
    let unchecked = problems.length > 0;

    const lookup = createLookup({ fetchImpl, registry, retries, sleep });
    const docs = new Map();
    await mapLimit([...new Set(changed.map(({ name }) => name))], concurrency, async (name) => {
        docs.set(name, await lookup(name));
    });

    const reportedLookups = new Set();
    for (const { name, version } of changed) {
        const id = `${name}@${version}`;
        const doc = docs.get(name);
        if (doc.error) {
            unchecked = true;
            if (!reportedLookups.has(name)) {
                reportedLookups.add(name);
                findings.push(
                    `registry lookup failed for ${name}: ${doc.error}; its age cannot be proven, so the check fails closed`
                );
            }
            continue;
        }
        const published = Date.parse(doc.time[version]);
        if (Number.isNaN(published)) {
            unchecked = true;
            findings.push(
                `${id}: the registry has no publish time for ${id} (unpublished, or not on npmjs.org); its age cannot be proven, so the check fails closed`
            );
            continue;
        }
        if (now.valueOf() - published >= minDays * DAY_MS) continue;

        const publishedAt = new Date(published).toISOString();
        const young = `${id} was published ${publishedAt} (${((now.valueOf() - published) / DAY_MS).toFixed(1)} days ago), inside the ${String(minDays)}-day cooldown of .npmrc min-release-age`;
        const allowance = valid.find(
            (entry) => entry.package === name && entry.version === version
        );
        // Only a version that fails here is "too young": one covered by a live allowance is a
        // note, and must not make the closing advice tell the reader to undo it.
        if (!allowance) {
            tooYoung = true;
            findings.push(
                `${young}; it turns eligible ${new Date(published + minDays * DAY_MS).toISOString()}. Pick an older version, wait, or list it in ${ALLOWANCE_FILE} with a reason and an expiry`
            );
        } else if (isExpired(allowance.expires, now)) {
            tooYoung = true;
            findings.push(
                `${young}; its allowance expired ${allowance.expires}. Move to an older version, or renew the allowance with a new reason and date`
            );
        } else {
            notes.push(
                `allowed ${id} until ${allowance.expires}: ${allowance.reason} (published ${publishedAt})`
            );
        }
    }
    return { findings, notes, checked: changed.length, tooYoung, unchecked };
};

/**
 * The closing lines of a failed run. A version that is too young is cured by undoing the bump or
 * allowing it; a lookup or config failure is not, so it gets its own message instead of advice
 * that cannot help.
 */
export const failureSummary = ({ tooYoung, unchecked }) => {
    const lines = [];
    if (tooYoung) {
        lines.push(
            `✖ lock-age: the lockfile resolves a version younger than the cooldown. Undo the bump, or allow it in ${ALLOWANCE_FILE} with a reason and an expiry — never the check.`
        );
    }
    if (unchecked) {
        lines.push(
            '✖ lock-age: the age of a changed version could not be judged (a registry, .npmrc, allowlist or lockfile problem above). An allowance does not fix that: repair what the lines above name, then run again.'
        );
    }
    return lines;
};

/* ------------------------------------------------------------------------ the base */

const isCi = (env) => env.CI === 'true' || env.GITHUB_ACTIONS === 'true';

/**
 * Picks the commit to compare with and reads its lockfile. `git(args)` returns stdout, or null
 * when the command fails. Result: { ref, lockText } (lockText null when the base has no lockfile),
 * { root: true } when there is no base commit, or { error }.
 */
export const loadBase = ({ git, env, baseRef }) => {
    const exists = (ref) => git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;

    let ref = null;
    if (baseRef) {
        if (!exists(baseRef))
            return { error: `--base ${baseRef} is not a commit in this repository` };
        ref = baseRef;
    } else if (isCi(env)) {
        ref = exists('HEAD~1') ? 'HEAD~1' : null;
    } else {
        for (const candidate of BASE_CANDIDATES) {
            const mergeBase = git(['merge-base', 'HEAD', candidate]);
            if (mergeBase && exists(mergeBase)) {
                ref = mergeBase;
                break;
            }
        }
        if (!ref && exists('HEAD~1')) ref = 'HEAD~1';
    }

    if (!ref) {
        if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
            return {
                error: 'shallow clone with no parent commit to compare with: check out with `fetch-depth: 2` (actions/checkout) or run `git fetch --deepen=1`'
            };
        }
        return { ref: null, lockText: null, root: true };
    }
    if (git(['cat-file', '-e', `${ref}:${LOCKFILE}`]) === null) return { ref, lockText: null };
    const lockText = git(['show', `${ref}:${LOCKFILE}`]);
    return lockText === null ? { error: `cannot read ${LOCKFILE} at ${ref}` } : { ref, lockText };
};

// A hook chain can export these, and a child git that inherits them answers for the repository
// they name instead of the one at `cwd`. GIT_INDEX_FILE stays: it is not a location.
const GIT_LOCATION_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'];

const gitEnvironment = (environment) =>
    Object.fromEntries(
        Object.entries(environment).filter(([key]) => !GIT_LOCATION_VARIABLES.includes(key))
    );

const makeGit = (root) => (args) => {
    try {
        return execFileSync('git', args, {
            cwd: root,
            env: gitEnvironment(process.env),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 256 * 1024 * 1024
        }).trim();
    } catch {
        return null;
    }
};

/* ------------------------------------------------------------------------ run */

const readJsonFile = (file, label) => {
    if (!existsSync(file)) return { error: `${label} does not exist` };
    try {
        return { value: JSON.parse(readFileSync(file, 'utf8')) };
    } catch (error) {
        return { error: `${label} is not valid JSON: ${error.message}` };
    }
};

const parseLock = (text, label) => {
    try {
        const lock = JSON.parse(text);
        return lock?.packages && typeof lock.packages === 'object'
            ? { lock }
            : {
                  error: `${label} has no "packages" map (lockfileVersion ${String(lock?.lockfileVersion)}); regenerate it with npm 7 or newer`
              };
    } catch (error) {
        return { error: `${label} is not valid JSON: ${error.message}` };
    }
};

/**
 * The whole check without process exit. Returns { ok, lines }; `readBase` is injectable so the
 * unit tests need no git, and `fetchImpl` so they need no network.
 */
export const run = async ({
    root,
    now = new Date(),
    env = process.env,
    baseRef,
    readBase = () => loadBase({ git: makeGit(root), env, baseRef }),
    ...options
}) => {
    const lines = [];
    const fail = (message) => {
        lines.push(`  ✖ ${message}`);
        return { ok: false, lines, tooYoung: false, unchecked: true };
    };

    const npmrcPath = path.join(root, NPMRC_FILE);
    if (!existsSync(npmrcPath))
        return fail(`${NPMRC_FILE} does not exist, so there is no cooldown to enforce`);
    const minDays = parseMinReleaseAge(readFileSync(npmrcPath, 'utf8'));
    if (minDays === null) {
        return fail(
            `${NPMRC_FILE} sets no min-release-age, so there is no cooldown to enforce; set it, or remove the lock:age check together with the policy`
        );
    }
    if (!Number.isFinite(minDays) || minDays < 0) {
        return fail(`${NPMRC_FILE} min-release-age must be a number of days, 0 or more`);
    }

    const allowanceFile = readJsonFile(path.join(root, ALLOWANCE_FILE), ALLOWANCE_FILE);
    if (allowanceFile.error) {
        return fail(`${allowanceFile.error} (write [] when nothing is allowed)`);
    }

    const lockPath = path.join(root, LOCKFILE);
    if (!existsSync(lockPath)) return fail(`${LOCKFILE} does not exist`);
    const current = parseLock(readFileSync(lockPath, 'utf8'), LOCKFILE);
    if (current.error) return fail(current.error);

    const base = readBase();
    if (base.error) return fail(base.error);
    if (base.root) {
        lines.push('  ✔ no base commit to compare with (the first commit): nothing to check');
        return { ok: true, lines };
    }
    let baseLock = null;
    if (base.lockText !== null) {
        const parsed = parseLock(base.lockText, `${LOCKFILE} at ${base.ref}`);
        if (parsed.error) return fail(parsed.error);
        baseLock = parsed.lock;
    }

    const changed = changedVersions(current.lock, baseLock);
    if (minDays === 0) {
        lines.push('  ✔ min-release-age is 0: no cooldown to enforce');
        return { ok: true, lines };
    }
    if (changed.length === 0) {
        lines.push(`  ✔ ${LOCKFILE} adds or changes no version since ${base.ref}`);
        return { ok: true, lines };
    }

    const result = await checkLockAge({
        changed,
        minDays,
        allowances: allowanceFile.value,
        now,
        ...options
    });
    for (const note of result.notes) lines.push(`  ! ${note}`);
    for (const finding of result.findings) lines.push(`  ✖ ${finding}`);
    if (result.findings.length > 0) {
        return { ok: false, lines, tooYoung: result.tooYoung, unchecked: result.unchecked };
    }
    lines.push(
        `  ✔ ${String(result.checked)} version(s) added or changed since ${base.ref} are at least ${String(minDays)} day(s) old or allowed`
    );
    return { ok: true, lines };
};

const flagValue = (argv, name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
};

const main = async () => {
    const argv = process.argv.slice(2);
    for (const name of ['--root', '--base']) {
        if (argv.includes(name) && !flagValue(argv, name)) {
            console.error(`${name} needs a value`);
            process.exitCode = 1;
            return;
        }
    }
    const rootFlag = flagValue(argv, '--root');
    const { ok, lines, tooYoung, unchecked } = await run({
        root: rootFlag ? path.resolve(rootFlag) : process.cwd(),
        baseRef: flagValue(argv, '--base'),
        registry: process.env.LOCK_AGE_REGISTRY ?? DEFAULT_REGISTRY
    });

    console.log('lock-age');
    for (const line of lines) console.log(line);
    if (!ok) console.log(`\n${failureSummary({ tooYoung, unchecked }).join('\n')}`);
    process.exitCode = ok ? 0 : 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`lock-age: ${describeError(error)}`);
        process.exitCode = 1;
    });
}
