// Git hooks live in .husky/_ which `npm run prepare` generates. Lifecycle
// scripts are disabled repo-wide (.npmrc ignore-scripts), so a fresh clone
// skips husky's install — fail loudly instead of committing unhooked.
import { existsSync } from 'node:fs';

if (process.env.CI) {
    process.exit(0);
}
if (!existsSync(new URL('../.husky/_', import.meta.url))) {
    console.error('Git hooks are not installed (lifecycle scripts are disabled by .npmrc).');
    console.error('Run once after cloning: npm run prepare');
    process.exit(1);
}
