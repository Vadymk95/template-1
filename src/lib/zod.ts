import { z } from 'zod';

// The shipped CSP has no 'unsafe-eval' (SECURITY_REQUIREMENTS.md), so zod's JIT probe (`new Function`) is
// blocked and browsers report it as a violation even though zod catches it; jitless skips the probe.
// Zod reads the switch when an object schema is built, so it has to be set before any schema exists. That
// holds whatever order the modules load in only because every module takes `z` from here: a direct
// `import ... from 'zod'` is a lint error (`no-restricted-imports` in eslint.config.js).
// Stryker disable next-line all: scripts/zod-config-bundle.test.mjs reads this call as written
z.config({ jitless: true });

// This module only re-exports `z`, so with `treeshake.moduleSideEffects: false` the bundler would resolve
// every import of it straight to zod and drop the call above. `vite.config.ts` therefore names this file as
// one whose body must run, and `scripts/zod-config-bundle.test.mjs` builds a consumer and fails if the
// call is missing from the output. A side-effect-only import of a configuring module is dropped the same way.
export { z };
