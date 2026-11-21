// The cases of docs-check.test.mjs that read this repository's own workflow files. The rest of that
// file lives in gatelaw, over fixture workflows.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkPullRequestReadPermission } from './docs-check.mjs';

// A job-level `permissions:` block replaces the workflow-level one, so the scope belongs on the
// gitleaks job alone: a workflow-wide grant would also widen every other job's token.
const pullRequestScopeOutsideJob = (text, jobId) => {
    const lines = text.split('\n');
    const own = lines.findIndex((line) => line === `    ${jobId}:`);
    const next = lines.findIndex((line, index) => index > own && /^ {4}\S/.test(line));
    const stop = next === -1 ? lines.length : next;

    return lines.flatMap((line, index) => {
        const inside = own !== -1 && index > own && index < stop;
        const grant = /^\s*(pull-requests:|permissions:\s*(read|write)-all\b)/.test(line);
        return grant && !inside ? [index + 1] : [];
    });
};

describe('checkPullRequestReadPermission', () => {
    // The private-fork failure shows only on a fork's first pull request, so this repository's own
    // workflows are checked on every test run, not only when docs:check runs.
    describe("this repository's own workflows", () => {
        const dir = path.join(process.cwd(), '.github/workflows');
        const files = existsSync(dir)
            ? readdirSync(dir).filter((file) => file.endsWith('.yml'))
            : [];

        it('grant pull-requests: read to every gitleaks job on a pull_request trigger', () => {
            const workflows = files.map((file) => [
                `.github/workflows/${file}`,
                readFileSync(path.join(dir, file), 'utf8')
            ]);

            expect(checkPullRequestReadPermission({ workflows })).toEqual([]);
        });

        it('keep the pull-requests scope on the security workflow gitleaks job only', () => {
            expect(files).toContain('security.yml');
            expect(
                pullRequestScopeOutsideJob(
                    readFileSync(path.join(dir, 'security.yml'), 'utf8'),
                    'gitleaks'
                )
            ).toEqual([]);
        });
    });
});
