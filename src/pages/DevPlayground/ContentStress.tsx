/**
 * 🌱 TEMPLATE SEED — DEV-only content-stress fixture. Do NOT delete during refactors.
 *
 * Why it exists:
 *   Every primitive in this template used to be proven against exactly ONE string length. The defects
 *   that escape are always the other lengths: a label that overflows its box, a control that wraps into
 *   a 12-character column, a single unbroken token that pushes the page sideways. This page renders each
 *   primitive once per content state so `e2e/dev/content-stress.spec.ts` can MEASURE them in a browser
 *   at five viewport widths. jsdom cannot measure a rendered box, so a unit test can pin the class
 *   contract and nothing more.
 *
 * Where a fix belongs:
 *   Primitive cases (`Button`, `IconButton`, `Field`) guard the shipped kit — a violation there is fixed
 *   in `src/components/ui/*`. Composition cases (`ButtonRow`, `FeatureList`, `Prose`) guard a layout
 *   IDIOM this template's own pages use, so the fix is the idiom itself, here, and it is then copied
 *   into the page that needs it. Do not "fix" a primitive violation by patching this file.
 *
 * How to extend it:
 *   Add an entry to `CONTENT_STRESS_CASES` in `stressMatrix.ts` and a branch to `renderCase`. The
 *   counts are derived, so nothing else needs editing — and `ContentStress.test.tsx` fails if a case
 *   renders nothing.
 *
 * Mounted only under `import.meta.env.DEV` (see `src/router/modules/base.routes.tsx`), so the whole
 * tree is tree-shaken out of production bundles.
 */
import { Check } from 'lucide-react';
import type { FunctionComponent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEFAULT_NAMESPACE } from '@/lib/i18n/constants';
import {
    CONTENT_STRESS_CASES,
    CONTENT_STRESS_TOTAL,
    resolveItemCount,
    transformText,
    type ContentStressComponent
} from '@/pages/DevPlayground/stressMatrix';

const HOME_NAMESPACE = 'home';
const ERRORS_NAMESPACE = 'errors';

interface CaseProps {
    component: ContentStressComponent;
    heading: string;
    iconLabel: string;
    itemCount: number;
    message: string;
    text: string;
}

const renderCase = ({
    component,
    heading,
    iconLabel,
    itemCount,
    message,
    text
}: CaseProps): ReactElement => {
    switch (component) {
        case 'Button':
            return <Button>{text}</Button>;
        case 'ButtonRow':
            /*
             * The IDIOM for a button that may carry a sentence, and the reason the base variant is not
             * changed to match. `Button` keeps `whitespace-nowrap` because chrome labels must never
             * break across lines — pinned by `focus-indicator.test.tsx`. A consumer whose label is real
             * content opts out here: `whitespace-normal` to allow wrapping at all, `h-auto min-h-10` so
             * a second line is not clipped by the fixed height, and `min-w-0` on the label so the flex
             * item can shrink below its longest word. Measured without them: 1161px of content in a
             * 798px row at 1440 — a defect that is NOT narrow-viewport-only.
             */
            return (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Button
                        variant="secondary"
                        className="h-auto min-h-10 min-w-0 whitespace-normal"
                    >
                        <span className="min-w-0 wrap-anywhere">{text}</span>
                    </Button>
                    <Button variant="outline" className="h-auto min-h-10 min-w-0 whitespace-normal">
                        <span className="min-w-0 wrap-anywhere">{text}</span>
                    </Button>
                </div>
            );
        case 'IconButton':
            return (
                <Button variant="ghost" size="icon" aria-label={`${iconLabel} ${text}`}>
                    <Check className="size-4" />
                </Button>
            );
        case 'Field':
            return (
                <div className="space-y-2">
                    <label className="text-sm leading-none font-medium" htmlFor="stress-field">
                        {text}
                    </label>
                    <Input id="stress-field" placeholder={text} defaultValue={text} />
                    <p className="text-sm text-destructive" role="alert">
                        {message}
                    </p>
                </div>
            );
        case 'Prose':
            return (
                <div className="space-y-2">
                    <h3 className="text-lg font-semibold">{heading}</h3>
                    <p className="text-sm text-muted-foreground">{text}</p>
                </div>
            );
        case 'FeatureList':
            return (
                <ul className="space-y-1">
                    {Array.from(
                        { length: itemCount },
                        (_, index) => `${text} ${String(index)}`
                    ).map((item) => (
                        <li key={item} className="flex items-center gap-2 text-sm">
                            <Check className="size-4 shrink-0" aria-hidden="true" />
                            {/*
                             * `min-w-0` is load-bearing, not decoration: a flex item's default
                             * `min-width: auto` floors it at its longest unbreakable word, so
                             * `overflow-wrap` in the base layer cannot save it on its own.
                             */}
                            <span className="min-w-0">{item}</span>
                        </li>
                    ))}
                </ul>
            );
    }
};

export const ContentStress: FunctionComponent = () => {
    const { t } = useTranslation([DEFAULT_NAMESPACE, HOME_NAMESPACE, ERRORS_NAMESPACE]);

    // Real authored copy, never lorem-ipsum: the transform starts from a string the product ships, so
    // the TYPICAL state is genuinely typical and the LONG state is a real string tripled.
    const sourceText = t('home:features.state');
    const sourceHeading = t('home:features.title');
    const sourceMessage = t('errors:validation.maxLength');
    const iconLabel = t('common:success');

    return (
        <div
            className="container mx-auto max-w-4xl min-w-0 space-y-6 p-8"
            data-stress-root
            data-stress-components={CONTENT_STRESS_CASES.length}
            data-stress-total={CONTENT_STRESS_TOTAL}
        >
            <div className="space-y-2">
                <h1 className="text-3xl font-bold">{t('home:features.title')}</h1>
                <p className="text-muted-foreground">{t('home:subtitle')}</p>
            </div>

            <div className="grid min-w-0 gap-6">
                {CONTENT_STRESS_CASES.flatMap(({ component, states }) =>
                    states.map((state) => (
                        <article
                            key={`${component}-${state}`}
                            className="min-w-0 rounded-lg border border-border p-4"
                            data-stress-case
                            data-stress-component={component}
                            data-stress-state={state}
                        >
                            <p className="mb-3 text-xs text-muted-foreground">
                                {`${component} · ${state}`}
                            </p>
                            <div className="min-w-0" data-stress-target>
                                {renderCase({
                                    component,
                                    heading: transformText(sourceHeading, state),
                                    iconLabel,
                                    itemCount: resolveItemCount(state),
                                    message: transformText(sourceMessage, state),
                                    text: transformText(sourceText, state)
                                })}
                            </div>
                        </article>
                    ))
                )}
            </div>
        </div>
    );
};
