// Guards the audit gate's fail-CLOSED policy. A security gate that returns
// success when it cannot run is worse than no gate, so the "invalid payload"
// case below is the load-bearing one.
//
// Fixtures are built inline on purpose: a test that reads the repo's live
// audit-allowlist.json breaks every time an allowance is added or expires,
// which trains people to edit the test instead of the policy.
import { describe, expect, it } from 'vitest';

import { evaluateAudit } from './audit-gate.mjs';

const NOW = new Date('2026-01-15T00:00:00.000Z');
const ID = 'GHSA-test-aaaa-bbbb';

const advisory = (id = ID, severity = 'high') => ({
    source: 1234567,
    name: 'left-pad',
    severity,
    url: `https://github.com/advisories/${id}`,
    range: '<=1.0.0'
});

const audit = (vulnerabilities) => ({
    vulnerabilities,
    metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }
    }
});

const allowance = (overrides = {}) => ({
    id: ID,
    expires: '2026-06-01',
    reason: 'fixture',
    upstream: 'fixture',
    ...overrides
});

const rootOnly = (id = ID, severity = 'high') =>
    audit({ 'left-pad': { severity, via: [advisory(id, severity)], effects: [] } });

describe('evaluateAudit', () => {
    it('passes a clean audit with an empty allowlist', () => {
        expect(evaluateAudit(audit({}), [], NOW)).toMatchObject({
            ok: true,
            auditFailed: false
        });
    });

    it('fails closed when the audit itself could not be completed', () => {
        // npm printed an error object instead of a report: registry down, offline,
        // auth failure. Passing here would make the gate silently fail-open.
        const result = evaluateAudit({ error: { summary: 'registry unavailable' } }, [], NOW);

        expect(result).toMatchObject({ ok: false, auditFailed: true });
    });

    it('fails closed on a payload missing the expected shape', () => {
        expect(evaluateAudit({ vulnerabilities: {} }, [], NOW)).toMatchObject({
            ok: false,
            auditFailed: true
        });
    });

    it('blocks an un-allowlisted high advisory', () => {
        const result = evaluateAudit(rootOnly(), [], NOW);

        expect(result.unexpected).toEqual([expect.objectContaining({ id: ID })]);
        expect(result.ok).toBe(false);
    });

    it('lets a moderate advisory through — only high and critical block', () => {
        expect(evaluateAudit(rootOnly(ID, 'moderate'), [], NOW)).toMatchObject({ ok: true });
    });

    it('passes a high advisory covered by an unexpired allowance', () => {
        const result = evaluateAudit(rootOnly(), [allowance()], NOW);

        expect(result).toMatchObject({ ok: true, unexpected: [], expired: [], stale: [] });
        expect(result.allowlisted).toEqual([expect.objectContaining({ id: ID })]);
    });

    it('fails an expired allowance even while the advisory is still present', () => {
        const result = evaluateAudit(rootOnly(), [allowance({ expires: '2026-01-14' })], NOW);

        expect(result.expired).toEqual([expect.objectContaining({ id: ID })]);
        expect(result.ok).toBe(false);
    });

    it('fails an unparseable expiry date rather than treating it as far future', () => {
        const result = evaluateAudit(rootOnly(), [allowance({ expires: 'whenever' })], NOW);

        expect(result.expired).toEqual([expect.objectContaining({ id: ID })]);
        expect(result.ok).toBe(false);
    });

    it('fails a stale allowance whose advisory no longer appears in the audit', () => {
        const result = evaluateAudit(audit({}), [allowance()], NOW);

        expect(result.stale).toEqual([expect.objectContaining({ id: ID })]);
        expect(result.ok).toBe(false);
    });

    it('resolves a derived advisory to its root before matching the allowlist', () => {
        // npm reports the dependent package with `via: ['left-pad']` and no url of
        // its own; the allowance names the root GHSA, so the chain must resolve.
        const result = evaluateAudit(
            audit({
                'left-pad': { severity: 'high', via: [advisory()], effects: ['pad-wrapper'] },
                'pad-wrapper': { severity: 'high', via: ['left-pad'], effects: [] }
            }),
            [allowance()],
            NOW
        );

        expect(result).toMatchObject({ ok: true, unexpected: [] });
    });

    it('fails closed on an unresolvable via entry', () => {
        const result = evaluateAudit(
            audit({ orphan: { severity: 'high', via: ['missing-parent'], effects: [] } }),
            [],
            NOW
        );

        expect(result.unexpected).toEqual([expect.objectContaining({ id: 'npm:orphan' })]);
        expect(result.ok).toBe(false);
    });

    it('terminates and fails closed on a cyclic via chain', () => {
        const result = evaluateAudit(
            audit({
                first: { severity: 'high', via: ['second'], effects: [] },
                second: { severity: 'high', via: ['first'], effects: [] }
            }),
            [],
            NOW
        );

        expect(result.unexpected).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'npm:first' })])
        );
        expect(result.ok).toBe(false);
    });

    it('matches allowlist ids case-insensitively', () => {
        const result = evaluateAudit(rootOnly(), [allowance({ id: ID.toUpperCase() })], NOW);

        expect(result).toMatchObject({ ok: true, unexpected: [] });
    });
});
