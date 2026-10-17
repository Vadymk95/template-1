/* What a fork changes before it writes any feature: the web fonts it self-hosts. The list sits in this
   file, which no `scripts/gate-files.json` path matches, so choosing or dropping a font is not a
   change to the gate. `vite.config.ts` reads it at build time; nothing under `src/` imports this
   file. The family itself is named in `--font-sans` in `src/index.css`. */

/**
 * Stylesheet URLs of the web fonts to self-host. The font plugin downloads each one at build time,
 * so the app requests nothing from the font host. An empty list drops the web font: the plugin then
 * has nothing to fetch and `--font-sans` falls back to the system font.
 */
export const webFontUrls: string[] = [
    'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap'
];
