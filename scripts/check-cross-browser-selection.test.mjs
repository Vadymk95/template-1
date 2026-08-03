import { describe, expect, it } from 'vitest';

import { findEmptyProjects } from './check-cross-browser-selection.mjs';

const report = (projects, testsByProject) => ({
    config: { projects: projects.map((name) => ({ name })) },
    suites: [
        {
            specs: [
                {
                    tests: testsByProject.map((projectName) => ({ projectName }))
                }
            ],
            suites: [
                {
                    specs: [{ tests: [] }]
                }
            ]
        }
    ]
});

describe('findEmptyProjects', () => {
    it('accepts a report where every project collected a test', () => {
        expect(
            findEmptyProjects(report(['chromium', 'firefox'], ['chromium', 'firefox']))
        ).toMatchObject({ unreadable: false, empty: [] });
    });

    it('names the project that collected nothing — the whole point', () => {
        // A `testMatch` typo produces exactly this: the project exists, no test matched, exit code 0.
        expect(
            findEmptyProjects(report(['chromium', 'firefox', 'webkit'], ['chromium']))
        ).toMatchObject({ empty: ['firefox', 'webkit'] });
    });

    it('finds tests nested in child suites', () => {
        const nested = {
            config: { projects: [{ name: 'webkit' }] },
            suites: [{ suites: [{ specs: [{ tests: [{ projectName: 'webkit' }] }] }] }]
        };

        expect(findEmptyProjects(nested).empty).toEqual([]);
    });

    it('fails closed on a report it cannot read', () => {
        // "No projects" must never read as "nothing is empty".
        for (const unusable of [{}, { config: {} }, { config: { projects: [] } }, null]) {
            expect(findEmptyProjects(unusable)).toMatchObject({ unreadable: true, empty: [] });
        }
    });
});
