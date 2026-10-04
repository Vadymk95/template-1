import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Validated at build time — missing required vars throw before the app starts.
// Add new VITE_* vars here and document defaults in README/.env.
// Docs: https://env.t3.gg/docs/core
export const env = createEnv({
    clientPrefix: 'VITE_',
    client: {
        VITE_API_URL: z.url().optional(),
        // When true, loads web-vitals/attribution (LCP/INP/CLS debug targets). ~1–2 KB extra vs standard build.
        VITE_WEB_VITALS_ATTRIBUTION: z
            .string()
            .optional()
            .transform((val) => val === 'true'),
        // Dev-only browser MSW worker. Opt-OUT: `src/main.tsx` reads `import.meta.env` directly and starts
        // the worker unless this is the string 'false'. Nothing reads `env.VITE_ENABLE_MSW`; the entry only
        // declares the variable, so the `=== 'true'` transform below is not the gate.
        VITE_ENABLE_MSW: z
            .string()
            .optional()
            .transform((val) => val === 'true')
    },
    runtimeEnv: import.meta.env
});
