import { describe, expect, it } from 'vitest';

// `ui/` holds what the shadcn CLI writes, and the CLI writes lowercase files (`button.tsx`), so the
// folder is lowercase throughout. Every other component is a PascalCase folder with an `index.tsx`,
// and a fork that adds `ui/Button/` beside `ui/button.tsx` makes `@/components/ui/Button` mean the
// file on a case-insensitive disk (macOS, Windows) and the folder on Linux: green on one machine,
// red on the other. A wrapper that wants a PascalCase folder goes in `components/common/<Name>/`.
const casingProblems = (entries: string[]): string[] => {
    const seen = new Map<string, string>();
    const problems: string[] = [];

    for (const entry of entries) {
        if (/^[A-Z]/.test(entry)) problems.push(`${entry} starts with an uppercase letter`);

        const earlier = seen.get(entry.toLowerCase());
        if (earlier) problems.push(`${entry} differs from ${earlier} only by case`);
        else seen.set(entry.toLowerCase(), entry);
    }

    return problems;
};

// The names directly inside the folder (a subfolder shows up through the files it holds), read through
// the bundler's glob: the unit-test project has no Node types, so `readdirSync` would not compile here.
const folderEntries = (): string[] => [
    ...new Set(
        Object.keys(import.meta.glob('./**/*')).flatMap((file) => file.slice(2).split('/')[0] ?? [])
    )
];

describe('the ui folder', () => {
    it('holds only lowercase entries, none that differ from another by case', () => {
        const entries = folderEntries();

        // The listing must be the real folder: an empty or wrong one would pass for the wrong reason.
        expect(entries).toEqual(expect.arrayContaining(['button.tsx', 'input.tsx']));
        expect(casingProblems(entries)).toEqual([]);
    });

    it('reports a PascalCase entry beside the generated file', () => {
        expect(casingProblems(['button.tsx', 'Button'])).toEqual([
            'Button starts with an uppercase letter'
        ]);
    });

    it('reports two entries that differ only by case', () => {
        expect(casingProblems(['focusRing.tsx', 'focusring.tsx'])).toEqual([
            'focusring.tsx differs from focusRing.tsx only by case'
        ]);
    });
});
