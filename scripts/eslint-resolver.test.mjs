// @vitest-environment node
//
// The TypeScript import resolver reads the project it is given from disk. A relative path is read
// from the directory lint was started in, and from any other folder (an editor, lint-staged in a
// larger checkout, `eslint` run inside `src`) the `@/` alias stops resolving and every import of it
// is reported as unresolved. The config anchors the path at its own folder, as it does the parser's
// `tsconfigRootDir`; this file pins that.
//
// The resolver is replaced by a recorder, so the options the config passes are read as they are
// passed, and the config is imported while the working directory is somewhere else on purpose.
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const createTypeScriptImportResolver = vi.hoisted(() => vi.fn(() => ({ name: 'recorder' })));

vi.mock('eslint-import-resolver-typescript', () => ({ createTypeScriptImportResolver }));

const ROOT = process.cwd();

describe('the import resolver of eslint.config.js', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Importing the whole repository config is the cost; the full suite runs this next to sixty other
    // files, so the default 5 s limit would measure machine load, not the code.
    it(
        'reads the root tsconfig.json from the config folder, whatever the working directory',
        { timeout: 60_000 },
        async () => {
            vi.spyOn(process, 'cwd').mockReturnValue(tmpdir());

            await import('../eslint.config.js');

            expect(createTypeScriptImportResolver).toHaveBeenCalledOnce();
            const [{ project }] = createTypeScriptImportResolver.mock.calls[0];
            expect(project).toBe(path.join(ROOT, 'tsconfig.json'));
        }
    );
});
