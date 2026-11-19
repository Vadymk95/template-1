import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { describeOutputOverflow, OUTPUT_LIMIT_BYTES } from './child-output.mjs';

const SCRIPTS = path.resolve(process.cwd(), 'scripts');
const KIB = 1024;
const CAPTURE = ['ignore', 'pipe', 'pipe'];

describe('describeOutputOverflow', () => {
    it('names the script, the limit and where to raise it for ENOBUFS', () => {
        expect(describeOutputOverflow('check-coverage', { code: 'ENOBUFS' })).toBe(
            'check-coverage: the output passed the 256 MiB capture limit (ENOBUFS), so the run was stopped and not judged; raise OUTPUT_LIMIT_BYTES in scripts/child-output.mjs'
        );
        expect(OUTPUT_LIMIT_BYTES).toBe(256 * KIB * KIB);
    });

    it('says nothing for any other error or none', () => {
        expect(describeOutputOverflow('x', { code: 'ENOENT' })).toBeUndefined();
        expect(describeOutputOverflow('x', new Error('boom'))).toBeUndefined();
        expect(describeOutputOverflow('x', undefined)).toBeUndefined();
    });
});

describe('a gate script reading a child that writes a lot', { timeout: 20_000 }, () => {
    const dirs = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /** A folder with a stub `name` first on PATH: a node script that runs `body`. */
    const withStub = (name, body) => {
        const dir = mkdtempSync(path.join(tmpdir(), 'child-output-'));
        dirs.push(dir);
        mkdirSync(path.join(dir, 'bin'));
        const stub = path.join(dir, 'bin', name);
        writeFileSync(stub, `#!/usr/bin/env node\n${body}\n`);
        chmodSync(stub, 0o755);
        return dir;
    };

    const run = (dir, script) => {
        const env = {
            ...process.env,
            PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`
        };
        delete env.GATE_LEAVE_OUT_SELF_TESTS;
        return spawnSync(process.execPath, [script], {
            cwd: dir,
            env,
            stdio: CAPTURE,
            maxBuffer: OUTPUT_LIMIT_BYTES
        });
    };

    it('check-coverage: 600 KiB on stdout and 600 KiB on stderr pass, every byte echoed', () => {
        const size = 600 * KIB;
        const dir = withStub(
            'npx',
            `process.stdout.write('o'.repeat(${String(size)}));process.stderr.write('e'.repeat(${String(size)}));`
        );

        const result = run(dir, path.join(SCRIPTS, 'check-coverage.mjs'));

        expect(result.status).toBe(0);
        expect(result.stdout.length).toBe(size);
        expect(result.stderr.length).toBe(size);
    });

    it('check-coverage: a red run of 1 MiB reaches a reader through a pipe whole, with its exit code', () => {
        // On a macOS pipe `process.stdout.write(<1 MiB>)` followed by `process.exit()` delivers 65,536
        // bytes: Node documents pipes as asynchronous on POSIX ("A note on process I/O").
        const size = KIB * KIB;
        const dir = withStub(
            'npx',
            `process.stdout.write('o'.repeat(${String(size)}));process.exitCode = 3;`
        );

        const result = run(dir, path.join(SCRIPTS, 'check-coverage.mjs'));

        expect(result.status).toBe(3);
        expect(result.stdout.length).toBe(size);
    });

    it('audit-gate: an audit document over 1 MiB is parsed and judged', () => {
        const advisory = 'GHSA-aaaa-bbbb-cccc';
        const audit = {
            auditReportVersion: 2,
            vulnerabilities: {
                lodash: {
                    name: 'lodash',
                    severity: 'high',
                    via: [
                        {
                            title: 'x',
                            url: `https://github.com/advisories/${advisory}`,
                            severity: 'high'
                        }
                    ],
                    note: 'x'.repeat(2 * KIB * KIB)
                }
            },
            metadata: { vulnerabilities: { high: 1, total: 1 } }
        };
        const dir = withStub(
            'npm',
            `process.stdout.write(${JSON.stringify(JSON.stringify(audit))});process.exitCode = 1;`
        );
        mkdirSync(path.join(dir, 'scripts'));
        for (const file of ['audit-gate.mjs', 'is-entry-point.mjs', 'child-output.mjs']) {
            copyFileSync(path.join(SCRIPTS, file), path.join(dir, 'scripts', file));
        }
        writeFileSync(path.join(dir, 'scripts/audit-allowlist.json'), '[]');

        const result = run(dir, path.join(dir, 'scripts/audit-gate.mjs'));
        const error = result.stderr.toString();

        expect(error).not.toContain('could not be completed');
        expect(error).toContain(`Unexpected high/critical advisory: ${advisory} (high)`);
        expect(result.status).toBe(1);
    });
});
