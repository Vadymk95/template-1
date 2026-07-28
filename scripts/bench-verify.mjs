/**
 * Runs the verify gate step by step with per-step timings, so a slow gate can be
 * attributed instead of guessed at. Same steps as `npm run verify`; if you change
 * one, change the other.
 *
 * Usage: node scripts/bench-verify.mjs
 */

import { spawnSync } from 'node:child_process';

const steps = [
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['oxlint', 'npm', ['run', 'lint:oxlint']],
    ['eslint', 'npm', ['run', 'lint']],
    ['format', 'npm', ['run', 'format:check']],
    ['coverage', 'npm', ['run', 'test:coverage']],
    ['build', 'npm', ['run', 'build']],
    ['web-vitals-chunks', 'npm', ['run', 'verify:web-vitals-chunks']],
    ['size', 'npm', ['run', 'size:check']],
    ['e2e', 'npm', ['run', 'test:e2e:prod']]
];

console.log('verify benchmark (per step)\n');

const timings = [];

for (const [label, cmd, args] of steps) {
    const start = performance.now();
    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        shell: false,
        env: { ...process.env, ANALYZE: 'false' }
    });
    const ms = Math.round(performance.now() - start);
    timings.push([label, ms]);
    console.log(`\n→ ${label}: ${ms} ms`);

    if (result.status !== 0) {
        console.error(`\n✖ ${label} failed — stopping here.`);
        process.exit(result.status ?? 1);
    }
}

const total = timings.reduce((sum, [, ms]) => sum + ms, 0);
console.log('\n─── summary (slowest first) ───');
for (const [label, ms] of [...timings].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(Math.round((ms / total) * 100)).padStart(3)}%  ${label}: ${ms} ms`);
}
console.log(`\n✓ All steps passed in ${total} ms\n`);
