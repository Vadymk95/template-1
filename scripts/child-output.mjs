/**
 * How much output a script captures from a child process, and the line that says so when the child
 * wrote more. Node's sync child calls (`spawnSync`, `execSync`, `execFileSync`) keep the output up to
 * `maxBuffer`, 1 MiB by default and shared by stdout and stderr; past it the child is killed with
 * `error.code === 'ENOBUFS'` and `status === null`, which a check that reads only `status` reports as
 * a failure with no reason. Every capture in scripts/ passes `maxBuffer: OUTPUT_LIMIT_BYTES`, and a
 * check that judges the output says when the limit stopped it (`describeOutputOverflow`) instead of
 * judging a cut output. scripts/output-limits.test.mjs fails a capture that sets no limit.
 *
 * Byte-identical in every template of the family; raise the limit here, nowhere else.
 */
export const OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;

const MEBIBYTE = 1024 * 1024;

/** The one line for a child stopped by the capture limit; undefined when the error is anything else. */
export const describeOutputOverflow = (script, error) =>
    error?.code === 'ENOBUFS'
        ? `${script}: the output passed the ${String(OUTPUT_LIMIT_BYTES / MEBIBYTE)} MiB capture limit (ENOBUFS), so the run was stopped and not judged; raise OUTPUT_LIMIT_BYTES in scripts/child-output.mjs`
        : undefined;
