// Runner-agnostic on purpose, like `check-version-holds.test.mjs`: the templates run their script
// tests under different runners (vitest with globals, or `node --test`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { checkNodeFloor, lowestAtOrAbove, nvmrcFloor } from './check-node-floor.mjs';
import { parseRange } from './check-version-holds.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

// Resolved from the repo root: vitest serves modules over its own URL scheme, so a URL-relative
// path cannot work there; `node --test` runs from the root as well.
const SCRIPT = path.resolve(process.cwd(), 'scripts/check-node-floor.mjs');

const manifest = (node = '>=24.15.0') => ({ name: 'fixture', engines: { node } });
const lockOf = (engines) => ({
    packages: {
        '': { name: 'fixture', engines: { node: '>=24.0.0' } },
        ...Object.fromEntries(
            Object.entries(engines).map(([key, node]) => [
                key.startsWith('node_modules/') ? key : `node_modules/${key}`,
                node === null ? {} : { engines: { node } }
            ])
        )
    }
});

describe('lowestAtOrAbove', () => {
    const lowest = (range, from, ceiling = [25, 0, 0]) =>
        lowestAtOrAbove(parseRange(range), from, ceiling);

    it('lifts the start to the lower bound of the line', () => {
        assert.deepEqual(lowest('^22.22.2 || ^24.15.0 || >=26.0.0', [24, 0, 0]), [24, 15, 0]);
        assert.deepEqual(lowest('^22.18.0 || >=24.11.0', [24, 0, 0]), [24, 11, 0]);
    });

    it('keeps the start when the range already admits it', () => {
        assert.deepEqual(lowest('>=18', [24, 0, 0]), [24, 0, 0]);
        assert.deepEqual(lowest('*', [24, 3, 0]), [24, 3, 0]);
    });

    it('steps over a gap and past an upper bound', () => {
        assert.deepEqual(lowest('>=24.0.0 <24.3.0 || >=24.8.0', [24, 4, 0]), [24, 8, 0]);
        assert.equal(lowest('^22.12.0', [24, 0, 0]), null);
        assert.equal(lowest('>=26.0.0', [24, 0, 0]), null);
    });
});

describe('nvmrcFloor', () => {
    it('reads a partial version as its lowest, and ignores a v prefix and whitespace', () => {
        assert.deepEqual(nvmrcFloor('24\n'), [24, 0, 0]);
        assert.deepEqual(nvmrcFloor('24.15'), [24, 15, 0]);
        assert.deepEqual(nvmrcFloor('v24.15.2'), [24, 15, 2]);
    });

    it('refuses an alias it cannot resolve', () => {
        assert.equal(nvmrcFloor('lts/*'), null);
        assert.equal(nvmrcFloor('node'), null);
    });
});

