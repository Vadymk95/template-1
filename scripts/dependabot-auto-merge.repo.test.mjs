// The cases of dependabot-auto-merge.test.mjs that read this repository's own workflow file: the job
// runs the base-branch copy of one script and never the pull request's code. The cases that run the
// script against a fake `gh` live in gatelaw.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Resolved from the repo root, not from `import.meta.url`: vitest serves this module over its own
// URL scheme, so a URL-relative path cannot work there.
const ROOT = process.cwd();
const WORKFLOW_PATH = '.github/workflows/dependabot-auto-merge.yml';
const SCRIPT_PATH = 'scripts/dependabot-auto-merge.sh';
const DECIDE_ID = 'decide';

const readIfExists = (file) =>
    existsSync(path.join(ROOT, file)) ? readFileSync(path.join(ROOT, file), 'utf8') : '';

const workflow = readIfExists(WORKFLOW_PATH);
const script = readIfExists(SCRIPT_PATH);

const withoutComments = (text) =>
    text
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');

const indentOf = (line) => line.length - line.trimStart().length;

/** The lines nested deeper than the key at `index` (blank lines inside the block are kept). */
const nestedLines = (lines, index) => {
    let end = index + 1;
    while (
        end < lines.length &&
        (lines[end].trim() === '' || indentOf(lines[end]) > indentOf(lines[index]))
    )
        end += 1;
    return lines.slice(index + 1, end);
};

/** The one job of the workflow, whatever its id. */
const theJob = () => {
    const lines = withoutComments(workflow).split('\n');
    const jobsAt = lines.indexOf('jobs:');
    if (jobsAt === -1) return [];
    const first = lines.findIndex((line, at) => at > jobsAt && /^ {4}[\w-]+:\s*$/.test(line));
    return first === -1 ? [] : nestedLines(lines, first);
};

/** A scalar key of the job itself (8 spaces), not of a step. */
const jobKey = (lines, key) => {
    const line = lines.find((candidate) => candidate.startsWith(`        ${key}:`));
    return line?.slice(line.indexOf(':') + 1).trim();
};

/** The `key: value` pairs nested under `key:` at `indent` spaces. */
const mapUnder = (lines, key, indent) => {
    const start = lines.findIndex((line) => line === `${' '.repeat(indent)}${key}:`);
    if (start === -1) return null;
    return Object.fromEntries(
        nestedLines(lines, start)
            .filter((line) => line.trim() !== '')
            .map((line) => {
                const at = line.indexOf(':');
                return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
            })
    );
};

/** The steps of the job: each a list of lines, the first starting with `- ` at 12 spaces. */
const stepsOf = (lines) => {
    const steps = [];
    for (const line of lines) {
        if (/^ {12}- /.test(line)) steps.push([line]);
        else if (steps.length > 0) steps.at(-1).push(line);
    }
    return steps;
};

const stepUsing = (name) =>
    stepsOf(theJob()).find((step) => step.some((line) => line.includes(`uses: ${name}@`)));

const decideStep = () =>
    stepsOf(theJob()).find((step) => step.some((line) => line.trim().endsWith(`id: ${DECIDE_ID}`)));

const decideEnv = () => mapUnder(decideStep() ?? [], 'env', 14);

