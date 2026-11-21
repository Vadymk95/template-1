#!/usr/bin/env node
// The old name of check-engines-floor.mjs, kept so a package.json that still calls it keeps working.
import('./check-engines-floor.mjs').then(({ main }) => main());
