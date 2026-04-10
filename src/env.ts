import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Validated at build time — missing required vars throw before the app starts.
// Add new VITE_* vars here and in .env.example.
// Docs: https://env.t3.gg/docs/core
export const env = createEnv({
    clientPrefix: 'VITE_',
    client: {
        VITE_API_URL: z.url().optional()
    },
    runtimeEnv: import.meta.env
});