describe('checkNodeFloor', () => {
    it('passes when engines.node and .nvmrc sit at the floor of the lockfile', () => {
        const lock = lockOf({ jsdom: '^22.22.2 || ^24.15.0 || >=26.0.0', react: '>=0.10' });
        assert.deepEqual(checkNodeFloor({ pkg: manifest(), lock, nvmrc: '24.15\n' }), []);
    });

    it('passes with a declared floor above the lockfile floor', () => {
        const lock = lockOf({ jsdom: '^22.22.2 || ^24.15.0 || >=26.0.0' });
        assert.deepEqual(checkNodeFloor({ pkg: manifest('>=24.20.0'), lock, nvmrc: '24.20' }), []);
    });

    it('fails a floor below the strictest locked package, and names it and the fix', () => {
        const lock = lockOf({ jsdom: '^22.22.2 || ^24.15.0 || >=26.0.0', react: '>=0.10' });
        const findings = checkNodeFloor({ pkg: manifest('>=24.0.0'), lock, nvmrc: '24.15' });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /^floor: /);
        assert.match(findings[0], /admits Node 24\.0\.0, but the lockfile needs 24\.15\.0/);
        assert.match(findings[0], /jsdom "\^22\.22\.2 \|\| \^24\.15\.0 \|\| >=26\.0\.0"/);
        assert.match(findings[0], /set engines\.node to ">=24\.15\.0"/);
    });

    it('takes the highest floor, whatever the order of the packages', () => {
        const lock = lockOf({ a: '>=24.15.0', b: '^22.18.0 || >=24.11.0', c: '>=24.5.0' });
        const forward = checkNodeFloor({ pkg: manifest('>=24.0.0'), lock, nvmrc: null });
        const backward = checkNodeFloor({
            pkg: manifest('>=24.0.0'),
            lock: { packages: Object.fromEntries(Object.entries(lock.packages).reverse()) },
            nvmrc: null
        });
        assert.match(forward[0], /needs 24\.15\.0 \(a /);
        assert.match(backward[0], /needs 24\.15\.0 \(a /);
    });

    it('counts a nested package, since engine-strict checks every installed copy', () => {
        const lock = lockOf({ 'a/node_modules/deep': '>=24.18.0' });
        const [finding] = checkNodeFloor({ pkg: manifest('>=24.0.0'), lock, nvmrc: null });
        assert.match(finding, /needs 24\.18\.0 \(deep /);
    });

    it('resolves a floor with a patch part and tells .nvmrc to name it', () => {
        const lock = lockOf({ a: '>=24.11.2' });
        const findings = checkNodeFloor({ pkg: manifest('>=24.11.0'), lock, nvmrc: '24.11' });
        assert.equal(findings.length, 2);
        assert.match(findings[0], /needs 24\.11\.2/);
        assert.match(findings[1], /^nvmrc: .*set it to "24\.11\.2"/);
    });

    it('fails a bare major in .nvmrc, which resolves to 24.0.0', () => {
        const lock = lockOf({ jsdom: '^24.15.0' });
        const findings = checkNodeFloor({ pkg: manifest(), lock, nvmrc: '24' });
        assert.equal(findings.length, 1);
        assert.match(findings[0], /^nvmrc: .*"24" resolves below the floor 24\.15\.0.*"24\.15"/);
    });

    it('does not read the root entry, which is this package and not a dependency', () => {
        const lock = { packages: { '': { engines: { node: '>=24.99.0' } } } };
        assert.deepEqual(checkNodeFloor({ pkg: manifest('>=24.0.0'), lock, nvmrc: '24' }), []);
    });

    it('fails a package that admits no Node of the declared major', () => {
        const lock = lockOf({ legacy: '^20.19.0 || ^22.12.0' });
        const [finding] = checkNodeFloor({ pkg: manifest(), lock, nvmrc: null });
        assert.match(finding, /^reach: legacy .* admits no Node 24\.x at or above 24\.15\.0/);
    });

    it('refuses a range it cannot read instead of passing it', () => {
        const lock = lockOf({ odd: '1.2.3 - 4.5.6' });
        const [finding] = checkNodeFloor({ pkg: manifest(), lock, nvmrc: null });
        assert.match(finding, /^syntax: odd engines\.node "1\.2\.3 - 4\.5\.6"/);
    });

    it('refuses a missing or unbounded engines.node, and an alias in .nvmrc', () => {
        const lock = lockOf({});
        assert.match(
            checkNodeFloor({ pkg: { name: 'x' }, lock, nvmrc: null })[0],
            /^syntax: package\.json has no engines\.node/
        );
        assert.match(
            checkNodeFloor({ pkg: manifest('<25'), lock, nvmrc: null })[0],
            /^syntax: .*no lower bound/
        );
        assert.match(
            checkNodeFloor({ pkg: manifest(), lock, nvmrc: 'lts/*' })[0],
            /^nvmrc: .*not a version/
        );
    });

    it('accepts a repository with no .nvmrc', () => {
        const lock = lockOf({ jsdom: '^24.15.0' });
        assert.deepEqual(checkNodeFloor({ pkg: manifest(), lock, nvmrc: null }), []);
    });
});

describe('the command line', () => {
    const cli = ({ node, nvmrc, engines }) => {
        const root = mkdtempSync(path.join(tmpdir(), 'node-floor-'));
        try {
            writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest(node)));
            writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lockOf(engines)));
            if (nvmrc !== undefined) writeFileSync(path.join(root, '.nvmrc'), nvmrc);
            return spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    };

    it('exits 1 and prints the fix when the floor is too low', () => {
        const result = cli({ node: '>=24.0.0', nvmrc: '24\n', engines: { jsdom: '^24.15.0' } });
        assert.equal(result.status, 1);
        assert.match(result.stdout, /✖ floor: .*">=24\.15\.0"/);
        assert.match(result.stdout, /✖ nvmrc: /);
    });

    it('exits 0 when the manifest and .nvmrc agree with the lockfile', () => {
        const result = cli({ node: '>=24.15.0', nvmrc: '24.15\n', engines: { jsdom: '^24.15.0' } });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /✔ engines\.node and \.nvmrc/);
    });
});