describe('the workflow file', () => {
    it('exists', () => {
        expect(workflow, `${WORKFLOW_PATH} is missing`).not.toBe('');
    });

    it('triggers on pull_request and names the other pull-request trigger nowhere', () => {
        const lines = workflow.split('\n');
        const onAt = lines.indexOf('on:');
        expect(onAt, 'the workflow needs a top-level `on:`').toBeGreaterThan(-1);
        expect(nestedLines(lines, onAt).some((line) => /^ {4}pull_request:/.test(line))).toBe(true);
        expect(workflow).not.toContain('pull_request_target');
    });

    it('runs only for pull requests opened by Dependabot, decided from the author in the payload', () => {
        const condition = jobKey(theJob(), 'if');
        expect(condition, 'the job needs an `if:`').toBeDefined();
        expect(condition).toContain('github.event.pull_request.user.login');
        expect(condition).toContain("'dependabot[bot]'");
        expect(condition).not.toContain('github.actor');
    });

    it('keeps a read-only floor and gives the job exactly the two write scopes', () => {
        const lines = withoutComments(workflow).split('\n');
        expect(mapUnder(lines, 'permissions', 0)).toEqual({ contents: 'read' });
        expect(mapUnder(theJob(), 'permissions', 8)).toEqual({
            contents: 'write',
            'pull-requests': 'write'
        });
    });

    it('pins every action by a 40-character commit SHA with a version comment', () => {
        const uses = workflow.split('\n').filter((line) => /^\s*(- )?uses:/.test(line));
        expect(uses.length, 'the job needs the metadata action and the checkout').toBeGreaterThan(
            1
        );
        for (const line of uses) {
            expect(line, `${line.trim()} is not pinned`).toMatch(/@[0-9a-f]{40} # v\d/);
        }
    });

    it('has a timeout and one concurrency group per pull request', () => {
        expect(jobKey(theJob(), 'timeout-minutes')).toMatch(/^\d+$/);
        const lines = withoutComments(workflow).split('\n');
        expect(mapUnder(lines, 'concurrency', 0)?.group).toContain(
            'github.event.pull_request.number'
        );
    });

    it('keeps the metadata step from failing the job, so the decision step always runs', () => {
        const metadata = stepUsing('dependabot/fetch-metadata');
        expect(metadata, 'the job needs a dependabot/fetch-metadata step').toBeDefined();
        const text = (metadata ?? []).join('\n');
        expect(text).toMatch(/^ {14}continue-on-error: true$/m);
        expect(text).not.toMatch(/skip-(commit-)?verification/);
    });
});

describe('the job runs the base branch copy of one script, never the pull request code', () => {
    const checkouts = () =>
        stepsOf(theJob()).filter((step) =>
            step.some((line) => line.includes('uses: actions/checkout@'))
        );

    it('has exactly one checkout, before the decision step', () => {
        expect(checkouts()).toHaveLength(1);
        const steps = stepsOf(theJob());
        const at = (name) => steps.findIndex((step) => step.some((line) => line.includes(name)));
        expect(at('actions/checkout@')).toBeGreaterThan(-1);
        expect(at('actions/checkout@')).toBeLessThan(at(`id: ${DECIDE_ID}`));
    });

    it('checks out the base ref, not the head', () => {
        const checkout = checkouts()[0] ?? [];
        expect(mapUnder(checkout, 'with', 14)?.ref).toBe(
            '${{ github.event.pull_request.base.ref }}'
        );
        expect(withoutComments(workflow)).not.toMatch(
            /pull_request\.head|head\.sha|head\.ref|github\.sha|head_ref|refs\/pull\//
        );
    });

    it('is sparse to the one script and keeps no credentials', () => {
        const options = mapUnder(checkouts()[0] ?? [], 'with', 14);
        expect(options?.['sparse-checkout']).toBe(SCRIPT_PATH);
        expect(options?.['sparse-checkout-cone-mode']).toBe('false');
        expect(options?.['persist-credentials']).toBe('false');
    });

    it('runs exactly that script as the one line of the decision step', () => {
        const step = decideStep() ?? [];
        const runLines = step.filter((line) => /^ {14}run:/.test(line));
        expect(runLines).toEqual([`              run: bash ${SCRIPT_PATH}`]);
        expect(step.some((line) => /^ {14}run: [|>]/.test(line))).toBe(false);
    });

    it('hands every value to the script through env', () => {
        expect(withoutComments(script)).not.toContain('${{');
        expect(decideEnv()).toMatchObject({
            GH_TOKEN: '${{ github.token }}',
            REPOSITORY: '${{ github.repository }}',
            BASE_REF: '${{ github.event.pull_request.base.ref }}',
            PR_NUMBER: '${{ github.event.pull_request.number }}',
            PR_NODE_ID: '${{ github.event.pull_request.node_id }}',
            UPDATE_TYPE: '${{ steps.metadata.outputs.update-type }}',
            METADATA_OUTCOME: '${{ steps.metadata.outcome }}'
        });
        for (const name of Object.keys(decideEnv() ?? {}).filter((key) => key !== 'GH_TOKEN')) {
            expect(script, `the script never reads $${name}`).toContain(name);
        }
    });

    it('runs the decision step under bash', () => {
        expect((decideStep() ?? []).some((line) => /^ {14}shell: bash$/.test(line))).toBe(true);
    });
});
