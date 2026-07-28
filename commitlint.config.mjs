const config = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            [
                'feat',
                'fix',
                'chore',
                'docs',
                'style',
                'refactor',
                'perf',
                'test',
                'revert',
                // `.github/dependabot.yml` emits `ci(deps)` for action bumps, and bot
                // commits bypass this hook — so without these two the config produced
                // messages its own linter rejected. Matches the sibling templates.
                'build',
                'ci'
            ]
        ],
        'header-max-length': [2, 'always', 96]
    }
};

// Example commit message
// feat(blog): add comment section

export default config;
