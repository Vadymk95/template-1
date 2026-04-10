import { setupServer } from 'msw/node';

import { handlers } from './handlers';

// Single MSW server instance shared across all test files.
// Lifecycle (start/reset/stop) is wired in src/test/setup.ts.
export const server = setupServer(...handlers);
