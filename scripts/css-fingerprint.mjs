/**
 * css-fingerprint - a short hash of the stylesheets the Tailwind lint rules read.
 *
 * `tailwindcss/*` and `better-tailwindcss/*` open the stylesheet themselves (tokens, utilities and
 * variants decide what is a known class, its order and its canonical form). ESLint's cache keys on
 * the linted file and the resolved config, never on a file a rule reads on its own, so after a token
 * or utility change a cached run replays the verdicts of the old stylesheet: a false green. The
 * config carries this fingerprint in `settings`, which ESLint hashes into every cache entry of the
 * files the rules cover, so editing the stylesheet re-lints those files and nothing else.
 *
 * The inputs are the entry stylesheet, the local stylesheets it reaches through `@import`, and the
 * name and installed version of every package an `@import` in that chain names (`@import
 * 'tailwindcss'`). The rules read the package's own stylesheets too, and those change with its
 * version, not with a file ESLint's cache sees: after a `tailwindcss` upgrade a cached run replayed
 * the verdicts of the old one until `.eslintcache` was deleted by hand. The version comes from the
 * nearest `node_modules` above the importing file, as Node finds it (a symlinked one counts). A
 * package that is not installed, or whose manifest holds no readable version, counts as missing
 * and never throws. The package's files are not hashed, so a patched copy with the same version is
 * not seen.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FINGERPRINT_LENGTH = 16;
// `@import "./a.css"`, `@import './a.css' layer(base)`, `@import url("./a.css")`, `@import url(./a.css) screen`.
const IMPORT = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1/g;
// What a package counts as when no installed copy with a readable version is found.
const MISSING = 'missing';

const isFile = (file) => existsSync(file) && statSync(file).isFile();

/**
 * The package an `@import` names, or undefined when it names a path (starts with `.` or `/`) or a URL
 * (has a `:`): `tailwindcss/theme.css` names `tailwindcss`, `@scope/pkg/sub.css` names `@scope/pkg`.
 */
export const packageName = (specifier) => {
    if (/^[./]/.test(specifier) || specifier.includes(':')) return undefined;

    return specifier
        .split('/')
        .slice(0, specifier.startsWith('@') ? 2 : 1)
        .join('/');
};

/** The version a package manifest declares, or MISSING when it is not JSON or holds no version string. */
const manifestVersion = (manifest) => {
    try {
        const { version } = JSON.parse(readFileSync(manifest, 'utf8'));

        return typeof version === 'string' ? version : MISSING;
    } catch {
        return MISSING;
    }
};

/** The installed version of a package as Node finds it: the nearest `node_modules` at or above `from`. */
const installedVersion = ({ from, name }) => {
    const manifest = path.join(from, 'node_modules', name, 'package.json');
    if (isFile(manifest)) return manifestVersion(manifest);

    const parent = path.dirname(from);

    return parent === from ? MISSING : installedVersion({ from: parent, name });
};

/**
 * The import chain of the entry stylesheet: its local stylesheets (entry first, depth first, each
 * once, as absolute paths) and the packages it imports (each once, as `name@version`, in the order
 * they are met). An import is a local stylesheet when it resolves to a file beside its importer,
 * and a package when it does not and is not a path or a URL (`packageName`).
 */
const importChain = ({ root, entry }) => {
    const first = path.resolve(root, entry);
    if (!isFile(first)) {
        throw new Error(
            `css-fingerprint: the Tailwind entry stylesheet ${entry} does not exist under ${root}; point TAILWIND_ENTRY in eslint.config.js at it`
        );
    }

    const files = new Set();
    const packages = new Set();
    const visit = (file) => {
        if (files.has(file)) return;
        files.add(file);
        const directory = path.dirname(file);
        for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
            const local = path.resolve(directory, match[2]);
            const name = packageName(match[2]);
            if (isFile(local)) {
                visit(local);
            } else if (name !== undefined) {
                packages.add(`${name}@${installedVersion({ from: directory, name })}`);
            }
        }
    };
    visit(first);

    return { files: [...files], packages: [...packages] };
};

/** The entry stylesheet and every local stylesheet it imports, entry first, each once, as absolute paths. */
export const cssInputs = (options) => importChain(options).files;

/**
 * A hash of the names and contents of `cssInputs`, relative to the entry's folder so a moved checkout
 * keeps it, and of the name and installed version of each package the chain imports.
 */
export const cssFingerprint = ({ root, entry }) => {
    const base = path.dirname(path.resolve(root, entry));
    const { files, packages } = importChain({ root, entry });
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(path.relative(base, file)).update('\0').update(readFileSync(file)).update('\0');
    }
    for (const stamp of packages) hash.update('package\0').update(stamp).update('\0');

    return hash.digest('hex').slice(0, FINGERPRINT_LENGTH);
};
