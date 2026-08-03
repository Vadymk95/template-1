// The EXEMPT list is the part of this gate people actually edit, and every edit
// widens it — usually to get one commit moving. These cases pin what the exemptions
// are FOR, so a widening that changes the policy fails here instead of silently
// letting untested logic land.
//
// `exists` is injected, so the specs describe the decision, not the tree.
import { describe, expect, it } from 'vitest';

import { findMissingSiblings, isSrcLogic, siblingCandidates } from './check-test-siblings.mjs';

const nothingExists = () => false;
const everythingExists = () => true;

describe('isSrcLogic', () => {
    it.each([
        'src/lib/queryClient.ts',
        'src/hooks/useDebounce.ts',
        'src/store/auth/authStore.ts',
        'src/pages/LoginPage/useLoginForm.ts',
        'src/components/common/Toast/Toast.tsx'
    ])('treats %s as logic that needs a test', (file) => {
        expect(isSrcLogic(file)).toBe(true);
    });

    it.each([
        // Tests and declarations have nothing of their own to cover.
        ['a test file', 'src/lib/utils.test.ts'],
        ['a type declaration', 'src/types/global.d.ts'],
        ['the vite env shim', 'src/vite-env.d.ts'],
        // Barrels re-export; a test would assert the re-export, not behaviour.
        ['a barrel', 'src/pages/LoginPage/index.ts'],
        ['a lazy-route barrel', 'src/pages/DevPlayground/index.ts'],
        // Declaration-only registries: changing a value is not changing logic.
        ['a constants table', 'src/store/auth/constants.ts'],
        ['a storage-key registry', 'src/store/auth/keys.ts'],
        ['a route map', 'src/router/routes.ts'],
        // Entry points and generated UI.
        ['the app entry', 'src/main.tsx'],
        ['the root component', 'src/App.tsx'],
        ['validated env', 'src/env.ts'],
        ['a generated shadcn primitive', 'src/components/ui/button.tsx'],
        // Test and mock infrastructure.
        ['an MSW handler', 'src/mocks/handlers.ts'],
        ['a test util', 'src/test/test-utils.tsx'],
        // Documented template seeds — see TEMPLATE_SEEDS.md.
        ['a template seed', 'src/lib/api/_exampleQuery.ts']
    ])('exempts %s', (_label, file) => {
        expect(isSrcLogic(file)).toBe(false);
    });

    it('ignores files outside src entirely', () => {
        expect(isSrcLogic('scripts/audit-gate.mjs')).toBe(false);
        expect(isSrcLogic('e2e/login.spec.ts')).toBe(false);
        expect(isSrcLogic('vite.config.ts')).toBe(false);
    });

    it('ignores non-TypeScript files under src', () => {
        expect(isSrcLogic('src/index.css')).toBe(false);
        expect(isSrcLogic('src/assets/logo.svg')).toBe(false);
    });

    it('does NOT exempt a component that happens to be named index.tsx', () => {
        // The barrel exemption is spelled `index.ts` on purpose. In this template `index.tsx` IS the
        // component, so a loose `index.tsx?$` waved every component in `src/components/**` through.
        expect(isSrcLogic('src/components/layout/Header/index.tsx')).toBe(true);
        expect(isSrcLogic('src/components/common/ThemeToggle/index.tsx')).toBe(true);
    });

    it('does not exempt a path that merely CONTAINS an exempt segment name', () => {
        // `^src/components/ui/` is anchored on purpose. The generated shadcn
        // primitives live at exactly that path; a feature that happens to nest its
        // own `components/ui/` deeper is ordinary code and still needs tests.
        // Un-anchoring the pattern is what this case exists to catch, so the path
        // must contain `components/ui/` somewhere OTHER than the start.
        expect(isSrcLogic('src/features/editor/components/ui/Toolbar.tsx')).toBe(true);
        // Same for the mocks and test directories.
        expect(isSrcLogic('src/features/editor/mocks/fixtures.ts')).toBe(true);
        expect(isSrcLogic('src/features/editor/test/helpers.ts')).toBe(true);
        // `constants.ts$` is an exact filename, not a prefix.
        expect(isSrcLogic('src/lib/constantsFactory.ts')).toBe(true);
    });
});

