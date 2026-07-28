import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const GHSA_PATTERN = /GHSA-[\w-]+/i;

const severityRank = (severity) => (severity === 'critical' ? 2 : 1);

const readGhsaId = (url) => {
    const match = typeof url === 'string' ? url.match(GHSA_PATTERN) : null;
    return match?.[0] ?? null;
};

const normalizeId = (id) => id.toUpperCase();

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidAuditPayload = (audit) =>
    isRecord(audit) &&
    !Object.hasOwn(audit, 'error') &&
    isRecord(audit.metadata) &&
    isRecord(audit.metadata.vulnerabilities) &&
    isRecord(audit.vulnerabilities);

const resolveRootAdvisories = (audit, packageName, seen = new Set()) => {
    if (seen.has(packageName)) {
        return [];
    }

    const vulnerability = audit.vulnerabilities?.[packageName];
    if (!isRecord(vulnerability) || !Array.isArray(vulnerability.via)) {
        return [];
    }

    const nextSeen = new Set(seen);
    nextSeen.add(packageName);
    const roots = new Map();

    for (const entry of vulnerability.via) {
        if (typeof entry === 'string') {
            for (const root of resolveRootAdvisories(audit, entry, nextSeen)) {
                roots.set(normalizeId(root.id), root);
            }
            continue;
        }

        if (!isRecord(entry)) {
            continue;
        }

        const id = readGhsaId(entry.url);
        if (id) {
            roots.set(normalizeId(id), { id, packageName });
        }
    }

    return [...roots.values()];
};

const collectAdvisories = (audit) => {
    const advisories = new Map();

    for (const [packageName, vulnerability] of Object.entries(audit.vulnerabilities ?? {})) {
        if (!isRecord(vulnerability)) {
            continue;
        }

        const vulnerabilitySeverity = vulnerability.severity;
        const ghsaEntries = resolveRootAdvisories(audit, packageName).map((root) => ({
            ...root,
            severity: vulnerabilitySeverity
        }));

        if (ghsaEntries.length === 0 && BLOCKING_SEVERITIES.has(vulnerabilitySeverity)) {
            ghsaEntries.push({
                id: `npm:${packageName}`,
                severity: vulnerabilitySeverity,
                packageName
            });
        }

        for (const advisory of ghsaEntries) {
            const existing = advisories.get(advisory.id);
            if (!existing || severityRank(advisory.severity) > severityRank(existing.severity)) {
                advisories.set(advisory.id, advisory);
            }
        }
    }

    return [...advisories.values()];
};

const isExpired = (expires, now) => {
    const expiry = new Date(`${expires}T00:00:00.000Z`);
    return Number.isNaN(expiry.valueOf()) || expiry < now;
};

/**
 * Evaluates npm's audit JSON without performing I/O, so its fail-closed policy
 * is independently testable.
 */
export const evaluateAudit = (audit, allowlist, now) => {
    if (!isValidAuditPayload(audit)) {
        return {
            ok: false,
            auditFailed: true,
            unexpected: [],
            expired: [],
            stale: [],
            allowlisted: []
        };
    }

    const advisories = collectAdvisories(audit);
    const allAdvisoryIds = new Set(advisories.map(({ id }) => normalizeId(id)));
    const blocking = advisories.filter(({ severity }) => BLOCKING_SEVERITIES.has(severity));
    const byId = new Map(allowlist.map((entry) => [normalizeId(entry.id), entry]));
    const unexpected = blocking.filter(({ id }) => !byId.has(normalizeId(id)));
    const expired = allowlist.filter((entry) => isExpired(entry.expires, now));
    const stale = allowlist.filter((entry) => !allAdvisoryIds.has(normalizeId(entry.id)));
    const allowlisted = advisories.filter(({ id }) => byId.has(normalizeId(id)));

    return {
        ok: unexpected.length === 0 && expired.length === 0 && stale.length === 0,
        auditFailed: false,
        unexpected,
        expired,
        stale,
        allowlisted
    };
};

const loadAudit = () => {
    const result = spawnSync('npm', ['audit', '--json'], {
        encoding: 'utf8',
        shell: false
    });

    try {
        const audit = JSON.parse(result.stdout);
        return {
            audit,
            completed:
                !Object.hasOwn(audit, 'error') &&
                (result.status === 0 || isValidAuditPayload(audit))
        };
    } catch {
        return { audit: null, completed: false };
    }
};

const loadAllowlist = () => {
    const file = new URL('./audit-allowlist.json', import.meta.url);
    return JSON.parse(readFileSync(file, 'utf8'));
};

const formatEntries = (label, entries) =>
    entries.map(({ id, severity }) => `${label}: ${id}${severity ? ` (${severity})` : ''}`);

const main = () => {
    const allowlist = loadAllowlist();
    const loadedAudit = loadAudit();
    const result = loadedAudit.completed
        ? evaluateAudit(loadedAudit.audit, allowlist, new Date())
        : {
              ok: false,
              auditFailed: true,
              unexpected: [],
              expired: [],
              stale: [],
              allowlisted: []
          };

    for (const entry of allowlist) {
        console.log(
            `[audit allowlist] ${entry.id}\nreason: ${entry.reason}\nupstream: ${entry.upstream}\nexpires: ${entry.expires}`
        );
    }

    const failures = result.auditFailed
        ? ['Audit could not be completed; failing closed.']
        : [
              ...formatEntries('Unexpected high/critical advisory', result.unexpected),
              ...formatEntries('Expired allowlist entry', result.expired),
              ...formatEntries('Stale allowlist entry', result.stale)
          ];

    if (failures.length > 0) {
        console.error(failures.join('\n'));
        process.exitCode = 1;
    }
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    main();
}
