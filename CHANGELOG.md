# Changelog

## [3.3.0](https://github.com/Vadymk95/template-1/compare/v3.2.3...v3.3.0) (2026-10-02)


### Features

* **agents:** committed limits deny force pushes, skipped hooks and env reads in every mode ([96e3abb](https://github.com/Vadymk95/template-1/commit/96e3abb48eb2085156814fa6afc049b3342253a2))


### Bug fixes

* **deps:** raise the brace-expansion floor past three new high advisories ([8b982b1](https://github.com/Vadymk95/template-1/commit/8b982b1abfa9198a709096c4ac8cfe3a3b4ff891))
* **test:** hold vitest at 4.1 until the Stryker runner kills mutants under vitest 5 ([e332981](https://github.com/Vadymk95/template-1/commit/e332981b4941ee4a851b57dc01a0af558d293881))


### Maintenance

* **deps:** bump the minor-and-patch group with 14 updates ([#83](https://github.com/Vadymk95/template-1/issues/83)) ([b97a6d7](https://github.com/Vadymk95/template-1/commit/b97a6d717ae3f34c51fbca214f6fa5ace63fc2ac))
* **deps:** size-limit and @size-limit/file 14 together, and one Dependabot group for them ([#86](https://github.com/Vadymk95/template-1/issues/86)) ([f66e98f](https://github.com/Vadymk95/template-1/commit/f66e98fc99436fe5d07ec7cf307b9477712051ae))
* **gate:** cap e2e failures on the gate run and keep one last-run record per suite ([fd5c8ab](https://github.com/Vadymk95/template-1/commit/fd5c8abc7e6d8855f64ea58b1cf6b93760a0a08f))


### CI

* **deps:** one weekly Dependabot PR for minor and patch, so the lock file stops conflicting ([5144da3](https://github.com/Vadymk95/template-1/commit/5144da3add3fbb36303ae2bf3a0d205ff711e4cd))
* **release:** release-please prefers a RELEASE_PLEASE_TOKEN secret when one is set ([c61a1f2](https://github.com/Vadymk95/template-1/commit/c61a1f259071b165fc7aecd035522ae0c88942b3))

## [3.2.3](https://github.com/Vadymk95/template-1/compare/v3.2.2...v3.2.3) (2026-09-27)


### Maintenance

* **deps:** bump the development-dependencies group with 9 updates ([#74](https://github.com/Vadymk95/template-1/issues/74)) ([0ca8a23](https://github.com/Vadymk95/template-1/commit/0ca8a23e759a1c1710b363b81ebd51a2cac27a83))
* **deps:** bump the production-dependencies group with 6 updates ([#73](https://github.com/Vadymk95/template-1/issues/73)) ([97b5bdb](https://github.com/Vadymk95/template-1/commit/97b5bdbcd3dc4e89b27bb469a7d3a3921534a6b3))


### CI

* **deps:** bump googleapis/release-please-action in the actions group ([#72](https://github.com/Vadymk95/template-1/issues/72)) ([8cfc2da](https://github.com/Vadymk95/template-1/commit/8cfc2daa06e6f8faec345a1352c2984167d6ad12))

## [3.2.2](https://github.com/Vadymk95/template-1/compare/v3.2.1...v3.2.2) (2026-09-13)


### Bug fixes

* **ci:** a fork that renames its default branch no longer loses CI and protection ([#70](https://github.com/Vadymk95/template-1/issues/70)) ([6e47f3d](https://github.com/Vadymk95/template-1/commit/6e47f3d94567379e0ed71ad08e3bf8e1ee511d6c))

## [3.2.1](https://github.com/Vadymk95/template-1/compare/v3.2.0...v3.2.1) (2026-09-13)


### Bug fixes

* **gate:** give the push budget a recency window so it can recover ([7f0673c](https://github.com/Vadymk95/template-1/commit/7f0673cecf6d05d7c3ed410e19986b800a06dd65))
* **gate:** let release-please own the changelog format instead of the checker ([151eaaa](https://github.com/Vadymk95/template-1/commit/151eaaa7802f9b608767cd889fb221b3853490a5))
* **gate:** make eslint blind to an agent worktree inside the repository ([bcc58d8](https://github.com/Vadymk95/template-1/commit/bcc58d8a5628cbd4348d6841ca528647b823739d))
* **gate:** the push budget calibrates to the machine it runs on, not to mine ([#69](https://github.com/Vadymk95/template-1/issues/69)) ([ced0239](https://github.com/Vadymk95/template-1/commit/ced02393dae5c25ec8e966a4a63e1d27405780de))

## [3.2.0](https://github.com/Vadymk95/template-1/compare/v3.1.0...v3.2.0) (2026-09-13)


### Features

* **docs-check:** focused tests never land; an unconditional skip carries a dated quarantine ([3b58dfe](https://github.com/Vadymk95/template-1/commit/3b58dfe908c1a8abe9b12f2f906cb0f9ccbd8ffb))
* **gate:** docs:check in a docs class; the tracer records the phase ([bd3d90b](https://github.com/Vadymk95/template-1/commit/bd3d90b8fb6f8d78063b407d313853d895c3013f))
* **gate:** the browser suite has a ceiling in the tier data; push budgets are per phase ([514b388](https://github.com/Vadymk95/template-1/commit/514b38816ff3aa3a3cbf53e1c16b448ac541fc99))
* **home:** the start page shows what is inside, how work flows and the agent commands ([4280bfd](https://github.com/Vadymk95/template-1/commit/4280bfd262b808362987563465acd661423b5616))


### Bug fixes

* **docs-check:** module references, attached rules, script families; verify:* in the law ([85e532d](https://github.com/Vadymk95/template-1/commit/85e532d37582e1d35533006b0acff6ff98a5dcbb))
* **docs-check:** relative markdown link targets are checked like backticked paths ([cec260d](https://github.com/Vadymk95/template-1/commit/cec260d43d26c160f403c142d7e5a361a3eac6b2))
* **home:** code chips keep their own foreground, contrast inside muted copy ([03da6b3](https://github.com/Vadymk95/template-1/commit/03da6b363de8c8ebe338df2d24cc7aac9bc82234))
* **ports:** the probe answers what its callers ask, IPv6 loopback included ([64f6151](https://github.com/Vadymk95/template-1/commit/64f6151759dcb3fab4dd38aa40db8885afa9cecf))
* **release:** the bootstrap sha must be the full 40 chars, or it never matches ([7a6557a](https://github.com/Vadymk95/template-1/commit/7a6557aeccc5a1d3afcde7b378c4dac2168feb3d))
* **theme:** the theme is applied before the first paint; the scrollbar keeps its gutter ([443fba9](https://github.com/Vadymk95/template-1/commit/443fba928f318deaaf4cb38e8b43c391ee4e482d))


### Build and dependencies

* **deps:** size-limit measures files only; the time plugin and its puppeteer tree leave ([77734bd](https://github.com/Vadymk95/template-1/commit/77734bd18e83fda0114531b358bd1197c1c77e8f))


### Maintenance

* **deps:** in-range update; the 3-day cooldown lifted once by operator decision ([f3f1a4c](https://github.com/Vadymk95/template-1/commit/f3f1a4c8f9a172129ebec38c382fc653cfc5e67b))
* **size:** entry budget re-measured after zod 4.6 grew it by 1.5 kB brotli ([9e63269](https://github.com/Vadymk95/template-1/commit/9e632695e7c7a6c150a36001353e49600b22f3cd))


### Documentation

* **readme:** drop three duplicated command rows ([c962b3e](https://github.com/Vadymk95/template-1/commit/c962b3e20dbe2575d1c91c3343da6f1619f5dc60))


### Tests

* **gate:** the port suites bind ephemeral ports; the two flaky cases are deterministic ([669e867](https://github.com/Vadymk95/template-1/commit/669e867fbd1c9f9ce0523e2c977314824003e2d8))


### CI

* **release:** release-please keeps a release PR with the version, changelog and tag ([fd67cd5](https://github.com/Vadymk95/template-1/commit/fd67cd55ebcd3003432dfc177fd1942c1d070da9))