describe('siblingCandidates', () => {
    it('probes both extensions for an ordinary module', () => {
        expect(siblingCandidates('src/lib/utils.ts')).toEqual([
            'src/lib/utils.test.ts',
            'src/lib/utils.test.tsx'
        ]);
    });

    it('accepts the directory-named test for a component written as index.tsx', () => {
        expect(siblingCandidates('src/components/layout/Header/index.tsx')).toEqual([
            'src/components/layout/Header/index.test.ts',
            'src/components/layout/Header/index.test.tsx',
            'src/components/layout/Header/Header.test.tsx',
            'src/components/layout/Header/Header.test.ts'
        ]);
    });

    it('does not invent a directory-named candidate for a non-index file', () => {
        // Otherwise `Header/useHeader.ts` would be satisfied by `Header/Header.test.tsx`, and one test
        // would cover every module in the folder.
        expect(siblingCandidates('src/components/layout/Header/useHeader.ts')).toEqual([
            'src/components/layout/Header/useHeader.test.ts',
            'src/components/layout/Header/useHeader.test.tsx'
        ]);
    });
});

describe('findMissingSiblings', () => {
    it('refuses a component whose folder holds a test for a DIFFERENT module', () => {
        // The accepting direction alone would pass with a directory scan. This is the case a scan
        // gets wrong: a sibling test exists in the folder, but not for this component.
        const exists = (path) => path === 'src/components/layout/Header/useHeader.test.ts';

        expect(findMissingSiblings(['src/components/layout/Header/index.tsx'], exists)).toEqual([
            'src/components/layout/Header/index.tsx'
        ]);
    });

    it('accepts a component covered by the directory-named test', () => {
        const exists = (path) => path === 'src/components/layout/Header/Header.test.tsx';

        expect(findMissingSiblings(['src/components/layout/Header/index.tsx'], exists)).toEqual([]);
    });

    it('reports a logic file with no sibling', () => {
        expect(findMissingSiblings(['src/lib/utils.ts'], nothingExists)).toEqual([
            'src/lib/utils.ts'
        ]);
    });

    it('accepts a .ts file covered by a .test.ts sibling', () => {
        const exists = (path) => path === 'src/lib/utils.test.ts';

        expect(findMissingSiblings(['src/lib/utils.ts'], exists)).toEqual([]);
    });

    it('accepts a .tsx file covered by a .test.tsx sibling', () => {
        const exists = (path) => path === 'src/components/common/Toast/Toast.test.tsx';

        expect(findMissingSiblings(['src/components/common/Toast/Toast.tsx'], exists)).toEqual([]);
    });

    it('accepts a .tsx file covered by a .test.ts sibling — either extension counts', () => {
        const exists = (path) => path === 'src/components/common/Toast/Toast.test.ts';

        expect(findMissingSiblings(['src/components/common/Toast/Toast.tsx'], exists)).toEqual([]);
    });

    it('passes an empty change set', () => {
        expect(findMissingSiblings([], nothingExists)).toEqual([]);
    });

    it('never reports an exempt file, even with nothing on disk', () => {
        expect(
            findMissingSiblings(['src/main.tsx', 'src/components/ui/button.tsx'], nothingExists)
        ).toEqual([]);
    });

    it('reports every offender rather than stopping at the first', () => {
        expect(
            findMissingSiblings(['src/lib/a.ts', 'src/main.tsx', 'src/lib/b.ts'], nothingExists)
        ).toEqual(['src/lib/a.ts', 'src/lib/b.ts']);
    });

    it('cannot be satisfied by an unrelated existing file', () => {
        // A blanket-true `exists` would hide the bug where the wrong path is probed.
        // This asserts the probe is derived from the file under test.
        const probed = [];
        const exists = (path) => {
            probed.push(path);
            return false;
        };

        findMissingSiblings(['src/store/auth/authStore.ts'], exists);

        expect(probed).toEqual([
            'src/store/auth/authStore.test.ts',
            'src/store/auth/authStore.test.tsx'
        ]);
    });

    it('treats a sibling that exists for a DIFFERENT module as no cover', () => {
        expect(findMissingSiblings(['src/lib/a.ts'], everythingExists)).toEqual([]);
        expect(findMissingSiblings(['src/lib/a.ts'], (p) => p.includes('b.test'))).toEqual([
            'src/lib/a.ts'
        ]);
    });
});
