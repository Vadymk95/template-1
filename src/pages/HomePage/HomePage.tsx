import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_NAMESPACE } from '@/lib/i18n/constants';

import { useHomePage } from './useHomePage';

const HOME_NAMESPACE = 'home';
const AGENTS_FILE = 'AGENTS.md';
const TEMPLATES_DIR = '.cursor/templates/';
const GRADUATION_GUIDE = '.cursor/docs/enterprise-upgrade.md';
const COMMAND_PREFIX = '/';
const INSIDE = [
    'react',
    'vite',
    'typescript',
    'styling',
    'state',
    'routing',
    'i18n',
    'testing'
] as const;
const FLOW = ['iterate', 'commit', 'push', 'ci'] as const;
const COMMANDS = ['onboard', 'feat', 'test', 'review', 'docs'] as const;
const READING = [
    ['index', '.cursor/brain/READING_INDEX.md'],
    ['map', '.cursor/brain/MAP.md'],
    ['skeletons', '.cursor/brain/SKELETONS.md'],
    ['verification', '.cursor/brain/VERIFICATION.md'],
    ['decisions', '.cursor/brain/DECISIONS.md']
] as const;
const STEPS = [
    ['prepare', 'npm run prepare'],
    ['dev', 'npm run dev'],
    ['iter', 'npm run verify:iter']
] as const;

const CARD = 'rounded-lg border bg-card p-4 text-sm text-card-foreground';
const CODE = 'rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] break-all';

interface SectionProps {
    id: string;
    title: string;
    children: ReactNode;
}

const Section: FunctionComponent<SectionProps> = ({ id, title, children }) => (
    <section aria-labelledby={id} className="mt-10">
        <h2 id={id} className="text-xl font-semibold tracking-tight">
            {title}
        </h2>
        {children}
    </section>
);

interface DefinitionListProps<Key extends string> {
    rows: readonly (readonly [Key, string])[];
    describe: (key: Key) => string;
}

const DefinitionList = <Key extends string>({
    rows,
    describe
}: DefinitionListProps<Key>): ReactElement => (
    <dl className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr] sm:gap-x-6">
        {rows.map(([key, term]) => (
            <div key={key} className="contents">
                <dt>
                    <code className={CODE}>{term}</code>
                </dt>
                <dd className="text-sm text-muted-foreground">{describe(key)}</dd>
            </div>
        ))}
    </dl>
);

const StackCheck: FunctionComponent = () => {
    const { t } = useTranslation([DEFAULT_NAMESPACE, HOME_NAMESPACE]);
    const { data, isLoading, isError } = useHomePage();

    return (
        <Section id="stack-check" title={t('home:stackCheck.title')}>
            <p className="mt-2 text-sm text-muted-foreground">{t('home:stackCheck.description')}</p>
            {isLoading ? (
                <p className="mt-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                    {t('common:loading')}
                </p>
            ) : isError ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                    {t('home:stackCheck.error')}
                </p>
            ) : (
                <p className="mt-2 text-sm font-medium" role="status" aria-live="polite">
                    {data}
                </p>
            )}
        </Section>
    );
};

/**
 * The start page: what the template ships, how work flows through the gate, which agent commands
 * exist and where to read next — the template seed a fork replaces with its first real screen. Copy
 * lives in `public/locales/<lng>/home.json`; the stack check keeps the TanStack Query + MSW seed alive.
 */
export const HomePage: FunctionComponent = (): ReactElement => {
    const { t } = useTranslation([DEFAULT_NAMESPACE, HOME_NAMESPACE]);
    const commands = COMMANDS.map((key) => [key, `${COMMAND_PREFIX}${key}`] as const);

    return (
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
            <header>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('home:title')}</h1>
                <p className="mt-3 max-w-3xl text-lg text-muted-foreground">
                    {t('home:description')}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{t('home:seed')}</p>
            </header>

            <StackCheck />

            <Section id="inside" title={t('home:inside.title')}>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {INSIDE.map((key) => (
                        <li key={key} className={CARD}>
                            {t(`home:inside.${key}`)}
                        </li>
                    ))}
                </ul>
            </Section>

            <Section id="flow" title={t('home:flow.title')}>
                <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {FLOW.map((key) => (
                        <li key={key} className={CARD}>
                            <h3 className="font-semibold">{t(`home:flow.${key}.title`)}</h3>
                            <p className="mt-1 text-muted-foreground">
                                {t(`home:flow.${key}.text`)}
                            </p>
                        </li>
                    ))}
                </ol>
            </Section>

            <Section id="agents" title={t('home:agents.title')}>
                <p className="mt-4 text-sm">
                    <code className={CODE}>{AGENTS_FILE}</code> {t('home:agents.lead')}
                </p>
                <DefinitionList
                    rows={commands}
                    describe={(key) => t(`home:agents.commands.${key}`)}
                />
                <p className="mt-4 text-sm text-muted-foreground">
                    {t('home:agents.spec')} <code className={CODE}>{TEMPLATES_DIR}</code>
                </p>
            </Section>

            <Section id="reading" title={t('home:reading.title')}>
                <DefinitionList rows={READING} describe={(key) => t(`home:reading.${key}`)} />
            </Section>

            <Section id="steps" title={t('home:steps.title')}>
                <ol className="mt-4 list-decimal space-y-2 pl-6 text-sm">
                    {STEPS.map(([key, command]) => (
                        <li key={key}>
                            <code className={CODE}>{command}</code> {t(`home:steps.${key}`)}
                        </li>
                    ))}
                    <li>
                        {t('home:steps.graduate')} <code className={CODE}>{GRADUATION_GUIDE}</code>
                    </li>
                </ol>
            </Section>
        </div>
    );
};
