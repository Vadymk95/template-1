/**
 * Whether the module whose `import.meta.url` is passed in is the file node was started on: a script
 * runs its `main()` when executed and stays silent when a test imports it.
 *
 * The hand-written guard, `import.meta.url === new URL('file://' + process.argv[1]).href`, does not
 * survive two ordinary paths. Through a symlink, node gives the module the URL of its REAL path while
 * `process.argv[1]` keeps the link. With a `#`, `%` or `?` in the path, `new URL` reads them as a
 * fragment, a query or an escape instead of as part of the name. In both cases the script matched
 * nothing, ran nothing and exited 0, and for a gate check that is a pass that checked nothing.
 *
 * Here the entry path is turned into a URL by `pathToFileURL`, which escapes those characters the way
 * node does for `import.meta.url`, and is compared as its real path (what node puts in
 * `import.meta.url`) and as given (what `--preserve-symlinks-main` leaves there). No entry file
 * (`node -e`, a REPL) or one that does not exist is not an entry point. is-entry-point.test.mjs also
 * fails a script that writes the guard by hand.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const isEntryPoint = (importMetaUrl, entry = process.argv[1]) => {
    if (!entry) {
        return false;
    }
    if (pathToFileURL(entry).href === importMetaUrl) {
        return true;
    }
    try {
        return pathToFileURL(realpathSync(entry)).href === importMetaUrl;
    } catch {
        return false;
    }
};
