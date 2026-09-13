# Changelog

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
