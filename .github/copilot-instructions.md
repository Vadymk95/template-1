# Review instructions

React 19 + Vite 8 SPA template. Report correctness, security, accessibility and test strength before
style — style is ESLint's and Prettier's job, not a review finding.

## Non-negotiable

- `npm run verify` is the bar and it is zero-warnings (`eslint --max-warnings 0`,
  `oxlint --deny-warnings`). A change that needs a rule downgraded, a severity lowered, a coverage
  threshold moved, or an `eslint-disable` to pass is a finding, not a fix.
- The frontend is not a security boundary. Tokens come from the store via `getAuthToken`; nothing
  reads or writes credentials directly.
- No secrets, keys or endpoints in committed files. `.env.example` carries placeholders; real values
  live in the host's environment. This holds for values that look harmless.
- Template seeds listed in `.cursor/brain/TEMPLATE_SEEDS.md` (`_example*`, `DevPlayground`, MSW
  handlers) are reference material. Removing them as "dead code" is a finding.

## Conventions the linter enforces — flag attempts to work around them

- Named constants, never bare literals in logic (`@typescript-eslint/no-magic-numbers`). Location is
  set by `.cursor/rules/constants.mdc`: co-locate for a single module, `src/store/<domain>/constants.ts`
  for store scope, `src/router/routes.ts` for paths.
- Design tokens, never raw hex, in `src/components/**` and `src/pages/**`. Tokens live in
  `src/index.css` under `@theme inline`.
- One-way layer imports: `components`, `hocs`, `hooks`, `store` and `lib` must not import `pages`;
  `store` and `lib` must not import `components`.
- `@/` alias only. Parent-relative imports (`../..`) are blocked.
- Explicit in/out contracts: a `FunctionComponent<Props>` annotation or an explicit return type.
  Interface callbacks use property style (`onSelect: (id: string) => void`), not method style.
- `FunctionComponent`, never the `FC` alias. Arrow functions, never function declarations.
- `logger` from `src/lib/logger.ts`, never `console.*`.
- Every user-visible string goes through `t()`. The only exceptions are documented in
  `eslint.config.js`: the i18n-init fallbacks, which run when `t()` cannot exist, and dev tooling.

## Correctness patterns worth checking every time

- A test that still passes when the fix is reverted is not a test. Look for assertions that hold
  regardless of the behaviour under test, and for `toHaveTextContent('')` where
  `toBeEmptyDOMElement()` was meant.
- Every `src` logic file needs a co-located `*.test.*`; the pre-commit hook enforces existence, not
  quality. Judge the quality.
- A number that also appears inside a user-facing message must be interpolated from the same
  constant, or the two drift.
- Validate at boundaries with Zod (`src/lib/api/safeFetch.ts`). A response typed by assertion rather
  than parsed is trusted on faith.
- `disabled` on an anchor does nothing, and on a button it drops focus to the body. Expect
  `aria-disabled` plus a click guard.
- Interactive elements need a visible focus state, a target of at least 44px, and a label associated
  with the control — not a placeholder standing in for one.
- Reduced-motion must resolve to the end state, not to a shorter animation.

## Conventions

- Conventional Commits, subject at most 96 characters.
- No ticket or task identifiers in code comments, test names, or commit messages. A comment states
  the constraint in plain words; traceability belongs to the branch and the pull request.
- English only in code, comments, commits and docs.
